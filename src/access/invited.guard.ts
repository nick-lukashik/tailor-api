import { applyDecorators, type CanActivate, type ExecutionContext, Inject, Injectable, UseGuards } from '@nestjs/common'
import type { ConfigType } from '@nestjs/config'
import { ApiBearerAuth } from '@nestjs/swagger'
import { Authenticated, type AuthenticatedRequest } from '@nick-lukashik/auth/nest'
import { AppError } from '../common/http/app-error.js'
import { accessConfig } from '../config/config.js'

/**
 * Tailor is by invitation (D-112): a valid token is not enough, its user must be on
 * TAILOR_USERS. Runs after AccessTokenGuard, so `auth` is the verified caller.
 */
@Injectable()
export class InvitedGuard implements CanActivate {
    private readonly users: ReadonlySet<string>

    constructor(@Inject(accessConfig.KEY) config: ConfigType<typeof accessConfig>) {
        this.users = new Set(config.users)
    }

    isInvited(userId: string) {
        return this.users.has(userId.toLowerCase())
    }

    canActivate(context: ExecutionContext): boolean {
        const auth = context.switchToHttp().getRequest<AuthenticatedRequest>().auth
        if (!auth || !this.isInvited(auth.userId)) throw new AppError('NOT_INVITED', 'Tailor is by invitation')
        return true
    }
}

/** A valid access token (401 without) of an invited person (403 NOT_INVITED otherwise). */
export const Invited = () => applyDecorators(ApiBearerAuth(), Authenticated(), UseGuards(InvitedGuard))
