import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { applications, vacancies } from '../src/db/schema.js'
import type { ParsedVacancy } from '../src/vacancies/parse.schemas.js'
import { OWNER, startApp, type TestApp } from './harness.js'
import { completionOf, errorOf, LLM_TEST_KEY } from './llm-gateway.js'

const STRANGER = '019a5f00-0000-7000-8000-00000000d004'

const parsed: ParsedVacancy = {
    title: '  Senior Backend Engineer  ',
    company: 'Example Labs',
    companyDescription: 'Example Labs builds tools for logistics.',
    seniority: 'senior',
    location: 'Berlin',
    remote: 'hybrid',
    regions: [
        'EU',
    ],
    employmentType: 'full-time',
    salary: {
        min: 70_000,
        max: 90_000,
        currency: 'EUR',
        period: 'year',
    },
    language: 'en',
    skills: [
        {
            name: 'Node.js',
            required: true,
        },
        {
            name: 'Kubernetes',
            required: false,
        },
    ],
    requirements: [
        '5+ years with Node.js',
    ],
    responsibilities: [
        'Build the order API',
    ],
    niceToHave: [
        'Kubernetes',
    ],
    applyChannels: [
        {
            kind: 'email',
            value: 'jobs@example.com',
        },
    ],
    summary: 'Example Labs hires a senior backend engineer in Berlin. Node.js is required.',
    warnings: [],
}

const text = 'Example Labs is hiring a Senior Backend Engineer (Node.js) in Berlin, hybrid. EUR 70-90k.'

