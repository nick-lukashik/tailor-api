import { applyDecorators, type CanActivate, type ExecutionContext, Injectable, UseGuards } from '@nestjs/common'
import { ApiBearerAuth } from '@nestjs/swagger'
import type { AccessClaims } from '@nick-lukashik/auth'
import { Authenticated, type AuthenticatedRequest } from '@nick-lukashik/auth/nest'
import { AppError } from '../common/http/app-error.js'

/**
 * The id-api role that opens Tailor. Compared as a string: `@nick-lukashik/auth` lists it
 * from 0.2.0, and the verifier passes every role of the token through as it is.
 */
export const TAILOR_ROLE = 'tailor'

export const hasTailorRole = (claims: Pick<AccessClaims, 'roles'>) => claims.roles.includes(TAILOR_ROLE)

/** Only people with the `tailor` role. Runs after AccessTokenGuard, so `auth` is the verified caller. */
@Injectable()
export class TailorRoleGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
        const auth = context.switchToHttp().getRequest<AuthenticatedRequest>().auth
        if (!auth || !hasTailorRole(auth)) throw new AppError('FORBIDDEN', 'Forbidden')
        return true
    }
}

/** A valid access token (401 without) carrying the `tailor` role (403 FORBIDDEN otherwise). */
export const TailorAccess = () => applyDecorators(ApiBearerAuth(), Authenticated(), UseGuards(TailorRoleGuard))
