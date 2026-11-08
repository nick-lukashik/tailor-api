import { Controller, Get } from '@nestjs/common'
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { AccessClaims } from '@nick-lukashik/auth'
import { Authenticated, Caller } from '@nick-lukashik/auth/nest'
import { ApiErrors } from '../common/openapi/openapi.js'
import { type Me, meSchema } from './access.schemas.js'
import { InvitedGuard } from './invited.guard.js'

/** Any signed-in person: who they are to Tailor, so the invitation page can show the id. */
@ApiTags('access')
@ApiBearerAuth()
@Controller('me')
@Authenticated()
export class MeController {
    constructor(private readonly invited: InvitedGuard) {}

    @Get()
    @ApiOperation({
        summary: 'The caller: user id and whether Tailor is open to them',
    })
    @ApiOkResponse({
        standardSchema: meSchema,
    })
    @ApiErrors(401)
    me(@Caller() caller: AccessClaims): Me {
        return {
            userId: caller.userId,
            invited: this.invited.isInvited(caller.userId),
        }
    }
}
