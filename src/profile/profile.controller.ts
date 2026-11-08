import { Body, Controller, Get, Put } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AccessClaims } from '@nick-lukashik/auth'
import { Caller } from '@nick-lukashik/auth/nest'
import { TailorAccess } from '../access/tailor-role.guard.js'
import { ApiErrors } from '../common/openapi/openapi.js'
import {
    type ProfileDocument,
    profileDocumentSchema,
    profileJsonSchema,
    profileSchema,
    savedProfileSchema,
} from './profile.schemas.js'
import { ProfileService } from './profile.service.js'

/** The caller's profile, read and written whole (D-98). */
@ApiTags('profile')
@Controller('profile')
@TailorAccess()
export class ProfileController {
    private readonly jsonSchema = profileJsonSchema()

    constructor(private readonly profiles: ProfileService) {}

    @Get()
    @ApiOperation({
        summary: 'The profile document and its version; 404 before the first save',
    })
    @ApiOkResponse({
        standardSchema: profileSchema,
    })
    @ApiErrors(401, 403, 404)
    get(@Caller() caller: AccessClaims) {
        return this.profiles.get(caller.userId)
    }

    @Put()
    @ApiOperation({
        summary: 'Replace the whole document: version + 1 and a snapshot. `{}` is an empty profile',
    })
    @ApiOkResponse({
        standardSchema: savedProfileSchema,
    })
    @ApiErrors(400, 401, 403, 413)
    save(
        @Caller() caller: AccessClaims,
        @Body({
            schema: profileDocumentSchema,
        })
        document: ProfileDocument,
    ) {
        return this.profiles.save(caller.userId, document)
    }

    @Get('schema')
    @ApiOperation({
        summary: 'JSON Schema (draft 2020-12) of the document PUT accepts, for editors',
    })
    @ApiErrors(401, 403)
    schema() {
        return this.jsonSchema
    }
}
