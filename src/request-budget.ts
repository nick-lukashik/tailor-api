import { type CallHandler, type ExecutionContext, type NestInterceptor, SetMetadata } from '@nestjs/common'
import type { Reflector } from '@nestjs/core'
import type { Observable } from 'rxjs'
import { RequestTimeoutInterceptor } from './common/http/request-timeout.js'

const REQUEST_BUDGET = 'tailor:request-budget'

/**
 * A route's own whole-request budget, instead of the contract's 10 s. Only for
 * a route that waits on a slow dependency with a budget of its own below this
 * one (tailor-tex: 60 s), so the dependency's error answers, not this timeout.
 */
export const RequestBudget = (ms: number) => SetMetadata(REQUEST_BUDGET, ms)

/**
 * The global request budget (`RequestTimeoutInterceptor` of `src/common`) with
 * per-route exceptions from `@RequestBudget(ms)`; every other route keeps
 * `defaultMs`.
 */
export class RouteBudgetInterceptor implements NestInterceptor {
    private readonly budgets = new Map<number, RequestTimeoutInterceptor>()

    constructor(
        private readonly reflector: Reflector,
        private readonly defaultMs: number,
        private readonly onTimeout?: () => void,
    ) {}

    private budget(ms: number) {
        let interceptor = this.budgets.get(ms)
        if (!interceptor) {
            interceptor = new RequestTimeoutInterceptor(ms, this.onTimeout)
            this.budgets.set(ms, interceptor)
        }
        return interceptor
    }

    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
        const ms =
            this.reflector.getAllAndOverride<number | undefined>(REQUEST_BUDGET, [
                context.getHandler(),
                context.getClass(),
            ]) ?? this.defaultMs
        return this.budget(ms).intercept(context, next)
    }
}
