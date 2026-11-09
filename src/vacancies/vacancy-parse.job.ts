import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleInit } from '@nestjs/common'
import type { ConfigType } from '@nestjs/config'
import type { Counter } from '@prometheus-io/client'
import { sql } from 'drizzle-orm'
import { fromDrizzle, type JobWithMetadata, PgBoss } from 'pg-boss'
import { z } from 'zod'
import { DB } from '../common/database/database.js'
import { PG_BOSS } from '../common/jobs/jobs.module.js'
import { Metrics } from '../common/metrics/metrics.js'
import { llmConfig } from '../config/config.js'
import type { PoolModelConfig } from '../config/env.js'
import { CvGenerateJob } from '../cv-generation/cv-generate.job.js'
import type { Db, Tx, VacancyRow } from '../db/types.js'
import { LLM_CALL_TIMEOUT_MS, LlmGatewayClient } from '../llm/llm-gateway.client.js'
import { LlmCallError } from '../llm/llm-gateway.js'
import { afterFailure, assignQueues } from '../llm/model-pool.js'
import { ModelPoolRepository } from '../llm/model-pool.repository.js'
import { PARSE_PROMPT_VERSION, PARSE_SYSTEM_PROMPT, parseUserMessage } from './parse.prompt.js'
import { parsedVacancySchema } from './parse.schemas.js'
import { LEGACY_PARSE_QUEUE, parseQueueName } from './parse-pool.js'
import { VacanciesRepository } from './vacancies.repository.js'

/** Above one gateway call (its wait for a provider slot included) plus the reads and the write. */
const EXPIRE_SECONDS = LLM_CALL_TIMEOUT_MS / 1000 + 60

const payloadSchema = z.object({
    vacancyId: z.uuid(),
    /** The model whose provider was out: the job already moved once. */
    movedFrom: z.string().max(100).optional(),
})

type ParseResult = 'parsed' | 'failed' | 'retry' | 'moved' | 'skipped'

type PoolModel = PoolModelConfig & {
    queue: string
}

/** Title and company fit their 200-character columns (and the applications'). */
export const clip = (value: string | null) => (value ?? '').trim().slice(0, 200)

/**
 * `vacancy.parse.<model> { vacancyId }`: a model of the pool (`LLM_PARSE_MODELS`)
 * reads the vacancy's text through the LLM gateway and fills `parsed` (with
 * `_meta`: model, effort, prompt version), `title`, `company`, and the company
 * and role of the applications on it that have none. One queue per model, each
 * pod works it with the model's concurrency; the gateway caps each provider
 * across all its clients, so extra calls wait there. Each queue is `stately`
 * with the vacancy id as `singletonKey`, and `request` keeps a vacancy in one
 * queue at a time, so two parses of one vacancy never write at the same time.
 * A provider out of quota or down moves the job to another model once; other
 * retryable failures back off on the same queue over a few minutes.
 */
@Injectable()
export class VacancyParseJob implements OnModuleInit, OnApplicationBootstrap {
    private readonly logger = new Logger(VacancyParseJob.name)
    private readonly results: Counter<'result' | 'model'>
    private readonly pool: PoolModel[]

    constructor(
        @Inject(PG_BOSS) private readonly boss: PgBoss,
        @Inject(DB) private readonly db: Db,
        private readonly repository: VacanciesRepository,
        private readonly pools: ModelPoolRepository,
        private readonly llm: LlmGatewayClient,
        private readonly cvs: CvGenerateJob,
        @Inject(llmConfig.KEY) config: ConfigType<typeof llmConfig>,
        metrics: Metrics,
    ) {
        this.pool = config.parseModels.map(model => ({
            ...model,
            queue: parseQueueName(model.model),
        }))
        this.results = metrics.counter({
            name: 'vacancy_parse_total',
            help: 'Vacancy parse attempts by model and result: parsed, failed, retry (tried again on the same model), moved (to another model), skipped.',
            labelNames: [
                'result',
                'model',
            ],
        })
    }

    /** Every queue of the job, the legacy one included. */
    get queues(): string[] {
        return [
            ...this.pool.map(model => model.queue),
            LEGACY_PARSE_QUEUE,
        ]
    }

    /** The queues exist before the first request can send to them. */
    async onModuleInit() {
        for (const queue of this.queues)
            await this.boss.createQueue(queue, {
                policy: 'stately',
                retryLimit: 5,
                retryDelay: 5,
                retryBackoff: true,
                retryDelayMax: 300,
                expireInSeconds: EXPIRE_SECONDS,
            })
    }

    async onApplicationBootstrap() {
        for (const model of this.pool)
            await this.boss.work(
                model.queue,
                {
                    pollingIntervalSeconds: 1,
                    localConcurrency: model.concurrency,
                    includeMetadata: true,
                },
                async ([job]) => {
                    if (!job) return
                    const result = await this.run(job, model)
                    this.results.inc({
                        result,
                        model: model.model,
                    })
                },
            )
        await this.boss.work(
            LEGACY_PARSE_QUEUE,
            {
                pollingIntervalSeconds: 5,
                localConcurrency: 1,
            },
            async ([job]) => {
                if (job) await this.drainLegacy(job.id, job.data)
            },
        )
    }

