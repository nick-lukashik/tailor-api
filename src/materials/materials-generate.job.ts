import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleInit } from '@nestjs/common'
import type { ConfigType } from '@nestjs/config'
import type { Counter } from '@prometheus-io/client'
import { sql } from 'drizzle-orm'
import { fromDrizzle, type JobWithMetadata, PgBoss } from 'pg-boss'
import { z } from 'zod'
import { DB } from '../common/database/database.js'
import { AppError } from '../common/http/app-error.js'
import { PG_BOSS } from '../common/jobs/jobs.module.js'
import { Metrics } from '../common/metrics/metrics.js'
import { cvConfig, llmConfig } from '../config/config.js'
import { modelSlug, type PoolModelConfig } from '../config/env.js'
import type { Db, Tx } from '../db/types.js'
import { LLM_CALL_TIMEOUT_MS, LlmGatewayClient } from '../llm/llm-gateway.client.js'
import { LlmCallError } from '../llm/llm-gateway.js'
import { afterFailure, assignQueues, poolQueueName } from '../llm/model-pool.js'
import { ModelPoolRepository } from '../llm/model-pool.repository.js'
import { ProfileService } from '../profile/profile.service.js'
import { cvDocumentSchema } from '../tex/cv-document.js'
import { parsedVacancySchema } from '../vacancies/parse.schemas.js'
import { finishMaterials, materialsLanguage } from './materials.js'
import { MATERIALS_PROMPT_VERSION, materialsSystemPrompt, materialsUserMessage } from './materials.prompts.js'
import { MaterialsRepository } from './materials.repository.js'
import { materialsAnswerSchema } from './materials.schemas.js'

/** The job of every letters model's queue: `materials.generate.<model slug>`. */
export const MATERIALS_GENERATE_JOB = 'materials.generate'

/** One gateway call plus the reads and the write. */
export const MATERIALS_EXPIRE_SECONDS = LLM_CALL_TIMEOUT_MS / 1000 + 60

/** A version `generating` longer than every try of its job is lost (a pod gone): a new one may start. */
export const MATERIALS_STALE_MS = 2 * MATERIALS_EXPIRE_SECONDS * 1000

const RETRY_LIMIT = 3

const payloadSchema = z.object({
    applicationId: z.uuid(),
    materialsId: z.uuid(),
    /** The model whose provider was out: the job already moved once. */
    movedFrom: z.string().max(100).optional(),
})

type Result = 'ready' | 'failed' | 'retry' | 'moved' | 'skipped'

type PoolModel = PoolModelConfig & {
    queue: string
}

/**
 * `materials.generate.<model> { applicationId, materialsId }`: a model of the
 * letters pool (`LLM_LETTERS_MODELS`) writes the texts for applying by hand
 * from one ready CV version, its vacancy and the profile; the version becomes
 * `ready` with its content or `failed` with a short code. Queued when a CV
 * version becomes ready and on POST /applications/:id/materials. The pool as
 * in the CV job: the emptiest queue, a provider outage moving the job once.
 */
@Injectable()
export class MaterialsGenerateJob implements OnModuleInit, OnApplicationBootstrap {
    private readonly logger = new Logger(MaterialsGenerateJob.name)
    private readonly results: Counter<'result' | 'model'>
    private readonly pool: PoolModel[]

    constructor(
        @Inject(PG_BOSS) private readonly boss: PgBoss,
        @Inject(DB) private readonly db: Db,
        private readonly repository: MaterialsRepository,
        private readonly pools: ModelPoolRepository,
        private readonly llm: LlmGatewayClient,
        private readonly profiles: ProfileService,
        @Inject(llmConfig.KEY) config: ConfigType<typeof llmConfig>,
        @Inject(cvConfig.KEY) private readonly cv: ConfigType<typeof cvConfig>,
        metrics: Metrics,
    ) {
        this.pool = config.lettersModels.map(model => ({
            ...model,
            queue: poolQueueName(MATERIALS_GENERATE_JOB, model.model),
        }))
        this.results = metrics.counter({
            name: 'materials_generate_total',
            help: 'Materials generation attempts by model and result: ready, failed, retry (tried again on the same model), moved (to another model), skipped.',
            labelNames: [
                'result',
                'model',
            ],
        })
    }

    get queues(): string[] {
        return this.pool.map(model => model.queue)
    }

