import { Readable } from 'node:stream'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { Controller, Get, Header, Res, StreamableFile } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AccessClaims } from '@nick-lukashik/auth'
import { Caller } from '@nick-lukashik/auth/nest'
import type { Response } from 'express'
import { Invited } from '../access/invited.guard.js'
import { ApiErrors } from '../common/openapi/openapi.js'
import { RequestBudget } from '../request-budget.js'
import { TEX_RENDER_TIMEOUT_MS } from '../tex/tailor-tex.client.js'
import { MasterCvService } from './master-cv.service.js'

/** Above the render's own 60 s, so tailor-tex's answer (or the client's timeout) comes first. */
export const MASTER_CV_REQUEST_BUDGET_MS = TEX_RENDER_TIMEOUT_MS + 5_000

@ApiTags('profile')
@Controller('profile')
@Invited()
export class MasterCvController {
    constructor(private readonly masterCv: MasterCvService) {}

    @Get('cv.pdf')
    @RequestBudget(MASTER_CV_REQUEST_BUDGET_MS)
    @Header('cache-control', 'private, no-store')
    @ApiOperation({
        summary: 'The master CV: a PDF of the profile without a vacancy, built by tailor-tex (up to 65 s)',
    })
    @ApiOkResponse({
        description: 'The PDF, inline, named `<First>-<Last>-<Role>-CV.pdf`',
        content: {
            'application/pdf': {
                schema: {
                    type: 'string',
                    format: 'binary',
                },
            },
        },
    })
    @ApiErrors(401, 403, 404, 422)
    async pdf(
        @Caller() caller: AccessClaims,
        @Res({
            passthrough: true,
        })
        res: Response,
    ) {
        // The person went away: stop the build.
        const cancel = new AbortController()
        res.once('close', () => {
            if (!res.writableFinished) cancel.abort()
        })
        const pdf = await this.masterCv.render(caller.userId, cancel.signal)
        return new StreamableFile(Readable.fromWeb(pdf.body as NodeReadableStream<Uint8Array>), {
            type: 'application/pdf',
            disposition: `inline; filename="${pdf.fileName}"`,
            ...(pdf.length === undefined
                ? {}
                : {
                      length: pdf.length,
                  }),
        })
    }
}
