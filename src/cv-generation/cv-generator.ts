import { Readable } from 'node:stream'
import { buffer } from 'node:stream/consumers'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { Injectable, Logger } from '@nestjs/common'
import { AppError } from '../common/http/app-error.js'
import { modelSlug, type PoolModelConfig } from '../config/env.js'
import { cvFileName } from '../cv/cv-file-name.js'
import { LlmGatewayClient } from '../llm/llm-gateway.client.js'
import { cvHeadline, cvName, masterCvIssues } from '../master-cv/master-cv.js'
import type { ProfileDocument } from '../profile/profile.schemas.js'
import { ObjectStorage, StorageError } from '../storage/object-storage.js'
import type { CvDocument, CvMeasurement } from '../tex/cv-document.js'
import { TailorTexClient } from '../tex/tailor-tex.client.js'
import type { ParsedVacancy } from '../vacancies/parse.schemas.js'
import { type Analysis, decideAiRole, groundAnalysis, planEmployments } from './analysis.js'
import { composeJobs, composeSkills, composeSummary, type TailoredContent, tailoredSummarySource } from './compose.js'
import {
    analysisSystemPrompt,
    analysisUserMessage,
    compositionSystemPrompt,
    compositionUserMessage,
} from './cv.prompts.js'
import { analysisAnswerSchema, compositionAnswerSchema } from './cv-generation.schemas.js'
import { fitCv } from './fitting.js'
import { missingSkills } from './skills.js'
import { buildTailoredCv, bulletId, initialFitState } from './tailored-cv.js'

/**
 * A step that cannot go on, with a short code stored on the CV. `retryable`:
 * tailor-tex or R2 down or slow, worth another try of the job.
 */
export class CvGenerationError extends Error {
    constructor(
        readonly code: string,
        readonly retryable: boolean,
    ) {
        super(`CV generation failed: ${code}`)
        this.name = 'CvGenerationError'
    }
}

export type GenerationInput = {
    cvId: string
    applicationId: string
    model: PoolModelConfig
    profile: ProfileDocument
    parsed: ParsedVacancy
    rawText: string
    /** Called once the analysis is done, before the slower steps. */
    onAnalysis: (analysis: Analysis) => Promise<void>
    signal?: AbortSignal
}

export type GeneratedCv = {
    document: CvDocument
    fileKey: string
    fileName: string
    role: string
    pages: number
    builds: number
    nearMiss: boolean
    sourcedBullets: number
}

const TEMPLATE = 'minimal-violet'

/** A failure of tailor-tex as a short code: busy, down or slow is retried, a document it cannot build is not. */
function texFailure(error: unknown): never {
    if (error instanceof AppError) {
        if (error.code === 'TIMEOUT') throw new CvGenerationError('tex_timeout', true)
        if (error.code === 'UNPROCESSABLE') throw new CvGenerationError('tex_unprocessable', false)
        throw new CvGenerationError('tex_unavailable', true)
    }
    throw error
}

/**
 * The pipeline of one CV version, ported from Work Finder's resume
 * generation (generate-v2.ts): (1) the vacancy's requirements against the
 * case bank, (2) the composition, (3) the document in code, (4) the fit in
 * tailor-tex, (5) the PDF to R2. Two model calls; prompts, texts and answers
 * are never logged.
 */
@Injectable()
export class CvGenerator {
    private readonly logger = new Logger(CvGenerator.name)

    constructor(
        private readonly llm: LlmGatewayClient,
        private readonly tex: TailorTexClient,
        private readonly storage: ObjectStorage,
    ) {}