    /**
     * Queues a parse of each vacancy, committed or rolled back with `tx`.
     * Singleton across the queues: under the vacancy's row lock, a vacancy
     * that already has a live parse in a queue goes to that queue again
     * (where `stately` dedups it); any other goes to the least loaded queue.
     * A `move` goes to another model's queue and skips a vacancy that is
     * already queued again in the queue it leaves: that parse runs anyway.
     */
    async request(
        tx: Tx,
        vacancyIds: string[],
        move?: {
            from: PoolModel
        },
    ): Promise<Map<string, string>> {
        const ids = [
            ...new Set(vacancyIds),
        ].sort()
        await this.repository.lockForParse(tx, ids)
        const all = this.pool.map(model => model.queue)
        const load = await this.pools.load(tx, all)
        const live = await this.pools.live(tx, all, ids)
        const targets = move ? all.filter(queue => queue !== move.from.queue) : all
        const assigned = assignQueues(
            targets,
            load,
            ids.filter(id => !(move && live.get(id)?.queued && live.get(id)?.queue === move.from.queue)),
            new Map(
                [
                    ...live,
                ].map(([id, job]) => [
                    id,
                    job.queue,
                ]),
            ),
        )
        for (const [vacancyId, queue] of assigned)
            await this.boss.send(
                queue,
                {
                    vacancyId,
                    ...(move
                        ? {
                              movedFrom: move.from.model,
                          }
                        : {}),
                },
                {
                    singletonKey: vacancyId,
                    db: fromDrizzle(tx, sql),
                },
            )
        return assigned
    }

    private async run(job: JobWithMetadata<unknown>, model: PoolModel): Promise<ParseResult> {
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
        const { vacancyId, movedFrom } = payload.data
        const vacancy = await this.repository.findById(vacancyId)
        if (!vacancy) return 'skipped'
        if (vacancy.rawText === '') {
            // The fetch (`vacancy.fetch`) ran first and found no text either.
            await this.repository.markFailed(vacancyId, 'no_text')
            this.logFailure(job, vacancyId, 'no_text')
            return 'failed'
        }
        try {
            await this.parse(job, vacancy, model)
            return 'parsed'
        } catch (error) {
            const failure = error instanceof LlmCallError ? error : undefined
            // Anything else (Postgres down, a bug): pg-boss retries it and the vacancy stays `pending`.
            if (!failure) throw error
            const next = afterFailure(failure, {
                retryCount: job.retryCount,
                retryLimit: job.retryLimit,
                canMove: movedFrom === undefined && this.pool.length > 1,
            })
            if (next === 'move') return this.move(job, vacancyId, model, failure)
            if (next === 'retry') {
                this.logger.warn(
                    {
                        jobId: job.id,
                        vacancyId,
                        model: model.model,
                        code: failure.code,
                        retryCount: job.retryCount,
                    },
                    'Vacancy parse failed, retrying',
                )
                this.results.inc({
                    result: 'retry',
                    model: model.model,
                })
                throw failure
            }
            await this.repository.markFailed(vacancyId, failure.code)
            this.logFailure(job, vacancyId, failure.code)
            return 'failed'
        }
    }

    /** The provider of `from` is out: the vacancy goes to another model's queue, and this job completes. */
    private async move(
        job: JobWithMetadata<unknown>,
        vacancyId: string,
        from: PoolModel,
        failure: LlmCallError,
    ): Promise<ParseResult> {
        const assigned = await this.db.transaction(tx =>
            this.request(
                tx,
                [
                    vacancyId,
                ],
                {
                    from,
                },
            ),
        )
        this.logger.warn(
            {
                jobId: job.id,
                vacancyId,
                model: from.model,
                code: failure.code,
                queue: assigned.get(vacancyId) ?? null,
            },
            'Vacancy parse provider out, moved to another model',
        )
        return 'moved'
    }

    /** A job of the queue before the pool: queued again in the pool. */
    private async drainLegacy(jobId: string, data: unknown) {
        const payload = payloadSchema.safeParse(data)
        if (!payload.success) {
            this.logger.warn(
                {
                    jobId,
                },
                'Vacancy parse job with an invalid payload dropped',
            )
            return
        }
        const assigned = await this.db.transaction(tx =>
            this.request(tx, [
                payload.data.vacancyId,
            ]),
        )
        this.logger.log(
            {
                jobId,
                vacancyId: payload.data.vacancyId,
                queue: assigned.get(payload.data.vacancyId) ?? null,
            },
            'Legacy vacancy parse job moved to the pool',
        )
    }

    private async parse(job: JobWithMetadata<unknown>, vacancy: VacancyRow, model: PoolModel) {
        const startedAt = performance.now()
        const { output, promptTokens, completionTokens } = await this.llm.complete({
            model: model.model,
            reasoningEffort: model.effort,
            system: PARSE_SYSTEM_PROMPT,
            user: parseUserMessage(vacancy.rawText, vacancy.url),
            schema: parsedVacancySchema,
            schemaName: 'parsed_vacancy',
            purpose: 'vacancy-parse',
            // Retries of this job reuse a successful answer the gateway already has.
            idempotencyKey: `vacancy-parse-${job.id}`,
            signal: job.signal,
        })
        // The CVs of the applications that have none are queued with the parse, or neither is saved.
        const cvs = await this.db.transaction(async tx => {
            await this.repository.saveParsed(tx, vacancy.id, {
                parsed: {
                    ...output,
                    _meta: {
                        model: model.model,
                        effort: model.effort,
                        promptVersion: PARSE_PROMPT_VERSION,
                    },
                },
                title: clip(output.title),
                company: clip(output.company),
            })
            return this.cvs.requestFirstVersions(tx, vacancy.id)
        })
        this.logger.log(
            {
                jobId: job.id,
                vacancyId: vacancy.id,
                model: model.model,
                effort: model.effort,
                promptVersion: PARSE_PROMPT_VERSION,
                promptTokens,
                completionTokens,
                cvs,
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
