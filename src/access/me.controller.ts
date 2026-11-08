import { Controller, Get } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AccessClaims } from '@nick-lukashik/auth'
import { Authenticated, Caller } from '@nick-lukashik/auth/nest'
import { ApiErrors } from '../common/openapi/openapi.js'
import { type Me, meSchema } from './access.schemas.js'
import { hasTailorRole } from './tailor-role.guard.js'

/** Any signed-in person: who they are and whether Tailor is open to them. */
@ApiTags('access')
@ApiBearerAuth()
@Controller('me')
@Authenticated()
export class MeController {
    @Get()
    @ApiOperation({
        summary: 'The caller: user id and whether the token carries the tailor role',
    })
    @ApiOkResponse({
        standardSchema: meSchema,
    })
    @ApiErrors(401)
    me(@Caller() caller: AccessClaims): Me {
        return {
            userId: caller.userId,
            allowed: hasTailorRole(caller),
        }
    }
}