    async generate(input: GenerationInput): Promise<GeneratedCv> {
        const { profile, parsed, model } = input
        const additions = profile.settings.promptAdditions.cv
        const title = (parsed.title ?? '').trim()
        const slug = modelSlug(model.model)

        const answer = await this.llm.complete({
            model: model.model,
            reasoningEffort: model.effort,
            system: analysisSystemPrompt(additions),
            user: analysisUserMessage(profile, parsed, input.rawText),
            schema: analysisAnswerSchema,
            schemaName: 'cv_analysis',
            purpose: 'cv-analyze',
            // A retry of this version on the same model reuses the gateway's stored answer.
            idempotencyKey: `cv-analyze-${input.cvId}-${slug}`,
            signal: input.signal,
        })
        const grounded = groundAnalysis(answer.output, profile.cases)
        const analysis: Analysis = {
            aiRole: decideAiRole(title, grounded.modelAiRole),
            aiRoleReason: grounded.aiRoleReason,
            requirements: grounded.requirements,
            matches: grounded.matches,
        }
        await input.onAnalysis(analysis)

        const plans = planEmployments(profile, title, analysis)
        const summary = tailoredSummarySource(profile, analysis.aiRole)
        const skillRows = profile.skills.filter(row => analysis.aiRole || !row.aiOnly)
        const composition = await this.llm.complete({
            model: model.model,
            reasoningEffort: model.effort,
            system: compositionSystemPrompt(additions),
            user: compositionUserMessage({
                profile,
                parsed,
                rawText: input.rawText,
                analysis,
                plans,
                summary,
                skills: skillRows,
            }),
            schema: compositionAnswerSchema,
            schemaName: 'cv_composition',
            purpose: 'cv-compose',
            idempotencyKey: `cv-compose-${input.cvId}-${slug}`,
            signal: input.signal,
        })
        const vacancySkills = parsed.skills.filter(skill => skill.name.trim())
        const content: TailoredContent = {
            summary: composeSummary(profile, analysis.aiRole, composition.output.summary),
            jobs: composeJobs(plans, composition.output.employments),
            skills: composeSkills(profile, analysis.aiRole, composition.output.skills, vacancySkills, analysis),
        }

        const headline = (title || cvHeadline(profile)).slice(0, 120).trim()
        const caseIndex = new Map(
            profile.cases.map((item, index) => [
                item.id,
                index,
            ]),
        )
        const meta = {
            headline,
            keywords: [
                ...vacancySkills.map(skill => skill.name),
                ...profile.skills.flatMap(row => row.items.filter(item => item.core).map(item => item.name)),
            ],
        }
        const build = (state: ReturnType<typeof initialFitState>) => buildTailoredCv(profile, content, state, meta)
        const issues = masterCvIssues(build(initialFitState()))
        if (issues.length) {
            this.logger.warn(
                {
                    cvId: input.cvId,
                    paths: issues.map(issue => issue.path),
                },
                'Tailored CV document invalid',
            )
            throw new CvGenerationError('cv_invalid_document', false)
        }

        const fit = await fitCv(
            {
                content,
                maxPages: profile.settings.maxPages,
                build,
                bulletIds: new Map(
                    content.jobs.flatMap(job =>
                        job.bullets.map(bullet => [
                            bullet.caseId,
                            bulletId(bullet.caseId, caseIndex.get(bullet.caseId) ?? 0),
                        ]),
                    ),
                ),
            },
            (document): Promise<CvMeasurement> =>
                this.tex
                    .measure(
                        {
                            document,
                            template: TEMPLATE,
                            maxPages: profile.settings.maxPages,
                        },
                        input.signal,
                    )
                    .catch(texFailure),
            initialFitState(),
        )
        if (!fit.fitted) throw new CvGenerationError(fit.code, false)

        const rendered = await this.tex
            .render(
                {
                    document: fit.document,
                    template: TEMPLATE,
                    maxPages: profile.settings.maxPages,
                },
                input.signal,
            )
            .catch(texFailure)
        const pdf = await buffer(Readable.fromWeb(rendered.body as NodeReadableStream<Uint8Array>))
        const fileKey = this.storage.key(`cv/${input.applicationId}/${input.cvId}.pdf`)
        await this.storage.put(fileKey, pdf, 'application/pdf').catch((error: unknown) => {
            if (error instanceof StorageError) throw new CvGenerationError(error.code, error.retryable)
            throw error
        })
        const missing = missingSkills(content.skills, vacancySkills)
        if (missing.length)
            this.logger.warn(
                {
                    cvId: input.cvId,
                    missing: missing.length,
                },
                'Vacancy skills missing from the CV',
            )
        return {
            document: fit.document,
            fileKey,
            fileName: cvFileName(cvName(profile), title || headline),
            role: headline,
            pages: rendered.pages ?? fit.measurement.pages,
            builds: fit.builds,
            nearMiss: fit.nearMiss,
            sourcedBullets: content.jobs.flatMap(job => job.bullets).filter(bullet => bullet.sourced).length,
        }
    }
}
