import { Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common'
import { ApiAcceptedResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AccessClaims } from '@nick-lukashik/auth'
import { Caller } from '@nick-lukashik/auth/nest'
import { z } from 'zod'
import { TailorAccess } from '../access/tailor-role.guard.js'
import { type ApplicationCv, applicationCvSchema } from '../applications/applications.schemas.js'
import { notFound } from '../common/http/app-error.js'
import { ApiErrors } from '../common/openapi/openapi.js'
import { CvGenerateJob } from './cv-generate.job.js'

const uuid = z.uuid()

/** A new CV version of one of the caller's applications; GET /applications/:id shows how it goes. */
@ApiTags('applications')
@Controller('applications')
@TailorAccess()
export class CvGenerationController {
    constructor(private readonly job: CvGenerateJob) {}

    @Post(':id/cv')
    @HttpCode(HttpStatus.ACCEPTED)
    @ApiOperation({
        summary: "Queue a new version of the CV of one of the caller's applications, tailored to its vacancy",
        description: '409 when the vacancy is not parsed yet or a version is still queued or generating.',
    })
    @ApiAcceptedResponse({
        standardSchema: applicationCvSchema,
    })
    @ApiErrors(401, 403, 404, 409)
    async create(@Caller() caller: AccessClaims, @Param('id') id: string): Promise<ApplicationCv> {
        if (!uuid.safeParse(id).success) throw notFound('Application')
        const cv = await this.job.requestVersion(id, caller.userId)
        return {
            status: 'queued',
            version: cv.version,
            updatedAt: cv.updatedAt.toISOString(),
        }
    }
}
