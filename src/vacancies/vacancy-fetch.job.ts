import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleInit } from '@nestjs/common'
import type { ConfigType } from '@nestjs/config'
import type { Counter } from '@prometheus-io/client'
import { sql } from 'drizzle-orm'
import { fromDrizzle, type JobWithMetadata, PgBoss } from 'pg-boss'
import { z } from 'zod'
import { DB } from '../common/database/database.js'
import { PG_BOSS } from '../common/jobs/jobs.module.js'
import { Metrics } from '../common/metrics/metrics.js'
import { fetchConfig } from '../config/config.js'
import type { Db, Tx } from '../db/types.js'
import type { ApplyForm } from './apply-form.js'
import type { FetchedVacancy } from './fetch-adapters.js'
import { FETCH_TIMEOUT_MS, FetchError } from './fetch-http.js'
import { VacanciesRepository } from './vacancies.repository.js'
import { VacancyFetcher } from './vacancy-fetcher.js'
import { VacancyParseJob } from './vacancy-parse.job.js'

export const VACANCY_FETCH_QUEUE = 'vacancy.fetch'

/** The raw text column holds at most this much. */
const RAW_TEXT_MAX = 100_000

/** Two or three requests of 15 s each, plus the write. */
const EXPIRE_SECONDS = (3 * FETCH_TIMEOUT_MS) / 1000 + 30

/** Fetches a pod runs at once. */
export const VACANCY_FETCH_CONCURRENCY = 4

const payloadSchema = z.object({
    vacancyId: z.uuid(),
})

type FetchResult = 'fetched' | 'failed' | 'retry' | 'skipped'

/**
 * `vacancy.fetch { vacancyId }`: reads a vacancy's link before its parse
 * (`VacancyFetcher`: an ATS API or the page) and stores the apply form. The
 * text read fills `raw_text` only when the person gave none; their own text is
 * kept. Then, in the same transaction, the parse is queued if the vacancy is
 * `pending`. A failure without a text of the person's leaves the parse to
 * fail with `no_text`. Timeouts, network errors, 429 and 5xx are retried on
 * the queue (`stately` per vacancy); the last try stores the failure.
 */
@Injectable()
export class VacancyFetchJob implements OnModuleInit, OnApplicationBootstrap {
    private readonly logger = new Logger(VacancyFetchJob.name)
    private readonly results: Counter<'result' | 'source'>

    constructor(
        @Inject(PG_BOSS) private readonly boss: PgBoss,
        @Inject(DB) private readonly db: Db,
        private readonly repository: VacanciesRepository,
        private readonly fetcher: VacancyFetcher,
        private readonly parseJob: VacancyParseJob,
        @Inject(fetchConfig.KEY) private readonly config: ConfigType<typeof fetchConfig>,
        metrics: Metrics,
    ) {
        this.results = metrics.counter({
            name: 'vacancy_fetch_total',
            help: 'Vacancy link fetches by result (fetched, failed, retry, skipped) and source (greenhouse, lever, ashby, workable, page, none).',
            labelNames: [
                'result',
                'source',
            ],
        })
    }

    get queues(): string[] {
        return [
            VACANCY_FETCH_QUEUE,
        ]
    }

    async onModuleInit() {
        await this.boss.createQueue(VACANCY_FETCH_QUEUE, {
            policy: 'stately',
            retryLimit: 2,
            retryDelay: 10,
            retryBackoff: true,
            retryDelayMax: 120,
            expireInSeconds: EXPIRE_SECONDS,
        })
    }

    async onApplicationBootstrap() {
        await this.boss.work(
            VACANCY_FETCH_QUEUE,
            {
                pollingIntervalSeconds: 1,
                localConcurrency: VACANCY_FETCH_CONCURRENCY,
                includeMetadata: true,
            },
            async ([job]) => {
                if (!job) return
                const { result, source } = await this.run(job)
                this.results.inc({
                    result,
                    source,
                })
            },
        )
    }

    /** Queues a fetch of each vacancy that has a link, committed or rolled back with `tx`; it is `pending` until then. */
    async request(tx: Tx, vacancyIds: string[]): Promise<string[]> {
        const ids = await this.repository.markFetchPending(tx, [
            ...new Set(vacancyIds),
        ])
        for (const vacancyId of ids)
            await this.boss.send(
                VACANCY_FETCH_QUEUE,
                {
                    vacancyId,
                },
                {
                    singletonKey: vacancyId,
                    db: fromDrizzle(tx, sql),
                },
            )
        return ids
    }

    private async run(job: JobWithMetadata<unknown>): Promise<{
        result: FetchResult
        source: string
    }> {
        const payload = payloadSchema.safeParse(job.data)
        if (!payload.success) {
            this.logger.warn(
                {
                    jobId: job.id,
                },
                'Vacancy fetch job with an invalid payload dropped',
            )
            return {
                result: 'skipped',
                source: 'none',
            }
        }
        const { vacancyId } = payload.data
        const vacancy = await this.repository.findById(vacancyId)
        if (!vacancy)
            return {
                result: 'skipped',
                source: 'none',
            }
        if (!vacancy.url || !this.config.enabled) {
            await this.finish(vacancyId, {
                status: 'skipped',
                error: null,
                text: '',
            })
            return {
                result: 'skipped',
                source: 'none',
            }
        }

        const startedAt = performance.now()
        let fetched: FetchedVacancy
        try {
            fetched = await this.fetcher.fetch(vacancy.url, job.signal)
        } catch (error) {
            const failure = error instanceof FetchError ? error : undefined
            if (failure?.retryable && job.retryCount < job.retryLimit) {
                this.logger.warn(
                    {
                        jobId: job.id,
                        vacancyId,
                        code: failure.code,
                        retryCount: job.retryCount,
                    },
                    'Vacancy fetch failed, retrying',
                )
                this.results.inc({
                    result: 'retry',
                    source: 'none',
                })
                throw failure
            }
            // A bug or Postgres down: retried, and the last try still lets the parse go on.
            if (!failure && job.retryCount < job.retryLimit) throw error
            const code = failure?.code ?? 'internal'
            await this.finish(vacancyId, {
                status: 'failed',
                error: code,
                text: '',
            })
            this.logger.warn(
                {
                    jobId: job.id,
                    vacancyId,
                    code,
                },
                'Vacancy fetch failed',
            )
            return {
                result: 'failed',
                source: 'none',
            }
        }

        const text = fetched.text.slice(0, RAW_TEXT_MAX)
        const status = text ? 'fetched' : 'failed'
        const parse = await this.finish(vacancyId, {
            status,
            error: text ? null : 'no_content',
            text,
            form: fetched.form,
        })
        this.logger.log(
            {
                jobId: job.id,
                vacancyId,
                source: fetched.source,
                status,
                chars: text.length,
                fields: fetched.form?.fields.length ?? 0,
                textKept: vacancy.rawText !== '',
                parse,
                ms: Math.round(performance.now() - startedAt),
            },
            'Vacancy fetched',
        )
        return {
            result: status,
            source: fetched.source,
        }
    }

    /** The result stored and, when the vacancy is `pending`, its parse queued, in one transaction. */
    private async finish(
        vacancyId: string,
        result: {
            status: 'fetched' | 'failed' | 'skipped'
            error: string | null
            text: string
            form?: ApplyForm | null
        },
    ): Promise<boolean> {
        return this.db.transaction(async tx => {
            const parseStatus = await this.repository.saveFetch(tx, vacancyId, result)
            if (parseStatus !== 'pending') return false
            await this.parseJob.request(tx, [
                vacancyId,
            ])
            return true
        })
    }
}
