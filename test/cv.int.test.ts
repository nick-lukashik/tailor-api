import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startApp, type TestApp } from './harness.js'

const NAME = 'Nick-Lukashik-Senior-Full-Stack-Engineer-CV.pdf'
/** A demo row of 0001: no person, so the demo PDF is served for it. */
const id = '019a5f00-0000-7000-8000-000000000001'

describe('cv files', () => {
    let t: TestApp
    let real: string

    beforeAll(async () => {
        t = await startApp()
        await t.db.execute(
            sql`insert into applications (id, company, role) values (${id}, 'Example Labs', 'Senior Full-stack Engineer') on conflict do nothing`,
        )
        const created = await (await t.as()).post('/api/v1/applications').send({
            company: 'Example Labs',
            role: 'Senior Full-stack Engineer',
        })
        real = created.body.id
    })
    afterAll(async () => {
        await t?.close()
    })

    const pdf = (path: string) =>
        t
            .http()
            .get(path)
            .buffer(true)
            .parse((stream, done) => {
                const chunks: Buffer[] = []
                stream.on('data', (chunk: Buffer) => chunks.push(chunk))
                stream.on('end', () => done(null, Buffer.concat(chunks)))
            })

    it('serves the demo CV of a demo row inline under its name with no token, never cached or indexed', async () => {
        const res = await pdf(`/api/v1/cv/${id}/${NAME}`)
        expect(res.status).toBe(200)
        expect(res.headers['content-type']).toBe('application/pdf')
        expect(res.headers['content-disposition']).toBe(`inline; filename="${NAME}"`)
        expect(res.headers['cache-control']).toBe('private, no-store')
        expect(res.headers['x-robots-tag']).toBe('noindex, nofollow')
        const body = res.body as Buffer
        expect(body.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4')
        expect(body.subarray(-6).toString('latin1')).toBe('%%EOF\n')
        expect(Number(res.headers['content-length'])).toBe(body.length)
    })

    it('redirects the id alone and a wrong name of a demo row to the canonical link, relative to the path', async () => {
        const bare = await t.http().get(`/api/v1/cv/${id}`)
        expect(bare.status).toBe(302)
        expect(bare.headers.location).toBe(`${id}/${NAME}`)
        expect(bare.headers['cache-control']).toBe('no-store')

        const wrong = await t.http().get(`/api/v1/cv/${id}/cv.pdf`)
        expect(wrong.status).toBe(302)
        expect(wrong.headers.location).toBe(NAME)
    })

    it('answers 404 with the contract body for an unknown or malformed id', async () => {
        for (const path of [
            '/api/v1/cv/01a19d24-0000-7000-8000-000000000000',
            `/api/v1/cv/01a19d24-0000-7000-8000-000000000000/${NAME}`,
            '/api/v1/cv/demo',
            `/api/v1/cv/not-a-uuid/${NAME}`,
            `/api/v1/cv/${id}/${NAME}/more`,
        ]) {
            const res = await t.http().get(path)
            expect(res.status).toBe(404)
            expect(res.body.code).toBe('NOT_FOUND')
        }
    })

    it('answers 404 for a real application until its CV is built', async () => {
        for (const path of [
            `/api/v1/cv/${real}`,
            `/api/v1/cv/${real}/${NAME}`,
            `/api/v1/cv/${real}/cv.pdf`,
        ]) {
            const res = await t.http().get(path)
            expect(res.status).toBe(404)
            expect(res.body.code).toBe('NOT_FOUND')
        }
    })
})
