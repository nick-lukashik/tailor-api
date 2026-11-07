import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common'
import { ApiCreatedResponse, ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
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

/** Thin: validation by schema on the parameter, the rest in ApplicationsService. */
@ApiTags('applications')
@ApiHeader({
    name: 'x-request-id',
    required: false,
    description: 'Echoed back; generated when absent',
})
@Controller('applications')
export class ApplicationsController {
    constructor(private readonly applications: ApplicationsService) {}

    @Get()
    @ApiOperation({
        summary: 'Newest applications first, cursor pagination',
    })
    @ApiOkResponse({
        standardSchema: applicationListSchema,
    })
    @ApiErrors(400)
    list(
        @Query({
            schema: listApplicationsQuerySchema,
        })
        query: ListApplicationsQuery,
    ) {
        return this.applications.list(query)
    }

    @Get(':id')
    @ApiOkResponse({
        standardSchema: applicationSchema,
    })
    @ApiErrors(404)
    get(@Param('id') id: string) {
        return this.applications.get(id)
    }

    @Post()
    @HttpCode(HttpStatus.CREATED)
    @ApiCreatedResponse({
        standardSchema: applicationSchema,
    })
    @ApiErrors(400, 413)
    create(
        @Body({
            schema: createApplicationSchema,
        })
        body: CreateApplication,
    ) {
        return this.applications.create(body)
    }
}
