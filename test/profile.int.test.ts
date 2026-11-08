import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { profileSnapshots } from '../src/db/schema.js'
import { documentHash } from '../src/profile/canonical-json.js'
import { exampleProfile } from './fixtures/profile.js'
import { OWNER, startApp, type TestApp } from './harness.js'

const SECOND = '019a5f00-0000-7000-8000-00000000e005'

describe('profile', () => {
    let t: TestApp

    beforeAll(async () => {
        t = await startApp()
    })
    afterAll(async () => {
        await t?.close()
    })

    const snapshots = (userId: string) =>
        t.db
            .select()
            .from(profileSnapshots)
            .where(eq(profileSnapshots.userId, userId))
            .orderBy(profileSnapshots.version)

    it('is 404 before the first save', async () => {
        const res = await (await t.as()).get('/api/v1/profile')
        expect(res.status).toBe(404)
        expect(res.body.code).toBe('NOT_FOUND')
    })

    it('saves the whole document as version 1 with a snapshot, and reads it back', async () => {
        const document = exampleProfile()
        const saved = await (await t.as()).put('/api/v1/profile').send(document)
        expect(saved.status).toBe(200)
        expect(saved.body).toEqual({
            version: 1,
            sha256: documentHash(document),
            updatedAt: expect.any(String),
        })

        const res = await (await t.as()).get('/api/v1/profile')
        expect(res.status).toBe(200)
        expect(res.body).toEqual({
            version: 1,
            updatedAt: saved.body.updatedAt,
            document,
        })

        const [snapshot, ...more] = await snapshots(OWNER)
        expect(more).toEqual([])
        expect(snapshot).toMatchObject({
            version: 1,
            document,
            sha256: saved.body.sha256,
        })
    })

    it('bumps the version on every save and keeps every snapshot', async () => {
        const document = exampleProfile()
        document.career.headline = 'Staff Engineer'
        const saved = await (await t.as()).put('/api/v1/profile').send(document)
        expect(saved.body.version).toBe(2)

        const res = await (await t.as()).get('/api/v1/profile')
        expect(res.body.version).toBe(2)
        expect(res.body.document.career.headline).toBe('Staff Engineer')
        const all = await snapshots(OWNER)
        expect(all.map(snapshot => snapshot.version)).toEqual([
            1,
            2,
        ])
        expect(all[1]?.sha256).toBe(documentHash(document))
        expect(all[0]?.sha256).not.toBe(all[1]?.sha256)
    })

    it('refuses an invalid document with every path, and keeps the stored one', async () => {
        const document = exampleProfile()
        const res = await (await t.as()).put('/api/v1/profile').send({
            ...document,
            person: {
                ...document.person,
                email: 'nope',
            },
            cases: [
                {
                    ...document.cases[0],
                    employmentId: 'nowhere',
                },
            ],
            settings: {
                maxPages: 9,
            },
            extra: true,
        })
        expect(res.status).toBe(400)
        expect(res.body.code).toBe('VALIDATION_FAILED')
        expect(res.body.details).toEqual(
            expect.arrayContaining([
                {
                    path: 'person.email',
                    message: expect.any(String),
                },
                {
                    path: 'settings.maxPages',
                    message: expect.any(String),
                },
                {
                    path: '',
                    message: expect.stringContaining('extra'),
                },
            ]),
        )

        const crossCheck = await (await t.as()).put('/api/v1/profile').send({
            ...document,
            cases: [
                {
                    ...document.cases[0],
                    employmentId: 'nowhere',
                },
            ],
        })
        expect(crossCheck.status).toBe(400)
        expect(crossCheck.body.details).toEqual([
            {
                path: 'cases.0.employmentId',
                message: 'no employment "nowhere"',
            },
        ])

        const notJson = await (await t.as()).put('/api/v1/profile').send([])
        expect(notJson.status).toBe(400)
        expect((await (await t.as()).get('/api/v1/profile')).body.version).toBe(2)
    })

    it("is each person's own: {} starts an empty profile", async () => {
        const second = await t.as(SECOND)
        expect((await second.get('/api/v1/profile')).status).toBe(404)
        const saved = await second.put('/api/v1/profile').send({})
        expect(saved.body.version).toBe(1)
        const res = await second.get('/api/v1/profile')
        expect(res.body.document).toMatchObject({
            person: {
                names: [],
            },
            cases: [],
            settings: {
                maxPages: 2,
            },
        })
        expect((await (await t.as()).get('/api/v1/profile')).body.document.person.names).toHaveLength(2)
    })

    it('gives two saves at once two versions', async () => {
        const second = await t.as(SECOND)
        const results = await Promise.all([
            second.put('/api/v1/profile').send({}),
            second.put('/api/v1/profile').send({}),
        ])
        expect(results.map(res => res.status)).toEqual([
            200,
            200,
        ])
        expect(results.map(res => res.body.version).sort()).toEqual([
            2,
            3,
        ])
    })

    it('takes a profile of a few hundred cases, and refuses a body over 1 MiB', async () => {
        const document = exampleProfile()
        const [first] = document.cases
        if (!first) throw new Error('no case')
        const cases = Array.from(
            {
                length: 300,
            },
            (_, index) => ({
                ...first,
                id: `c${index}`,
            }),
        )
        const big = await (await t.as()).put('/api/v1/profile').send({
            ...document,
            cases,
        })
        expect(big.status).toBe(200)
        expect(JSON.stringify(cases).length).toBeGreaterThan(200_000)

        const huge = await (await t.as()).put('/api/v1/profile').send({
            ...document,
            story: {
                aboutMe: 'x'.repeat(1024 * 1024),
            },
        })
        expect(huge.status).toBe(413)
    })

    it('serves the JSON Schema of the document', async () => {
        const res = await (await t.as()).get('/api/v1/profile/schema')
        expect(res.status).toBe(200)
        expect(res.body.$schema).toBe('https://json-schema.org/draft/2020-12/schema')
        expect(Object.keys(res.body.properties)).toContain('cases')
    })
})
