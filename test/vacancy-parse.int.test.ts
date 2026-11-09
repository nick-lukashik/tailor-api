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

const MODELS = [
    'claude-sonnet-5-5',
    'gpt-6.1-sol',
]

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

        const [call] = callsFor(text)
        expect(await vacancy(vacancyId)).toMatchObject({
            parsed: {
                ...parsed,
                _meta: {
                    model: call?.body.model,
                    effort: 'low',
                    promptVersion: 1,
                },
            },
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

        expect(call).toMatchObject({
            path: '/api/v1/chat/completions',
            authorization: `Bearer ${LLM_TEST_KEY}`,
            idempotencyKey: expect.stringMatching(/^vacancy-parse-/),
            body: {
                model: expect.toBeOneOf(MODELS),
                reasoning_effort: 'low',
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
        // Not a provider outage: the same model again.
        expect(attempts[1]?.body.model).toBe(attempts[0]?.body.model)
        expect(
            await t.metric('vacancy_parse_total', {
                result: 'retry',
                model: attempts[0]?.body.model ?? '',
            }),
        ).toBeGreaterThanOrEqual(1)
    }, 30_000)

    it('spreads a batch over both models with their effort', async () => {
        const markers = [
            `${text} (pool a)`,
            `${text} (pool b)`,
        ]
        const res = await intake(
            markers.map(marker => ({
                text: marker,
            })),
        )
        for (const item of res.body.items) await settled(item.vacancyId).toBe('parsed')
        const calls = markers.flatMap(marker => callsFor(marker))
        expect(calls.map(call => call.body.model).sort()).toEqual(MODELS)
        expect(calls.map(call => call.body.reasoning_effort)).toEqual([
            'low',
            'low',
        ])
        for (const [index, item] of res.body.items.entries())
            expect((await vacancy(item.vacancyId))?.parsed).toMatchObject({
                _meta: {
                    model: calls[index]?.body.model,
                    effort: 'low',
                },
            })
        for (const model of MODELS)
            expect(
                await t.metric('vacancy_parse_total', {
                    result: 'parsed',
                    model,
                }),
            ).toBeGreaterThanOrEqual(1)
    })

    it('moves a vacancy to the other model when its provider is out of quota', async () => {
        const marker = `${text} (quota)`
        let out: string | undefined
        t.llm.answer(call => {
            if (!call.body.messages.some(message => message.content.includes(marker))) return completionOf(parsed)
            out ??= call.body.model
            return call.body.model === out ? errorOf(429, 'provider_quota') : completionOf(parsed)
        })
        const { vacancyId } = (
            await intake([
                {
                    text: marker,
                },
            ])
        ).body.items[0]
        await settled(vacancyId).toBe('parsed')
        const attempts = callsFor(marker)
        expect(attempts).toHaveLength(2)
        const [first, second] = attempts.map(call => call.body.model)
        expect(second).not.toBe(first)
        expect(attempts[1]?.idempotencyKey).not.toBe(attempts[0]?.idempotencyKey)
        expect((await vacancy(vacancyId))?.parsed).toMatchObject({
            _meta: {
                model: second,
            },
        })
        expect(
            await t.metric('vacancy_parse_total', {
                result: 'moved',
                model: first ?? '',
            }),
        ).toBe(1)
    })

    it('moves only once: a second outage retries on the model it moved to', async () => {
        const marker = `${text} (quota twice)`
        t.llm.answer(call =>
            call.body.messages.some(message => message.content.includes(marker))
                ? errorOf(503, 'provider_unavailable')
                : completionOf(parsed),
        )
        await intake([
            {
                text: marker,
            },
        ])
        await expect
            .poll(() => callsFor(marker).length, {
                timeout: 20_000,
            })
            .toBeGreaterThanOrEqual(3)
        const [first, second, third] = callsFor(marker).map(call => call.body.model)
        expect(second).not.toBe(first)
        expect(third).toBe(second)
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
