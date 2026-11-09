import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { applications, vacancies } from '../src/db/schema.js'
import type { ParsedVacancy } from '../src/vacancies/parse.schemas.js'
import { OWNER, startApp, type TestApp } from './harness.js'

/** With the role too: a second person with applications of their own. */
const other = '019a5f00-0000-7000-8000-00000000b002'
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

const parsed: ParsedVacancy = {
    title: 'Backend Engineer',
    company: 'Example Labs',
    companyDescription: null,
    seniority: 'senior',
    location: null,
    remote: 'remote',
    regions: [
        'EU',
    ],
    employmentType: 'full-time',
    salary: null,
    language: 'en',
    skills: [
        {
            name: 'Node.js',
            required: true,
        },
    ],
    requirements: [
        'Node.js',
    ],
    responsibilities: [],
    niceToHave: [],
    applyChannels: [],
    summary: 'Example Labs hires a backend engineer.',
    warnings: [],
}

describe('applications', () => {
    let t: TestApp

    beforeAll(async () => {
        t = await startApp()
    })
    afterAll(async () => {
        await t?.close()
    })

    const create = async (company: string, vacancyText = '', userId = OWNER) =>
        (await t.as(userId)).post('/api/v1/applications').send({
            company,
            vacancyText,
        })

    it('creates an application and echoes the request id', async () => {
        const res = await (await t.as()).post('/api/v1/applications').set('x-request-id', 'test-request-0001').send({
            company: '  First  ',
            vacancyText: 'hello',
        })
        expect(res.status).toBe(201)
        expect(res.headers['x-request-id']).toBe('test-request-0001')
        expect(res.body).toEqual({
            id: expect.stringMatching(UUID_V7),
            company: 'First',
            role: '',
            vacancyUrl: null,
            vacancyText: 'hello',
            status: 'new',
            vacancyId: null,
            parseStatus: null,
            cvStatus: 'none',
            materialsStatus: 'none',
            createdAt: expect.any(String),
        })
        expect(new Date(res.body.createdAt).toISOString()).toBe(res.body.createdAt)
    })

    it('returns an application by id, 404 for unknown and malformed ids', async () => {
        const { body: application } = await create('By id')
        const found = await (await t.as()).get(`/api/v1/applications/${application.id}`)
        expect(found.status).toBe(200)
        expect(found.body).toEqual({
            ...application,
            vacancy: null,
            cv: {
                status: 'none',
            },
            materials: {
                status: 'none',
            },
        })

        for (const id of [
            '01a19d24-0000-7000-8000-000000000000',
            'not-a-uuid',
        ]) {
            const missing = await (await t.as()).get(`/api/v1/applications/${id}`)
            expect(missing.status).toBe(404)
            expect(missing.body).toEqual({
                code: 'NOT_FOUND',
                message: 'Application not found',
                requestId: missing.headers['x-request-id'],
            })
        }
    })

    it('lists newest first', async () => {
        await create('Newest')
        const res = await (await t.as()).get('/api/v1/applications?limit=50')
        expect(res.status).toBe(200)
        expect(res.body.items.map((n: { company: string }) => n.company)).toEqual([
            'Newest',
            'By id',
            'First',
        ])
        expect(res.body.nextCursor).toBeNull()
    })

    it('pages with an opaque cursor', async () => {
        const page1 = await (await t.as()).get('/api/v1/applications?limit=2')
        expect(page1.body.items).toHaveLength(2)
        expect(page1.body.nextCursor).toEqual(expect.any(String))

        const page2 = await (await t.as()).get('/api/v1/applications').query({
            limit: 2,
            cursor: page1.body.nextCursor,
        })
        expect(page2.status).toBe(200)
        expect(page2.body.items).toHaveLength(1)
        expect(page2.body.nextCursor).toBeNull()
        const ids = [
            ...page1.body.items,
            ...page2.body.items,
        ].map((n: { id: string }) => n.id)
        expect(new Set(ids).size).toBe(3)
    })

    it('keeps the role and the vacancy link, and rejects a link that is not http(s)', async () => {
        const res = await (await t.as()).post('/api/v1/applications').send({
            company: 'Linked',
            role: ' Engineer ',
            vacancyUrl: 'https://example.com/jobs/1',
        })
        expect(res.status).toBe(201)
        expect(res.body).toMatchObject({
            role: 'Engineer',
            vacancyUrl: 'https://example.com/jobs/1',
        })

        const bad = await (await t.as()).post('/api/v1/applications').send({
            company: 'Linked',
            vacancyUrl: 'javascript:alert(1)',
        })
        expect(bad.status).toBe(400)
        expect(bad.body.details[0].path).toBe('vacancyUrl')
    })

    it('rejects invalid input with every failing field', async () => {
        const res = await (await t.as()).post('/api/v1/applications').send({
            company: '',
            vacancyText: 'x'.repeat(50_001),
        })
        expect(res.status).toBe(400)
        expect(res.body).toMatchObject({
            code: 'VALIDATION_FAILED',
            requestId: expect.any(String),
        })
        expect(res.body.details.map((d: { path: string }) => d.path)).toEqual([
            'company',
            'vacancyText',
        ])

        const query = await (await t.as()).get('/api/v1/applications?limit=0')
        expect(query.status).toBe(400)
        expect(query.body.details[0].path).toBe('limit')

        const cursor = await (await t.as()).get('/api/v1/applications?cursor=forged')
        expect(cursor.status).toBe(400)
        expect(cursor.body.details).toEqual([
            {
                path: 'cursor',
                message: 'Invalid cursor',
            },
        ])

        const json = await (await t.as())
            .post('/api/v1/applications')
            .set('content-type', 'application/json')
            .send('{oops')
        expect(json.status).toBe(400)
        expect(json.body.code).toBe('VALIDATION_FAILED')
    })

    it("lists and opens only the caller's own applications", async () => {
        const { body: theirs } = await create('Theirs', '', other)
        const mine = await (await t.as()).get('/api/v1/applications?limit=50')
        expect(mine.body.items.map((n: { company: string }) => n.company)).not.toContain('Theirs')

        // Someone else's is not found, so its existence does not leak.
        const res = await (await t.as()).get(`/api/v1/applications/${theirs.id}`)
        expect(res.status).toBe(404)
        expect((await (await t.as(other)).get(`/api/v1/applications/${theirs.id}`)).status).toBe(200)
        const own = await (await t.as(other)).get('/api/v1/applications')
        expect(own.body.items.map((n: { company: string }) => n.company)).toEqual([
            'Theirs',
        ])
    })

    it('does not list rows without a person (the demo rows of 0001)', async () => {
        await t.db.execute(
            sql`insert into applications (id, company) values ('019a5f00-0000-7000-8000-0000000000ff', 'Demo')`,
        )
        const res = await (await t.as()).get('/api/v1/applications?limit=50')
        expect(res.body.items.map((n: { company: string }) => n.company)).not.toContain('Demo')
        expect((await (await t.as()).get('/api/v1/applications/019a5f00-0000-7000-8000-0000000000ff')).status).toBe(404)
    })

    const withVacancy = async (vacancy: Partial<typeof vacancies.$inferInsert>, userId = OWNER) => {
        const [row] = await t.db
            .insert(vacancies)
            .values({
                createdBy: userId,
                ...vacancy,
            })
            .returning()
        if (!row) throw new Error('no vacancy row')
        const [application] = await t.db
            .insert(applications)
            .values({
                userId,
                vacancyId: row.id,
                company: row.company,
                role: row.title,
            })
            .returning()
        if (!application) throw new Error('no application row')
        return {
            vacancy: row,
            applicationId: application.id,
        }
    }

    it('opens an application with its parsed vacancy, without _meta, and no CV yet', async () => {
        const { vacancy, applicationId } = await withVacancy({
            url: 'https://example.com/jobs/parsed',
            urlKey: 'https://example.com/jobs/parsed',
            rawText: 'Example Labs is hiring a backend engineer.',
            title: 'Backend Engineer',
            company: 'Example Labs',
            parseStatus: 'parsed',
            parsed: {
                ...parsed,
                _meta: {
                    model: 'claude-sonnet-5-5',
                    effort: 'low',
                    promptVersion: 1,
                },
            },
        })
        const res = await (await t.as()).get(`/api/v1/applications/${applicationId}`)
        expect(res.status).toBe(200)
        expect(res.body).toMatchObject({
            id: applicationId,
            vacancyId: vacancy.id,
            parseStatus: 'parsed',
            vacancyText: '',
            cv: {
                status: 'none',
            },
        })
        expect(res.body.vacancy).toEqual({
            id: vacancy.id,
            url: 'https://example.com/jobs/parsed',
            rawText: 'Example Labs is hiring a backend engineer.',
            parseStatus: 'parsed',
            parseError: null,
            updatedAt: vacancy.updatedAt.toISOString(),
            model: 'claude-sonnet-5-5',
            parsed,
            applyForm: null,
            fetchStatus: 'skipped',
            fetchError: null,
        })

        // The list stays light: no vacancy or CV in its items.
        const list = await (await t.as()).get('/api/v1/applications?limit=50')
        const item = list.body.items.find((n: { id: string }) => n.id === applicationId)
        expect(item).toBeDefined()
        expect(item).not.toHaveProperty('vacancy')
        expect(item).not.toHaveProperty('cv')
        expect(item.cvStatus).toBe('none')
    })

    it('opens an application whose vacancy is still pending, a pasted text without a link', async () => {
        const { vacancy, applicationId } = await withVacancy({
            rawText: 'A pasted vacancy text.',
        })
        const res = await (await t.as()).get(`/api/v1/applications/${applicationId}`)
        expect(res.status).toBe(200)
        expect(res.body.parseStatus).toBe('pending')
        expect(res.body.vacancy).toEqual({
            id: vacancy.id,
            url: null,
            rawText: 'A pasted vacancy text.',
            parseStatus: 'pending',
            parseError: null,
            updatedAt: vacancy.updatedAt.toISOString(),
            model: null,
            parsed: null,
            applyForm: null,
            fetchStatus: 'skipped',
            fetchError: null,
        })
        expect(res.body.cv).toEqual({
            status: 'none',
        })
    })

    it("does not open someone else's application with a vacancy", async () => {
        const { applicationId } = await withVacancy(
            {
                rawText: 'Their vacancy text.',
            },
            other,
        )
        const res = await (await t.as()).get(`/api/v1/applications/${applicationId}`)
        expect(res.status).toBe(404)
        expect(res.body.code).toBe('NOT_FOUND')
        const theirs = await (await t.as(other)).get(`/api/v1/applications/${applicationId}`)
        expect(theirs.status).toBe(200)
        expect(theirs.body.vacancy.rawText).toBe('Their vacancy text.')
    })
})
