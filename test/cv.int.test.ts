import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startApp, type TestApp } from './harness.js'

describe('cv files', () => {
    let t: TestApp

    beforeAll(async () => {
        t = await startApp()
    })
    afterAll(async () => {
        await t?.close()
    })

    it('serves the demo CV inline as a PDF, never cached or indexed', async () => {
        const res = await t
            .http()
            .get('/api/v1/cv/demo')
            .buffer(true)
            .parse((stream, done) => {
                const chunks: Buffer[] = []
                stream.on('data', (chunk: Buffer) => chunks.push(chunk))
                stream.on('end', () => done(null, Buffer.concat(chunks)))
            })
        expect(res.status).toBe(200)
        expect(res.headers['content-type']).toBe('application/pdf')
        expect(res.headers['content-disposition']).toBe('inline; filename="cv.pdf"')
        expect(res.headers['cache-control']).toBe('private, no-store')
        expect(res.headers['x-robots-tag']).toBe('noindex, nofollow')
        const body = res.body as Buffer
        expect(body.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4')
        expect(body.subarray(-6).toString('latin1')).toBe('%%EOF\n')
        expect(Number(res.headers['content-length'])).toBe(body.length)
    })

    it('answers 404 with the contract body for any other code', async () => {
        for (const code of [
            'unknown',
            'DEMO',
            '..',
        ]) {
            const res = await t.http().get(`/api/v1/cv/${code}`)
            expect(res.status).toBe(404)
            expect(res.body.code).toBe('NOT_FOUND')
        }
    })
})
