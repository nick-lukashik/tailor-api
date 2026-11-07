import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startApp, type TestApp } from './harness.js'

const NAME = 'Nick-Lukashik-Senior-Full-Stack-Engineer-CV.pdf'

describe('cv files', () => {
    let t: TestApp
    let id: string

    beforeAll(async () => {
        t = await startApp()
        const created = await t.http().post('/api/v1/applications').send({
            company: 'Example Labs',
            role: 'Senior Full-stack Engineer',
        })
        id = created.body.id
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

    it('serves the CV of an application inline under its name, never cached or indexed', async () => {
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

    it('redirects the id alone and a wrong name to the canonical link, relative to the path', async () => {
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
})
