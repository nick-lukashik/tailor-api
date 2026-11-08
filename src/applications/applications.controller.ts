import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common'
import { ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AccessClaims } from '@nick-lukashik/auth'
import { Caller } from '@nick-lukashik/auth/nest'
import { Invited } from '../access/invited.guard.js'
import { ApiErrors } from '../common/openapi/openapi.js'
import {
    applicationListSchema,
    applicationSchema,
    type CreateApplication,
    createApplicationSchema,
    type ListApplicationsQuery,
    listApplicationsQuerySchema,
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
@Invited()
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
    @ApiOkResponse({
        standardSchema: applicationSchema,
    })
    @ApiErrors(401, 403, 404)
    get(@Caller() caller: AccessClaims, @Param('id') id: string) {
        return this.applications.get(id, caller.userId)
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