describe('vacancy parse job', () => {
    let t: TestApp

    beforeAll(async () => {
        t = await startApp()
    })
    afterAll(async () => {
        await t?.close()
    })
    beforeEach(() => {
        t.llm.calls.length = 0
        t.llm.answer(() => completionOf(parsed))
    })

    const intake = async (
        items: {
            url?: string
            text?: string
        }[],
        userId = OWNER,
    ) =>
        (await t.as(userId)).post('/api/v1/vacancies/intake').send({
            items,
        })
    const vacancy = async (id: string) => (await t.db.select().from(vacancies).where(eq(vacancies.id, id)))[0]
    const settled = (id: string, timeout = 15_000) =>
        expect.poll(async () => (await vacancy(id))?.parseStatus, {
            timeout,
            interval: 200,
        })
    const callsFor = (vacancyText: string) =>
        t.llm.calls.filter(call => call.body.messages.some(message => message.content.includes(vacancyText)))

    it('parses what the intake took and fills the vacancy and the applications', async () => {
        const res = await intake([
            {
                url: 'https://example.com/parse/1',
                text,
            },
        ])
        const { vacancyId, applicationId } = res.body.items[0]
        await settled(vacancyId).toBe('parsed')

        expect(await vacancy(vacancyId)).toMatchObject({
            parsed,
            title: 'Senior Backend Engineer',
            company: 'Example Labs',
            parseError: null,
        })
        const application = await (await t.as()).get(`/api/v1/applications/${applicationId}`)
        expect(application.body).toMatchObject({
            company: 'Example Labs',
            role: 'Senior Backend Engineer',
            parseStatus: 'parsed',
        })

        const [call] = callsFor(text)
        expect(call).toMatchObject({
            path: '/api/v1/chat/completions',
            authorization: `Bearer ${LLM_TEST_KEY}`,
            idempotencyKey: expect.stringMatching(/^vacancy-parse-/),
            body: {
                model: 'claude-haiku-5-5',
                response_format: {
                    type: 'json_schema',
                    json_schema: {
                        name: 'parsed_vacancy',
                    },
                },
                metadata: {
                    purpose: 'vacancy-parse',
                },
            },
        })
        expect(call?.body.messages[0]?.role).toBe('system')
        expect(call?.body.messages[1]?.content).toContain(`<vacancy>\n${text}\n</vacancy>`)
        expect(call?.body.messages[1]?.content).toContain('<link>https://example.com/parse/1</link>')
    })

    it('fills only the company and role an application does not have yet', async () => {
        const vacancyRow = (
            await t.db
                .insert(vacancies)
                .values({
                    rawText: `${text} (kept)`,
                    createdBy: OWNER,
                })
                .returning()
        )[0]
        if (!vacancyRow) throw new Error('no vacancy')
        await t.db.insert(applications).values([
            {
                userId: OWNER,
                vacancyId: vacancyRow.id,
                company: 'Named by hand',
                role: '',
            },
            {
                userId: STRANGER,
                vacancyId: vacancyRow.id,
                company: '',
                role: 'Their own role',
            },
        ])
        const res = await (await t.as()).post(`/api/v1/vacancies/${vacancyRow.id}/parse`)
        expect(res.status).toBe(202)
        expect(res.body).toEqual({
            vacancyId: vacancyRow.id,
            parseStatus: 'pending',
        })
        await settled(vacancyRow.id).toBe('parsed')
        const rows = await t.db
            .select({
                userId: applications.userId,
                company: applications.company,
                role: applications.role,
            })
            .from(applications)
            .where(eq(applications.vacancyId, vacancyRow.id))
        expect(rows).toEqual(
            expect.arrayContaining([
                {
                    userId: OWNER,
                    company: 'Named by hand',
                    role: 'Senior Backend Engineer',
                },
                {
                    userId: STRANGER,
                    company: 'Example Labs',
                    role: 'Their own role',
                },
            ]),
        )
    })

    it('fails a vacancy without a text with no_text, without calling the model', async () => {
        const res = await intake([
            {
                url: 'https://example.com/parse/no-text',
            },
        ])
        const { vacancyId } = res.body.items[0]
        await settled(vacancyId).toBe('failed')
        expect((await vacancy(vacancyId))?.parseError).toBe('no_text')
        expect(t.llm.calls).toHaveLength(0)

        // The text arrives later: the same vacancy is parsed.
        const filled = await intake([
            {
                url: 'https://example.com/parse/no-text',
                text: `${text} (late)`,
            },
        ])
        expect(filled.body.items[0].vacancyId).toBe(vacancyId)
        await settled(vacancyId).toBe('parsed')
        expect((await vacancy(vacancyId))?.parseError).toBeNull()
    })

    it('retries after a 500 from the gateway with the same idempotency key', async () => {
        const marker = `${text} (retry)`
        let calls = 0
        t.llm.answer(() => {
            calls += 1
            return calls === 1 ? errorOf(500, 'internal') : completionOf(parsed)
        })
        const res = await intake([
            {
                text: marker,
            },
        ])
        const { vacancyId } = res.body.items[0]
        await expect.poll(() => callsFor(marker).length).toBeGreaterThanOrEqual(1)
        expect((await vacancy(vacancyId))?.parseStatus).toBe('pending')
        await settled(vacancyId, 25_000).toBe('parsed')
        const attempts = callsFor(marker)
        expect(attempts).toHaveLength(2)
        expect(attempts[1]?.idempotencyKey).toBe(attempts[0]?.idempotencyKey)
        expect(
            await t.metric('vacancy_parse_total', {
                result: 'retry',
            }),
        ).toBeGreaterThanOrEqual(1)
    }, 30_000)

    it('fails at once on a 400 with a short code, nothing of the model in it', async () => {
        const marker = `${text} (bad request)`
        t.llm.answer(() => errorOf(400, 'bad_request'))
        const res = await intake([
            {
                text: marker,
            },
        ])
        const { vacancyId } = res.body.items[0]
        await settled(vacancyId).toBe('failed')
        expect((await vacancy(vacancyId))?.parseError).toBe('llm_bad_request')
        expect(callsFor(marker)).toHaveLength(1)
    })

    it('fails an answer off the schema as llm_invalid_output', async () => {
        const marker = `${text} (invalid)`
        t.llm.answer(() =>
            completionOf({
                title: 'Only a title',
            }),
        )
        const { vacancyId } = (
            await intake([
                {
                    text: marker,
                },
            ])
        ).body.items[0]
        await settled(vacancyId).toBe('failed')
        expect(await vacancy(vacancyId)).toMatchObject({
            parseError: 'llm_invalid_output',
            parsed: null,
            title: '',
        })
    })

    it("re-parses only a vacancy in the caller's pool: 404 for someone else's or an unknown one", async () => {
        const { vacancyId } = (
            await intake([
                {
                    text: `${text} (private)`,
                },
            ])
        ).body.items[0]
        await settled(vacancyId).toBe('parsed')

        const stranger = await t.as(STRANGER)
        for (const path of [
            `/api/v1/vacancies/${vacancyId}/parse`,
            '/api/v1/vacancies/019a5f00-0000-7000-8000-000000000999/parse',
            '/api/v1/vacancies/not-a-uuid/parse',
        ]) {
            const res = await stranger.post(path)
            expect(res.status, path).toBe(404)
            expect(res.body.code).toBe('NOT_FOUND')
        }
        expect((await vacancy(vacancyId))?.parseStatus).toBe('parsed')

        const again = await (await t.as()).post(`/api/v1/vacancies/${vacancyId}/parse`)
        expect(again.status).toBe(202)
        await expect.poll(() => callsFor(`${text} (private)`).length).toBe(2)
        await settled(vacancyId).toBe('parsed')
    })
})
