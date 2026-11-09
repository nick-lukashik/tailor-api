import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common'
import { ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AccessClaims } from '@nick-lukashik/auth'
import { Caller } from '@nick-lukashik/auth/nest'
import { TailorAccess } from '../access/tailor-role.guard.js'
import { ApiErrors } from '../common/openapi/openapi.js'
import {
    applicationDetailSchema,
    applicationListSchema,
    applicationSchema,
    type CreateApplication,
    createApplicationSchema,
    type ListApplicationsQuery,
    listApplicationsQuerySchema,
    type UpdateApplication,
    updateApplicationSchema,
} from './applications.schemas.js'
import { ApplicationsService } from './applications.service.js'

/** The caller's own applications. Thin: validation by schema on the parameter, the rest in ApplicationsService. */
@ApiTags('applications')
@ApiHeader({
    name: 'x-request-id',
    required: false,
    description: 'Echoed back; generated when absent',
})
@Controller('applications')
@TailorAccess()
export class ApplicationsController {
    constructor(private readonly applications: ApplicationsService) {}

    @Get()
    @ApiOperation({
        summary: "The caller's applications, newest first, cursor pagination",
    })
    @ApiOkResponse({
        standardSchema: applicationListSchema,
    })
    @ApiErrors(400, 401, 403)
    list(
        @Caller() caller: AccessClaims,
        @Query({
            schema: listApplicationsQuerySchema,
        })
        query: ListApplicationsQuery,
    ) {
        return this.applications.list(caller.userId, query)
    }

    @Get(':id')
    @ApiOperation({
        summary: "One of the caller's applications with its vacancy (text and parse) and CV status",
    })
    @ApiOkResponse({
        standardSchema: applicationDetailSchema,
    })
    @ApiErrors(401, 403, 404)
    get(@Caller() caller: AccessClaims, @Param('id') id: string) {
        return this.applications.get(id, caller.userId)
    }

    @Patch(':id')
    @ApiOperation({
        summary: "Set the status of one of the caller's applications, e.g. sent once they applied",
    })
    @ApiOkResponse({
        standardSchema: applicationSchema,
    })
    @ApiErrors(400, 401, 403, 404)
    update(
        @Caller() caller: AccessClaims,
        @Param('id') id: string,
        @Body({
            schema: updateApplicationSchema,
        })
        body: UpdateApplication,
    ) {
        return this.applications.updateStatus(id, caller.userId, body)
    }

    @Post()
    @HttpCode(HttpStatus.CREATED)
    @ApiCreatedResponse({
        standardSchema: applicationSchema,
    })
    @ApiErrors(400, 401, 403, 413)
    create(
        @Caller() caller: AccessClaims,
        @Body({
            schema: createApplicationSchema,
        })
        body: CreateApplication,
    ) {
        return this.applications.create(caller.userId, body)
    }
}
