import { Inject, Injectable, Logger } from '@nestjs/common'
import type { ConfigType } from '@nestjs/config'
import { z } from 'zod'
import { AppError, type ErrorDetail } from '../common/http/app-error.js'
import { texConfig } from '../config/config.js'
import type { CvDocument, CvTemplate } from './cv-document.js'

/**
 * One render: tailor-tex's own budget is 45 s per build and 60 s per request,
 * so its 504 normally answers first; this is the last resort. The routes that
 * wait for it have a longer request budget (`@RequestBudget`).
 */
export const TEX_RENDER_TIMEOUT_MS = 60_000

export type RenderRequest = {
    document: CvDocument
    template?: CvTemplate
    maxPages?: number
}

export type RenderedPdf = {
    body: ReadableStream<Uint8Array>
    /** Bytes, when tailor-tex sent Content-Length. */
    length?: number
    pages?: number
    /** Fill of the last page, 0..1. */
    fill?: number
}

const texErrorSchema = z.object({
    code: z.string(),
    message: z.string(),
    details: z
        .array(
            z.object({
                path: z.string(),
                message: z.string(),
            }),
        )
        .optional(),
})

const numberHeader = (value: string | null) => {
    const parsed = value === null ? Number.NaN : Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
}

/** tailor-tex (internal, service token): CvDocument → PDF. */
@Injectable()
export class TailorTexClient {
    private readonly logger = new Logger(TailorTexClient.name)

    constructor(@Inject(texConfig.KEY) private readonly config: ConfigType<typeof texConfig>) {}

    /** Without TAILOR_TEX_TOKEN nothing can be built: a 503 that says why. */
    assertConfigured() {
        if (!this.config.token)
            throw new AppError('UNAVAILABLE', 'PDF rendering is not configured on this server (TAILOR_TEX_TOKEN)')
    }

    /**
     * The PDF as a stream. Errors are the contract's: 422 when the document
     * cannot be built (TeX error, too many pages, a value over a template
     * limit), 503 when tailor-tex is down or busy, 504 when it is too slow.
     * `signal` aborts the build, e.g. when the caller went away.
     */
    async render(request: RenderRequest, signal?: AbortSignal): Promise<RenderedPdf> {
        this.assertConfigured()
        const deadline = AbortSignal.timeout(TEX_RENDER_TIMEOUT_MS)
        let response: Response
        try {
            response = await fetch(`${this.config.url}/api/v1/cv/render`, {
                method: 'POST',
                headers: {
                    authorization: `Bearer ${this.config.token}`,
                    'content-type': 'application/json',
                    accept: 'application/pdf',
                },
                body: JSON.stringify(request),
                signal: signal
                    ? AbortSignal.any([
                          deadline,
                          signal,
                      ])
                    : deadline,
            })
        } catch (error) {
            if (deadline.aborted) throw new AppError('TIMEOUT', 'The CV took too long to build')
            // The caller went away: nobody reads the answer.
            if (signal?.aborted) throw new AppError('UNAVAILABLE', 'The request was cancelled')
            this.logger.warn(
                {
                    err: error,
                },
                'tailor-tex unreachable',
            )
            throw new AppError('UNAVAILABLE', 'The CV renderer is unavailable, retry later')
        }
        if (response.ok && response.body)
            return {
                body: response.body,
                length: numberHeader(response.headers.get('content-length')),
                pages: numberHeader(response.headers.get('x-pdf-pages')),
                fill: numberHeader(response.headers.get('x-pdf-fill')),
            }
        throw await this.failure(response)
    }

    private async failure(response: Response): Promise<AppError> {
        const parsed = texErrorSchema.safeParse(await response.json().catch(() => undefined))
        const body = parsed.success ? parsed.data : undefined
        const details: ErrorDetail[] | undefined = body?.details
        switch (response.status) {
            // A TeX error (the log tail in details) or more pages than maxPages.
            case 422:
                return new AppError('UNPROCESSABLE', body?.message ?? 'The CV could not be built', details)
            // The document broke a limit of the template (paths start with `document.`).
            case 400:
                return new AppError('UNPROCESSABLE', 'The profile does not fit the CV template', details)
            case 429:
                return new AppError('UNAVAILABLE', 'The CV renderer is busy, retry in a minute')
            case 504:
                return new AppError('TIMEOUT', 'The CV took too long to build')
            default:
                // 401 (a wrong token), 5xx: nothing the person can fix.
                this.logger.warn(
                    {
                        status: response.status,
                        code: body?.code,
                    },
                    'tailor-tex failed',
                )
                return new AppError('UNAVAILABLE', 'The CV renderer is unavailable, retry later')
        }
    }
}
