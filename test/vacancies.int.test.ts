import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { applications, vacancies } from '../src/db/schema.js'
import { OWNER, startApp, type TestApp } from './harness.js'

/** With the role too: a second person adding the same vacancies. */
const other = '019a5f00-0000-7000-8000-00000000b012'

type IntakeItem = {
    url?: string
    text?: string
}

describe('vacancy intake', () => {
    let t: TestApp

    beforeAll(async () => {
        t = await startApp()
    })
    afterAll(async () => {
        await t?.close()
    })

    const intake = async (items: IntakeItem[], userId = OWNER) =>
        (await t.as(userId)).post('/api/v1/vacancies/intake').send({
            items,
        })
    const vacancyRows = (urlKey: string) => t.db.select().from(vacancies).where(eq(vacancies.urlKey, urlKey))

    it('puts a batch into the pool in input order, unparsed', async () => {
        const res = await intake([
            {
                url: 'https://example.com/batch/1',
            },
            {
                text: 'Backend engineer at Example',
            },
            {
                url: 'https://example.com/batch/3',
                text: 'Frontend engineer',
            },
        ])
        expect(res.status).toBe(200)
        expect(res.body).toEqual({
            created: 3,
            existing: 0,
            items: Array.from(
                {
                    length: 3,
                },
                () => ({
                    applicationId: expect.any(String),
                    vacancyId: expect.any(String),
                    result: 'created',
                }),
            ),
        })
        const ids = res.body.items.map((item: { applicationId: string }) => item.applicationId)
        expect(
            [
                ...ids,
            ].sort(),
        ).toEqual(ids)

        const [first, second, third] = await Promise.all(
            res.body.items.map(
                async (item: { applicationId: string }) =>
                    (await (await t.as()).get(`/api/v1/applications/${item.applicationId}`)).body,
            ),
        )
        expect(first).toMatchObject({
            vacancyId: res.body.items[0].vacancyId,
            parseStatus: 'pending',
            company: '',
            role: '',
            vacancyUrl: 'https://example.com/batch/1',
            vacancyText: '',
            status: 'new',
        })
        expect(second).toMatchObject({
            vacancyId: res.body.items[1].vacancyId,
            parseStatus: 'pending',
            vacancyUrl: null,
        })
        expect(third.vacancyUrl).toBe('https://example.com/batch/3')

        const [stored] = await vacancyRows('https://example.com/batch/3')
        expect(stored).toMatchObject({
            id: res.body.items[2].vacancyId,
            url: 'https://example.com/batch/3',
            rawText: 'Frontend engineer',
            parseStatus: 'pending',
            parsed: null,
            createdBy: OWNER,
        })

        const list = await (await t.as()).get('/api/v1/applications?limit=50')
        expect(list.body.items.slice(0, 3).map((item: { id: string }) => item.id)).toEqual(
            [
                ...ids,
            ].reverse(),
        )
        expect(list.body.items[0].parseStatus).toBe('pending')
    })

    it('finds the same link again behind tracking params, www and a slash', async () => {
        const first = await intake([
            {
                url: 'https://example.com/same/1',
            },
        ])
        expect(first.body.created).toBe(1)
        const again = await intake([
            {
                url: 'https://example.com/same/1',
            },
            {
                url: 'https://www.Example.com/same/1/?utm_source=feed&gclid=x#apply',
            },
        ])
        expect(again.status).toBe(200)
        expect(again.body).toEqual({
            created: 0,
            existing: 2,
            items: [
                first.body.items[0],
                first.body.items[0],
            ].map(item => ({
                ...item,
                result: 'existing',
            })),
        })
        expect(await vacancyRows('https://example.com/same/1')).toHaveLength(1)
        expect(await t.db.$count(applications, eq(applications.vacancyId, first.body.items[0].vacancyId))).toBe(1)
    })

    it('treats the same link twice in one batch as one vacancy', async () => {
        const res = await intake([
            {
                url: 'https://example.com/twice/1?b=2&a=1',
            },
            {
                url: 'https://example.com/twice/1?a=1&b=2&ref=mail',
            },
        ])
        expect(res.body.created).toBe(1)
        expect(res.body.existing).toBe(1)
        expect(res.body.items[1]).toEqual({
            ...res.body.items[0],
            result: 'existing',
        })
    })

    it('always creates a vacancy for a text without a link', async () => {
        const items = [
            {
                text: 'The same text',
            },
            {
                text: 'The same text',
            },
        ]
        const first = await intake(items)
        const second = await intake(items)
        const vacancyIds = [
            ...first.body.items,
            ...second.body.items,
        ].map((item: { vacancyId: string }) => item.vacancyId)
        expect(first.body.created).toBe(2)
        expect(second.body.created).toBe(2)
        expect(new Set(vacancyIds).size).toBe(4)
    })

    it("gives a second person their own application on the same vacancy, and keeps the owner's private", async () => {
        const mine = await intake([
            {
                url: 'https://example.com/shared/1',
            },
        ])
        const theirs = await intake(
            [
                {
                    url: 'https://example.com/shared/1?utm_campaign=x',
                },
            ],
            other,
        )
        expect(theirs.body.created).toBe(1)
        expect(theirs.body.items[0].vacancyId).toBe(mine.body.items[0].vacancyId)
        expect(theirs.body.items[0].applicationId).not.toBe(mine.body.items[0].applicationId)
        expect(await vacancyRows('https://example.com/shared/1')).toHaveLength(1)

        const own = await (await t.as(other)).get(`/api/v1/applications/${theirs.body.items[0].applicationId}`)
        expect(own.body.vacancyUrl).toBe('https://example.com/shared/1?utm_campaign=x')
        expect((await (await t.as(other)).get(`/api/v1/applications/${mine.body.items[0].applicationId}`)).status).toBe(
            404,
        )
    })

    it('fills an empty raw text of a known vacancy and keeps a text it already has', async () => {
        await intake([
            {
                url: 'https://example.com/fill/1',
            },
        ])
        const filled = await intake(
            [
                {
                    url: 'https://example.com/fill/1',
                    text: 'The text of the vacancy',
                },
            ],
            other,
        )
        expect(filled.body.created).toBe(1)
        const kept = await intake([
            {
                url: 'https://example.com/fill/1',
                text: 'Another text',
            },
        ])
        expect(kept.body.existing).toBe(1)
        const rows = await vacancyRows('https://example.com/fill/1')
        expect(rows).toHaveLength(1)
        expect(rows[0]?.rawText).toBe('The text of the vacancy')
        expect(rows[0]?.createdBy).toBe(OWNER)
    })

    it('rejects an empty item, more than 200 items and a bad link, writing nothing', async () => {
        const before = await t.db.$count(vacancies)
        const empty = await intake([
            {
                url: 'https://example.com/rejected/1',
            },
            {},
        ])
        expect(empty.status).toBe(400)
        expect(empty.body).toMatchObject({
            code: 'VALIDATION_FAILED',
            details: [
                {
                    path: 'items.1',
                },
            ],
        })

        const many = await intake(
            Array.from(
                {
                    length: 201,
                },
                (_, i) => ({
                    text: `Vacancy ${i}`,
                }),
            ),
        )
        expect(many.status).toBe(400)
        expect(many.body.details[0].path).toBe('items')

        const bad = await intake([
            {
                url: 'ftp://example.com/jobs/1',
            },
        ])
        expect(bad.status).toBe(400)
        expect(bad.body.details[0].path).toBe('items.0.url')

        const none = await (await t.as()).post('/api/v1/vacancies/intake').send({
            items: [],
        })
        expect(none.status).toBe(400)
        expect(await t.db.$count(vacancies)).toBe(before)
    })
})
