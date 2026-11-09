import { Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common'
import { ApiAcceptedResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AccessClaims } from '@nick-lukashik/auth'
import { Caller } from '@nick-lukashik/auth/nest'
import { z } from 'zod'
import { TailorAccess } from '../access/tailor-role.guard.js'
import { notFound } from '../common/http/app-error.js'
import { ApiErrors } from '../common/openapi/openapi.js'
import { type ApplicationMaterials, applicationMaterialsSchema } from './materials.schemas.js'
import { MaterialsGenerateJob } from './materials-generate.job.js'

const uuid = z.uuid()

/** New materials of one of the caller's applications; GET /applications/:id shows how it goes. */
@ApiTags('applications')
@Controller('applications')
@TailorAccess()
export class MaterialsController {
    constructor(private readonly job: MaterialsGenerateJob) {}

    @Post(':id/materials')
    @HttpCode(HttpStatus.ACCEPTED)
    @ApiOperation({
        summary: "Queue new materials (cover letter, e-mail, messages) of one of the caller's applications",
        description:
            'Written from its newest ready CV. 409 when no CV is ready or a version is still queued or generating.',
    })
    @ApiAcceptedResponse({
        standardSchema: applicationMaterialsSchema,
    })
    @ApiErrors(401, 403, 404, 409)
    async create(@Caller() caller: AccessClaims, @Param('id') id: string): Promise<ApplicationMaterials> {
        if (!uuid.safeParse(id).success) throw notFound('Application')
        const row = await this.job.requestVersion(id, caller.userId)
        return {
            status: 'queued',
            version: row.version,
            updatedAt: row.updatedAt.toISOString(),
        }
    }
}
