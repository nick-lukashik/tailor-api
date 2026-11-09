import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleInit } from '@nestjs/common'
import type { ConfigType } from '@nestjs/config'
import type { Counter } from '@prometheus-io/client'
import { sql } from 'drizzle-orm'
import { fromDrizzle, type JobWithMetadata, PgBoss } from 'pg-boss'
import { z } from 'zod'
import { PG_BOSS } from '../common/jobs/jobs.module.js'
import { Metrics } from '../common/metrics/metrics.js'
import { llmConfig } from '../config/config.js'
import type { Tx, VacancyRow } from '../db/types.js'
import { LlmGatewayClient } from '../llm/llm-gateway.client.js'
import { LlmCallError } from '../llm/llm-gateway.js'
import { PARSE_PROMPT_VERSION, PARSE_SYSTEM_PROMPT, parseUserMessage } from './parse.prompt.js'
import { parsedVacancySchema } from './parse.schemas.js'
import { VacanciesRepository } from './vacancies.repository.js'

export const PARSE_QUEUE = 'vacancy.parse'

/** Above the 120 s of one gateway call plus the reads and the write. */
const EXPIRE_SECONDS = 180

const payloadSchema = z.object({
    vacancyId: z.uuid(),
})

type ParseResult = 'parsed' | 'failed' | 'retry' | 'skipped'

/** Title and company fit their 200-character columns (and the applications'). */
export const clip = (value: string | null) => (value ?? '').trim().slice(0, 200)

/**
 * After a failed call: another try while the error is retryable and the
 * queue has retries left, else the vacancy is `failed` with the error's code.
 */
export const afterFailure = (error: LlmCallError, retryCount: number, retryLimit: number): 'retry' | 'fail' =>
    error.retryable && retryCount < retryLimit ? 'retry' : 'fail'

/**
 * `vacancy.parse { vacancyId }`: a model reads the vacancy's text through the
 * LLM gateway and fills `parsed`, `title`, `company`, and the company and role
 * of the applications on it that have none. `stately` with the vacancy id as
 * `singletonKey`: at most one queued and one active parse per vacancy, so two
 * parses of one vacancy never write at the same time. Retries back off over
 * a few minutes, long enough for the gateway to restart.
 */
@Injectable()
export class VacancyParseJob implements OnModuleInit, OnApplicationBootstrap {
    private readonly logger = new Logger(VacancyParseJob.name)
    private readonly results: Counter<'result'>

    constructor(
        @Inject(PG_BOSS) private readonly boss: PgBoss,
        private readonly repository: VacanciesRepository,
        private readonly llm: LlmGatewayClient,
        @Inject(llmConfig.KEY) private readonly config: ConfigType<typeof llmConfig>,
        metrics: Metrics,
    ) {
        this.results = metrics.counter({
            name: 'vacancy_parse_total',
            help: 'Vacancy parse attempts by result: parsed, failed, retry (the job is tried again), skipped.',
            labelNames: [
                'result',
            ],
        })
    }

    /** The queue exists before the first request can send to it. */
    async onModuleInit() {
        await this.boss.createQueue(PARSE_QUEUE, {
            policy: 'stately',
            retryLimit: 5,
            retryDelay: 5,
            retryBackoff: true,
            retryDelayMax: 300,
            expireInSeconds: EXPIRE_SECONDS,
        })
    }

    async onApplicationBootstrap() {
        await this.boss.work(
            PARSE_QUEUE,
            {
                pollingIntervalSeconds: 1,
                localConcurrency: 2,
                includeMetadata: true,
            },
            async ([job]) => {
                if (!job) return
                const result = await this.run(job)
                this.results.inc({
                    result,
                })
            },
        )
    }

    /** Queues a parse of each vacancy, committed or rolled back with `tx`. */
    async request(tx: Tx, vacancyIds: string[]) {
        for (const vacancyId of vacancyIds)
            await this.boss.send(
                PARSE_QUEUE,
                {
                    vacancyId,
                },
                {
                    singletonKey: vacancyId,
                    db: fromDrizzle(tx, sql),
                },
            )
    }

    private async run(job: JobWithMetadata<unknown>): Promise<ParseResult> {
        const payload = payloadSchema.safeParse(job.data)
        if (!payload.success) {
            this.logger.warn(
                {
                    jobId: job.id,
                },
                'Vacancy parse job with an invalid payload dropped',
            )
            return 'skipped'
        }
        const { vacancyId } = payload.data
        const vacancy = await this.repository.findById(vacancyId)
        if (!vacancy) return 'skipped'
        if (vacancy.rawText === '') {
            // A later stage fetches the page by `vacancy.url` here before giving up.
            await this.repository.markFailed(vacancyId, 'no_text')
            this.logFailure(job, vacancyId, 'no_text')
            return 'failed'
        }
        try {
            await this.parse(job, vacancy)
            return 'parsed'
        } catch (error) {
            const failure = error instanceof LlmCallError ? error : undefined
            // Anything else (Postgres down, a bug): pg-boss retries it and the vacancy stays `pending`.
            if (!failure) throw error
            if (afterFailure(failure, job.retryCount, job.retryLimit) === 'retry') {
                this.logger.warn(
                    {
                        jobId: job.id,
                        vacancyId,
                        code: failure.code,
                        retryCount: job.retryCount,
                    },
                    'Vacancy parse failed, retrying',
                )
                this.results.inc({
                    result: 'retry',
                })
                throw failure
            }
            await this.repository.markFailed(vacancyId, failure.code)
            this.logFailure(job, vacancyId, failure.code)
            return 'failed'
        }
    }

    private async parse(job: JobWithMetadata<unknown>, vacancy: VacancyRow) {
        const startedAt = performance.now()
        const { output, promptTokens, completionTokens } = await this.llm.complete({
            model: this.config.parseModel,
            system: PARSE_SYSTEM_PROMPT,
            user: parseUserMessage(vacancy.rawText, vacancy.url),
            schema: parsedVacancySchema,
            schemaName: 'parsed_vacancy',
            purpose: 'vacancy-parse',
            // Retries of this job reuse a successful answer the gateway already has.
            idempotencyKey: `vacancy-parse-${job.id}`,
            signal: job.signal,
        })
        await this.repository.saveParsed(vacancy.id, {
            parsed: output,
            title: clip(output.title),
            company: clip(output.company),
        })
        this.logger.log(
            {
                jobId: job.id,
                vacancyId: vacancy.id,
                model: this.config.parseModel,
                promptVersion: PARSE_PROMPT_VERSION,
                promptTokens,
                completionTokens,
                ms: Math.round(performance.now() - startedAt),
            },
            'Vacancy parsed',
        )
    }

    private logFailure(job: JobWithMetadata<unknown>, vacancyId: string, code: string) {
        this.logger.warn(
            {
                jobId: job.id,
                vacancyId,
                code,
            },
            'Vacancy parse failed',
        )
    }
}
