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
import { llmConfig } from '../config/config.js'
import type { PoolModelConfig } from '../config/env.js'
import type { Db, Tx } from '../db/types.js'
import { LLM_CALL_TIMEOUT_MS } from '../llm/llm-gateway.client.js'
import { LlmCallError } from '../llm/llm-gateway.js'
import { afterFailure, assignQueues, poolQueueName } from '../llm/model-pool.js'
import { ModelPoolRepository } from '../llm/model-pool.repository.js'
import { ProfileService } from '../profile/profile.service.js'
import { ObjectStorage } from '../storage/object-storage.js'
import { TailorTexClient, TEX_RENDER_TIMEOUT_MS } from '../tex/tailor-tex.client.js'
import { parsedVacancySchema } from '../vacancies/parse.schemas.js'
import { CV_PROMPT_VERSION } from './cv.prompts.js'
import { CvGenerationError, CvGenerator } from './cv-generator.js'
import { CvsRepository } from './cvs.repository.js'
import { MAX_FIT_BUILDS } from './fitting.js'

/** The job of every CV model's queue: `cv.generate.<model slug>`. */
export const CV_GENERATE_JOB = 'cv.generate'

/** Two gateway calls, the fit's builds and the render, plus the reads and the upload. */
export const CV_EXPIRE_SECONDS = (2 * LLM_CALL_TIMEOUT_MS + (MAX_FIT_BUILDS + 1) * TEX_RENDER_TIMEOUT_MS) / 1000 + 60

/** A version `generating` longer than every try of its job is lost (a pod gone): a new one may start. */
export const CV_STALE_MS = 2 * CV_EXPIRE_SECONDS * 1000

const RETRY_LIMIT = 3

const payloadSchema = z.object({
    applicationId: z.uuid(),
    cvId: z.uuid(),
    /** The model whose provider was out: the job already moved once. */
    movedFrom: z.string().max(100).optional(),
})

type Result = 'ready' | 'failed' | 'retry' | 'moved' | 'skipped'

type PoolModel = PoolModelConfig & {
    queue: string
}

/**
 * `cv.generate.<model> { applicationId, cvId }`: a model of the CV pool
 * (`LLM_CV_MODELS`) generates one version of an application's CV
 * (CvGenerator) and the version becomes `ready` with its PDF in R2, or
 * `failed` with a short code. One queue per model, the emptiest at send; a
 * provider out of quota or down moves the job to another model once; tailor-tex
 * or R2 down and other retryable failures back off on the same queue.
 */
@Injectable()
export class CvGenerateJob implements OnModuleInit, OnApplicationBootstrap {
    private readonly logger = new Logger(CvGenerateJob.name)
    private readonly results: Counter<'result' | 'model'>
    private readonly pool: PoolModel[]

