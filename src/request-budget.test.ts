import { Controller, Get } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { firstValueFrom, timer } from 'rxjs'
import { describe, expect, it, vi } from 'vitest'
import { RequestBudget, RouteBudgetInterceptor } from './request-budget.js'

@Controller()
class Routes {
    @Get('slow')
    @RequestBudget(200)
    slow() {}

    @Get('plain')
    plain() {}
}

const contextOf = (handler: () => void) =>
    ({
        getHandler: () => handler,
        getClass: () => Routes,
    }) as never

/** Whether a handler that answers after `ms` gets through the route's budget. */
async function passes(interceptor: RouteBudgetInterceptor, handler: () => void, ms: number) {
    const result = interceptor.intercept(contextOf(handler), {
        handle: () => timer(ms),
    })
    return firstValueFrom(result).then(
        () => true,
        (error: unknown) => {
            expect(error).toMatchObject({
                code: 'TIMEOUT',
            })
            return false
        },
    )
}

describe('RouteBudgetInterceptor', () => {
    const onTimeout = vi.fn()
    const interceptor = new RouteBudgetInterceptor(new Reflector(), 50, onTimeout)

    it('keeps the default budget for a route without its own', async () => {
        expect(await passes(interceptor, Routes.prototype.plain, 10)).toBe(true)
        expect(await passes(interceptor, Routes.prototype.plain, 120)).toBe(false)
        expect(onTimeout).toHaveBeenCalledOnce()
    })

    it('gives a route with @RequestBudget its own, longer budget', async () => {
        expect(await passes(interceptor, Routes.prototype.slow, 120)).toBe(true)
        expect(await passes(interceptor, Routes.prototype.slow, 400)).toBe(false)
    })
})
