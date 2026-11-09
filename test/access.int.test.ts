import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TAILOR_ROLE } from '../src/access/tailor-role.guard.js'
import { applications, vacancies } from '../src/db/schema.js'
import { OWNER, startApp, type TestApp } from './harness.js'

const STRANGER = '019a5f00-0000-7000-8000-00000000c003'

describe('access: id tokens and the tailor role', () => {
    let t: TestApp
    /** Every route of the API under /api/v1 but the public CV files, from the OpenAPI document. */
    let routes: {
        method: 'get' | 'post' | 'put'
        path: string
    }[]

    beforeAll(async () => {
        t = await startApp()
        const { body } = await t.http().get('/openapi.json')
        routes = Object.entries(body.paths as Record<string, Record<string, unknown>>).flatMap(([path, methods]) =>
            Object.keys(methods).map(method => ({
                method: method as 'get' | 'post' | 'put',
                path: path.replace('{id}', '019a5f00-0000-7000-8000-000000000001'),
            })),
        )
    })
    afterAll(async () => {
        await t?.close()
    })

    it('answers 401 without a token on every route but the CV files', async () => {
        expect(routes.length).toBeGreaterThanOrEqual(7)
        expect(routes.some(route => route.path.startsWith('/api/v1/cv'))).toBe(false)
        for (const route of routes) {
            const res = await t.http()[route.method](route.path).send({})
            expect(res.status, `${route.method} ${route.path}`).toBe(401)
            expect(res.body).toEqual({
                code: 'UNAUTHORIZED',
                message: 'Access token required',
                requestId: res.headers['x-request-id'],
            })
        }
    })

    it('answers 401 for a token it cannot trust', async () => {
        const forged = [
            await t.identity.token(OWNER, {
                expiresIn: '-1m',
            }),
            await t.identity.token(OWNER, {
                audience: 'another-audience',
            }),
            await t.identity.token(OWNER, {
                issuer: 'https://id.elsewhere.test',
            }),
            await t.identity.token(OWNER, {
                signedBy: 'stranger',
            }),
            'not.a.token',
        ]
        for (const token of forged) {
            const res = await t.http().get('/api/v1/applications').set('authorization', `Bearer ${token}`)
            expect(res.status).toBe(401)
            expect(res.body.code).toBe('UNAUTHORIZED')
        }
        const scheme = await t
            .http()
            .get('/api/v1/applications')
            .set('authorization', `Token ${await t.identity.token(OWNER)}`)
        expect(scheme.status).toBe(401)
    })

    it('answers 403 FORBIDDEN to a valid token without the tailor role', async () => {
        for (const roles of [
            [],
            [
                'owner',
                'support',
            ],
            [
                'Tailor',
                'tailors',
            ],
        ]) {
            const as = await t.as(STRANGER, roles)
            for (const res of [
                await as.get('/api/v1/applications'),
                await as.post('/api/v1/applications').send({
                    company: 'Nope',
                }),
                await as.get('/api/v1/profile'),
                await as.put('/api/v1/profile').send({}),
                await as.get('/api/v1/profile/schema'),
                await as.get('/api/v1/profile/cv.pdf'),
                await as.post('/api/v1/vacancies/019a5f00-0000-7000-8000-000000000001/parse'),
                await as.post('/api/v1/vacancies/intake').send({
                    items: [
                        {
                            url: 'https://example.com/jobs/nope',
                        },
                    ],
                }),
            ]) {
                expect(res.status, roles.join(',')).toBe(403)
                expect(res.body).toEqual({
                    code: 'FORBIDDEN',
                    message: 'Forbidden',
                    requestId: res.headers['x-request-id'],
                })
            }
        }
        expect(await t.db.$count(applications)).toBe(0)
        expect(await t.db.$count(vacancies)).toBe(0)
    })

    it('lets in anyone whose token carries the role, among others', async () => {
        expect((await (await t.as()).get('/api/v1/applications')).status).toBe(200)
        expect(
            (
                await (
                    await t.as(STRANGER, [
                        'support',
                        TAILOR_ROLE,
                    ])
                ).get('/api/v1/applications')
            ).status,
        ).toBe(200)
    })

    it('/me tells anyone signed in their id and whether Tailor is open to them', async () => {
        const owner = await (await t.as()).get('/api/v1/me')
        expect(owner.status).toBe(200)
        expect(owner.body).toEqual({
            userId: OWNER,
            allowed: true,
        })
        const stranger = await (await t.as(STRANGER, [])).get('/api/v1/me')
        expect(stranger.status).toBe(200)
        expect(stranger.body).toEqual({
            userId: STRANGER,
            allowed: false,
        })
    })

    it('keeps the CV files public', async () => {
        const res = await t.http().get('/api/v1/cv/019a5f00-0000-7000-8000-000000000009')
        expect(res.status).toBe(404)
        expect(res.body.code).toBe('NOT_FOUND')
    })
})

describe('access: id-api keys unreachable', () => {
    let t: TestApp

    beforeAll(async () => {
        // A port nothing listens on: the keys cannot be fetched.
        t = await startApp({
            ID_JWKS_URL: 'http://127.0.0.1:9/.well-known/jwks.json',
        })
    })
    afterAll(async () => {
        await t?.close()
    })

    it('answers 503 UNAVAILABLE, not 401: the token may be fine', async () => {
        const res = await (await t.as()).get('/api/v1/me')
        expect(res.status).toBe(503)
        expect(res.body).toMatchObject({
            code: 'UNAVAILABLE',
        })
    })
})