    constructor(
        @Inject(PG_BOSS) private readonly boss: PgBoss,
        @Inject(DB) private readonly db: Db,
        private readonly repository: CvsRepository,
        private readonly pools: ModelPoolRepository,
        private readonly generator: CvGenerator,
        private readonly profiles: ProfileService,
        private readonly storage: ObjectStorage,
        private readonly tex: TailorTexClient,
        @Inject(llmConfig.KEY) config: ConfigType<typeof llmConfig>,
        metrics: Metrics,
    ) {
        this.pool = config.cvModels.map(model => ({
            ...model,
            queue: poolQueueName(CV_GENERATE_JOB, model.model),
        }))
        this.results = metrics.counter({
            name: 'cv_generate_total',
            help: 'CV generation attempts by model and result: ready, failed, retry (tried again on the same model), moved (to another model), skipped.',
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
                expireInSeconds: CV_EXPIRE_SECONDS,
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

    /**
     * Queues the generation of each CV version, committed or rolled back with
     * `tx`: each to the queue with the fewest live jobs (or, for a move, any
     * other than the one it leaves), `singletonKey` the version's id.
     */
    async request(
        tx: Tx,
        items: {
            applicationId: string
            cvId: string
        }[],
        move?: {
            from: PoolModel
        },
    ) {
        if (items.length === 0) return
        const all = this.pool.map(model => model.queue)
        const targets = move && all.length > 1 ? all.filter(queue => queue !== move.from.queue) : all
        const assigned = assignQueues(
            targets,
            await this.pools.load(tx, all),
            items.map(item => item.cvId),
            new Map(),
        )
        for (const item of items) {
            const queue = assigned.get(item.cvId)
            const model = this.pool.find(entry => entry.queue === queue)
            if (!queue || !model) continue
            await this.repository.setModel(tx, item.cvId, model.model, model.effort)
            await this.boss.send(
                queue,
                {
                    applicationId: item.applicationId,
                    cvId: item.cvId,
                    ...(move
                        ? {
                              movedFrom: move.from.model,
                          }
                        : {}),
                },
                {
                    singletonKey: item.cvId,
                    db: fromDrizzle(tx, sql),
                },
            )
        }
    }

    /** After a parse, in its transaction: version 1 for every application of the vacancy without a CV. */
    async requestFirstVersions(tx: Tx, vacancyId: string) {
        const created = await this.repository.insertFirstVersions(tx, vacancyId)
        await this.request(
            tx,
            created.map(cv => ({
                applicationId: cv.applicationId,
                cvId: cv.id,
            })),
        )
        return created.length
    }

    /**
     * A new version of the person's application (POST /applications/:id/cv):
     * 404 when it is not theirs, 409 when its vacancy is not parsed yet or a
     * version is still queued or generating.
     */
    async requestVersion(applicationId: string, userId: string) {
        return this.db.transaction(async tx => {
            const application = await this.repository.lockOwnedApplication(tx, applicationId, userId)
            if (!application) throw new AppError('NOT_FOUND', 'Application not found')
            if (application.parseStatus !== 'parsed')
                throw new AppError('CONFLICT', 'The vacancy is not parsed yet: its CV is made once it is')
            if (await this.repository.hasLiveVersion(tx, applicationId, new Date(Date.now() - CV_STALE_MS)))
                throw new AppError('CONFLICT', 'A CV of this application is already being made')
            const cv = await this.repository.insertVersion(tx, applicationId)
            await this.request(tx, [
                {
                    applicationId,
                    cvId: cv.id,
                },
            ])
            return cv
        })
    }

    private async run(job: JobWithMetadata<unknown>, model: PoolModel): Promise<Result> {
        const payload = payloadSchema.safeParse(job.data)
        if (!payload.success) {
            this.logger.warn(
                {
                    jobId: job.id,
                },
                'CV job with an invalid payload dropped',
            )
            return 'skipped'
        }
        const { cvId, applicationId, movedFrom } = payload.data
        const found = await this.repository.findForGeneration(cvId)
        if (
            !found?.userId
            || ![
                'queued',
                'generating',
            ].includes(found.cv.status)
        )
            return 'skipped'
        const fail = async (code: string) => {
            await this.repository.markFailed(cvId, code)
            this.logger.warn(
                {
                    jobId: job.id,
                    cvId,
                    applicationId,
                    model: model.model,
                    code,
                },
                'CV generation failed',
            )
            return 'failed' as const
        }
        if (!(await this.repository.markGenerating(cvId, model.model, model.effort))) return 'skipped'
        if (!this.storage.configured) return fail('storage_not_configured')
        if (!this.tex.configured) return fail('tex_not_configured')
        const parsed =
            found.vacancy?.parseStatus === 'parsed'
                ? parsedVacancySchema.safeParse(this.answerOf(found.vacancy.parsed))
                : undefined
        if (!found.vacancy || !parsed?.success) return fail('vacancy_not_parsed')
        const profile = await this.profiles.get(found.userId).catch((error: unknown) => {
            if (error instanceof AppError && error.code === 'NOT_FOUND') return undefined
            throw error
        })
        if (!profile) return fail('no_profile')

        const startedAt = performance.now()
        try {
            const cv = await this.generator.generate({
                cvId,
                applicationId,
                model,
                profile: profile.document,
                parsed: parsed.data,
                rawText: found.vacancy.rawText,
                signal: job.signal,
                onAnalysis: analysis =>
                    this.repository.saveAnalysis(cvId, {
                        analysis,
                        aiRole: analysis.aiRole,
                        role: (parsed.data.title ?? '').trim().slice(0, 200),
                        promptVersion: CV_PROMPT_VERSION,
                        profileVersion: profile.version,
                    }),
            })
            await this.repository.markReady(cvId, {
                fileKey: cv.fileKey,
                fileName: cv.fileName,
                pages: cv.pages,
                document: cv.document,
            })
            this.logger.log(
                {
                    jobId: job.id,
                    cvId,
                    applicationId,
                    model: model.model,
                    effort: model.effort,
                    promptVersion: CV_PROMPT_VERSION,
                    profileVersion: profile.version,
                    pages: cv.pages,
                    builds: cv.builds,
                    nearMiss: cv.nearMiss,
                    sourcedBullets: cv.sourcedBullets,
                    unchangedBullets: cv.unchangedBullets,
                    ms: Math.round(performance.now() - startedAt),
                },
                'CV ready',
            )
            return 'ready'
        } catch (error) {
            const lastTry = job.retryCount >= job.retryLimit
            if (error instanceof LlmCallError) {
                const next = afterFailure(error, {
                    retryCount: job.retryCount,
                    retryLimit: job.retryLimit,
                    canMove: movedFrom === undefined && this.pool.length > 1,
                })
                if (next === 'move') return this.move(job, applicationId, cvId, model, error.code)
                if (next === 'retry') return this.retry(job, cvId, model, error.code, error)
                return fail(error.code)
            }
            if (error instanceof CvGenerationError) {
                if (error.retryable && !lastTry) return this.retry(job, cvId, model, error.code, error)
                return fail(error.code)
            }
            // Postgres down, a bug: pg-boss retries it; the last try leaves no version generating forever.
            if (lastTry) return fail('internal')
            throw error
        }
    }

    /** `parsed` without `_meta`. */
    private answerOf(stored: unknown) {
        if (!stored || typeof stored !== 'object') return stored
        const { _meta: _ignored, ...answer } = stored as Record<string, unknown>
        return answer
    }

    private retry(job: JobWithMetadata<unknown>, cvId: string, model: PoolModel, code: string, error: Error): never {
        this.logger.warn(
            {
                jobId: job.id,
                cvId,
                model: model.model,
                code,
                retryCount: job.retryCount,
            },
            'CV generation failed, retrying',
        )
        this.results.inc({
            result: 'retry',
            model: model.model,
        })
        throw error
    }

    /** The provider of `from` is out: the version goes to another model's queue, and this job completes. */
    private async move(
        job: JobWithMetadata<unknown>,
        applicationId: string,
        cvId: string,
        from: PoolModel,
        code: string,
    ): Promise<Result> {
        await this.db.transaction(tx =>
            this.request(
                tx,
                [
                    {
                        applicationId,
                        cvId,
                    },
                ],
                {
                    from,
                },
            ),
        )
        this.logger.warn(
            {
                jobId: job.id,
                cvId,
                model: from.model,
                code,
            },
            'CV generation provider out, moved to another model',
        )
        return 'moved'
    }
}