    async onModuleInit() {
        for (const queue of this.queues)
            await this.boss.createQueue(queue, {
                policy: 'stately',
                retryLimit: RETRY_LIMIT,
                retryDelay: 10,
                retryBackoff: true,
                retryDelayMax: 300,
                expireInSeconds: MATERIALS_EXPIRE_SECONDS,
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
    }

    /** Sends a version to the queue with the fewest live jobs (for a move, any other than the one it leaves), with `tx`. */
    private async send(
        tx: Tx,
        item: {
            applicationId: string
            materialsId: string
        },
        move?: {
            from: PoolModel
        },
    ) {
        const all = this.pool.map(model => model.queue)
        const targets = move && all.length > 1 ? all.filter(queue => queue !== move.from.queue) : all
        const assigned = assignQueues(
            targets,
            await this.pools.load(tx, all),
            [
                item.materialsId,
            ],
            new Map(),
        )
        const queue = assigned.get(item.materialsId)
        const model = this.pool.find(entry => entry.queue === queue)
        if (!queue || !model) return
        await this.repository.setModel(tx, item.materialsId, model.model, model.effort)
        await this.boss.send(
            queue,
            {
                ...item,
                ...(move
                    ? {
                          movedFrom: move.from.model,
                      }
                    : {}),
            },
            {
                singletonKey: item.materialsId,
                db: fromDrizzle(tx, sql),
            },
        )
    }

    /** A CV version just became ready, in that transaction: a new materials version written from it. */
    async requestForCv(tx: Tx, applicationId: string, cvId: string) {
        const row = await this.repository.insertVersion(tx, applicationId, cvId)
        await this.send(tx, {
            applicationId,
            materialsId: row.id,
        })
        return row
    }

    /**
     * New materials for the person's application from its newest ready CV
     * (POST /applications/:id/materials): 404 when it is not theirs, 409 when
     * no CV is ready yet or a version is still queued or generating.
     */
    async requestVersion(applicationId: string, userId: string) {
        return this.db.transaction(async tx => {
            if (!(await this.repository.lockOwnedApplication(tx, applicationId, userId)))
                throw new AppError('NOT_FOUND', 'Application not found')
            const cv = await this.repository.latestReadyCv(tx, applicationId)
            if (!cv) throw new AppError('CONFLICT', 'No CV of this application is ready: its materials follow it')
            if (await this.repository.hasLiveVersion(tx, applicationId, new Date(Date.now() - MATERIALS_STALE_MS)))
                throw new AppError('CONFLICT', 'The materials of this application are already being written')
            return this.requestForCv(tx, applicationId, cv.id)
        })
    }

    private async run(job: JobWithMetadata<unknown>, model: PoolModel): Promise<Result> {
        const payload = payloadSchema.safeParse(job.data)
        if (!payload.success) {
            this.logger.warn(
                {
                    jobId: job.id,
                },
                'Materials job with an invalid payload dropped',
            )
            return 'skipped'
        }
        const { materialsId, applicationId, movedFrom } = payload.data
        const found = await this.repository.findForGeneration(materialsId)
        if (
            !found?.userId
            || ![
                'queued',
                'generating',
            ].includes(found.materials.status)
        )
            return 'skipped'
        const fail = async (code: string) => {
            await this.repository.markFailed(materialsId, code)
            this.logger.warn(
                {
                    jobId: job.id,
                    materialsId,
                    applicationId,
                    model: model.model,
                    code,
                },
                'Materials generation failed',
            )
            return 'failed' as const
        }
        if (!(await this.repository.markGenerating(materialsId, model.model, model.effort))) return 'skipped'
        const parsed =
            found.vacancy?.parseStatus === 'parsed'
                ? parsedVacancySchema.safeParse(answerOf(found.vacancy.parsed))
                : undefined
        if (!found.vacancy || !parsed?.success) return fail('vacancy_not_parsed')
        const document = cvDocumentSchema.safeParse(found.cv.document)
        if (found.cv.status !== 'ready' || !found.cv.fileName || !document.success) return fail('cv_not_ready')
        const profile = await this.profiles.get(found.userId).catch((error: unknown) => {
            if (error instanceof AppError && error.code === 'NOT_FOUND') return undefined
            throw error
        })
        if (!profile) return fail('no_profile')

        const language = materialsLanguage(parsed.data, found.vacancy.rawText)
        const startedAt = performance.now()
        try {
            const answer = await this.llm.complete({
                model: model.model,
                reasoningEffort: model.effort,
                system: materialsSystemPrompt(language, profile.document.settings.promptAdditions.letters),
                user: materialsUserMessage({
                    profile: profile.document,
                    parsed: parsed.data,
                    rawText: found.vacancy.rawText,
                    cv: document.data,
                    language,
                }),
                schema: materialsAnswerSchema,
                schemaName: 'application_materials',
                purpose: 'materials',
                // A retry of this version on the same model reuses the gateway's stored answer.
                idempotencyKey: `materials-${materialsId}-${modelSlug(model.model)}`,
                signal: job.signal,
            })
            await this.repository.markReady(materialsId, {
                content: finishMaterials(answer.output, {
                    cvUrl: `${this.cv.publicUrl}/${applicationId}/${found.cv.fileName}`,
                    language,
                }),
                promptVersion: MATERIALS_PROMPT_VERSION,
            })
            this.logger.log(
                {
                    jobId: job.id,
                    materialsId,
                    applicationId,
                    model: model.model,
                    effort: model.effort,
                    promptVersion: MATERIALS_PROMPT_VERSION,
                    language,
                    ms: Math.round(performance.now() - startedAt),
                },
                'Materials ready',
            )
            return 'ready'
        } catch (error) {
            if (error instanceof LlmCallError) {
                const next = afterFailure(error, {
                    retryCount: job.retryCount,
                    retryLimit: job.retryLimit,
                    canMove: movedFrom === undefined && this.pool.length > 1,
                })
                if (next === 'move') {
                    await this.db.transaction(tx =>
                        this.send(
                            tx,
                            {
                                applicationId,
                                materialsId,
                            },
                            {
                                from: model,
                            },
                        ),
                    )
                    this.logger.warn(
                        {
                            jobId: job.id,
                            materialsId,
                            model: model.model,
                            code: error.code,
                        },
                        'Materials provider out, moved to another model',
                    )
                    return 'moved'
                }
                if (next === 'retry') {
                    this.logger.warn(
                        {
                            jobId: job.id,
                            materialsId,
                            model: model.model,
                            code: error.code,
                            retryCount: job.retryCount,
                        },
                        'Materials generation failed, retrying',
                    )
                    this.results.inc({
                        result: 'retry',
                        model: model.model,
                    })
                    throw error
                }
                return fail(error.code)
            }
            // Postgres down, a bug: pg-boss retries it; the last try leaves no version generating forever.
            if (job.retryCount >= job.retryLimit) return fail('internal')
            throw error
        }
    }
}

/** `parsed` without `_meta`. */
function answerOf(stored: unknown) {
    if (!stored || typeof stored !== 'object') return stored
    const { _meta: _ignored, ...answer } = stored as Record<string, unknown>
    return answer
}
