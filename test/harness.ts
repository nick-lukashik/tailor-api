import type { NestExpressApplication } from '@nestjs/platform-express'
import { Test } from '@nestjs/testing'
import { sql } from 'drizzle-orm'
import { Logger } from 'nestjs-pino'
import type { PgBoss } from 'pg-boss'
import request from 'supertest'
import { inject } from 'vitest'
import { TAILOR_ROLE } from '../src/access/tailor-role.guard.js'
import { configureApp } from '../src/app.setup.js'
import { DB } from '../src/common/database/database.js'
import { PG_BOSS } from '../src/common/jobs/jobs.module.js'
import { Metrics } from '../src/common/metrics/metrics.js'
import { env } from '../src/config/env.js'
import type { Db } from '../src/db/types.js'
import { PARSE_QUEUE } from '../src/vacancies/vacancy-parse.job.js'
import { AUDIENCE, ISSUER, startIdentity } from './identity.js'
import { LLM_TEST_KEY, startLlmGateway } from './llm-gateway.js'

/** The person every test acts as unless it says otherwise. */
export const OWNER = '019a5f00-0000-7000-8000-00000000a001'

export type TestApp = Awaited<ReturnType<typeof startApp>>

/**
 * The real AppModule against the shared containers and stand-ins for id-api
 * and llm-gateway, listening on a random port. Every file starts from empty
 * tables and no queued jobs.
 * `http()` calls as nobody; `as(userId)` with that person's access token.
 */
export async function startApp(overrides: Record<string, string> = {}) {
    const identity = await startIdentity()
    const llm = await startLlmGateway()
    Object.assign(process.env, {
        NODE_ENV: 'test',
        LOG_LEVEL: process.env.TEST_LOG_LEVEL ?? 'silent',
        APP_VERSION: 'test',
        METRICS_PORT: '0',
        DATABASE_URL: inject('databaseUrl'),
        ID_JWKS_URL: identity.jwksUrl,
        TOKEN_ISSUER: ISSUER,
        TOKEN_AUDIENCE: AUDIENCE,
        LLM_GATEWAY_URL: llm.url,
        LLM_GATEWAY_KEY: LLM_TEST_KEY,
        ...overrides,
    })
    env.reset()

    const { AppModule } = await import('../src/app.module.js')
    const moduleRef = await Test.createTestingModule({
        imports: [
            AppModule,
        ],
    }).compile()
    const app = moduleRef.createNestApplication<NestExpressApplication>({
        bufferLogs: true,
    })
    app.useLogger(app.get(Logger))
    configureApp(app)
    await app.init()

    const db = app.get<Db>(DB)
    await app.get<PgBoss>(PG_BOSS).deleteAllJobs(PARSE_QUEUE)
    await db.execute(sql`truncate applications, vacancies, profiles, profile_snapshots`)
    await app.listen(0, '127.0.0.1')
    const { registry } = app.get(Metrics)

    const http = () => request(app.getHttpServer())
    const tokens = new Map<string, string>()
    const bearer = async (userId: string, roles: string[]) => {
        const key = `${userId} ${roles.join(',')}`
        const cached =
            tokens.get(key)
            ?? (await identity.bearer(userId, {
                roles,
            }))
        tokens.set(key, cached)
        return cached
    }

    return {
        app,
        db,
        identity,
        llm,
        http,
        /** Requests with the access token of `userId` (the owner by default), with the `tailor` role unless `roles` says otherwise. */
        as: async (
            userId = OWNER,
            roles = [
                TAILOR_ROLE,
            ],
        ) => {
            const authorization = await bearer(userId, roles)
            return {
                get: (path: string) => http().get(path).set('authorization', authorization),
                post: (path: string) => http().post(path).set('authorization', authorization),
                put: (path: string) => http().put(path).set('authorization', authorization),
            }
        },
        /** Sum of a metric's series that carry `labels` (0 when none). */
        metric: async (name: string, labels: Record<string, string> = {}) => {
            const metric = registry.getSingleMetric(name)
            if (!metric) throw new Error(`no metric ${name}`)
            const { values } = await metric.get()
            return values
                .filter(value => Object.entries(labels).every(([key, label]) => value.labels[key] === label))
                .reduce((sum, value) => sum + value.value, 0)
        },
        close: async () => {
            await app.close()
            await identity.close()
            await llm.close()
        },
    }
}
