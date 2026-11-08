import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildDemoPdf } from '../src/cv/demo-pdf.js'
import { exampleProfile } from './fixtures/profile.js'
import { OWNER, startApp, type TestApp } from './harness.js'

const TOKEN = 'test-tex-token-0123456789abcdef0123456789'
const PATH = '/api/v1/profile/cv.pdf'
const NAME = 'Alex-Example-Senior-Full-Stack-Engineer-CV.pdf'
const PDF = buildDemoPdf([
    'Alex Example',
    'A fake tailor-tex build.',
])

type Answer = (req: IncomingMessage, res: ServerResponse) => void
type Received = {
    path: string | undefined
    authorization: string | undefined
    body: {
        document: Record<string, unknown>
        template: string
        maxPages: number
    }
}

/** A stand-in for tailor-tex: records each render and answers with `answer`. */
async function startTex() {
    const received: Received[] = []
    let answer: Answer = (_req, res) => {
        res.writeHead(200, {
            'content-type': 'application/pdf',
            'content-length': String(PDF.length),
            'x-pdf-pages': '1',
            'x-pdf-fill': '0.42',
        })
        res.end(PDF)
    }
    const ok = answer
    const server: Server = createServer(async (req, res) => {
        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(chunk as Buffer)
        received.push({
            path: req.url,
            authorization: req.headers.authorization,
            body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
        })
        answer(req, res)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('no address')
    return {
        url: `http://127.0.0.1:${address.port}`,
        received,
        answer: (next: Answer) => {
            answer = next
        },
        reset: () => {
            received.length = 0
            answer = ok
        },
        close: () => new Promise<void>(resolve => server.close(() => resolve())),
    }
}

const texError =
    (status: number, code: string, message: string, details?: unknown): Answer =>
    (_req, res) => {
        res.writeHead(status, {
            'content-type': 'application/json',
        })
        res.end(
            JSON.stringify({
                code,
                message,
                ...(details
                    ? {
                          details,
                      }
                    : {}),
                requestId: 'tex-request',
            }),
        )
    }

describe('master CV', () => {
    let t: TestApp
    let tex: Awaited<ReturnType<typeof startTex>>

    beforeAll(async () => {
        tex = await startTex()
        t = await startApp({
            TAILOR_TEX_URL: tex.url,
            TAILOR_TEX_TOKEN: TOKEN,
        })
    })
    afterAll(async () => {
        await t?.close()
        await tex?.close()
    })
    beforeEach(() => tex.reset())

    const pdf = async () =>
        (await t.as())
            .get(PATH)
            .buffer(true)
            .parse((stream, done) => {
                const chunks: Buffer[] = []
                stream.on('data', (chunk: Buffer) => chunks.push(chunk))
                stream.on('end', () => done(null, Buffer.concat(chunks)))
            })

    it('is 404 without a profile, and asks tailor-tex for nothing', async () => {
        const res = await (await t.as()).get(PATH)
        expect(res.status).toBe(404)
        expect(res.body.code).toBe('NOT_FOUND')
        expect(tex.received).toEqual([])
    })

    it('needs a token (401) of an invited person (403)', async () => {
        const anonymous = await t.http().get(PATH)
        expect(anonymous.status).toBe(401)
        expect(anonymous.body.code).toBe('UNAUTHORIZED')
        const stranger = await (await t.as('019a5f00-0000-7000-8000-00000000f006')).get(PATH)
        expect(stranger.status).toBe(403)
        expect(stranger.body.code).toBe('NOT_INVITED')
        expect(tex.received).toEqual([])
    })

    it('streams the PDF tailor-tex built from the profile, inline under the CV name', async () => {
        expect((await (await t.as()).put('/api/v1/profile').send(exampleProfile())).status).toBe(200)
        const res = await pdf()
        expect(res.status).toBe(200)
        expect(res.headers['content-type']).toBe('application/pdf')
        expect(res.headers['content-disposition']).toBe(`inline; filename="${NAME}"`)
        expect(res.headers['cache-control']).toBe('private, no-store')
        expect(Number(res.headers['content-length'])).toBe(PDF.length)
        expect(Buffer.compare(res.body as Buffer, PDF)).toBe(0)

        const [render, ...more] = tex.received
        expect(more).toEqual([])
        expect(render?.path).toBe('/api/v1/cv/render')
        expect(render?.authorization).toBe(`Bearer ${TOKEN}`)
        expect(render?.body.template).toBe('minimal-violet')
        expect(render?.body.maxPages).toBe(2)
        expect(render?.body.document).toMatchObject({
            name: 'Alex Example',
            headline: 'Senior Full-Stack Engineer',
            phoneDigits: '+15550100000',
            jobs: [
                {
                    company: 'Acme Example',
                    dates: 'Mar 2022 – Present',
                    bullets: [
                        {
                            id: 'c1',
                            text: 'Rebuilt the checkout with server rendering, so it loads twice as fast.',
                        },
                    ],
                },
            ],
        })
    })

    it('answers 422 with what a CV needs, before any build', async () => {
        const document = exampleProfile()
        document.summary = []
        await (await t.as(OWNER)).put('/api/v1/profile').send(document)
        const res = await (await t.as()).get(PATH)
        expect(res.status).toBe(422)
        expect(res.body).toMatchObject({
            code: 'UNPROCESSABLE',
            message: 'The profile does not make a CV yet',
            details: [
                {
                    path: 'summary',
                    message: expect.stringMatching(/^CV summary: /),
                },
            ],
        })
        expect(tex.received).toEqual([])
        await (await t.as(OWNER)).put('/api/v1/profile').send(exampleProfile())
    })

    it("maps tailor-tex's errors: 422 with its message, 503 when busy or failing, 504 when slow", async () => {
        const cases: [
            Answer,
            number,
            Record<string, unknown>,
        ][] = [
            [
                texError(422, 'UNPROCESSABLE', 'The CV takes 3 pages, more than 2'),
                422,
                {
                    code: 'UNPROCESSABLE',
                    message: 'The CV takes 3 pages, more than 2',
                },
            ],
            [
                texError(422, 'UNPROCESSABLE', 'TeX failed', [
                    {
                        path: 'log',
                        message: '! Undefined control sequence.',
                    },
                ]),
                422,
                {
                    code: 'UNPROCESSABLE',
                    message: 'TeX failed',
                    details: [
                        {
                            path: 'log',
                            message: '! Undefined control sequence.',
                        },
                    ],
                },
            ],
            [
                texError(400, 'VALIDATION_FAILED', 'Request validation failed', [
                    {
                        path: 'document.name',
                        message: 'Too big',
                    },
                ]),
                422,
                {
                    code: 'UNPROCESSABLE',
                    message: 'The profile does not fit the CV template',
                },
            ],
            [
                texError(429, 'RATE_LIMITED', 'Every build slot is busy'),
                503,
                {
                    code: 'UNAVAILABLE',
                    message: 'The CV renderer is busy, retry in a minute',
                },
            ],
            [
                texError(504, 'TIMEOUT', 'TeX build timed out'),
                504,
                {
                    code: 'TIMEOUT',
                    message: 'The CV took too long to build',
                },
            ],
            [
                texError(401, 'UNAUTHORIZED', 'Service token required'),
                503,
                {
                    code: 'UNAVAILABLE',
                    message: 'The CV renderer is unavailable, retry later',
                },
            ],
            [
                (_req, res) => {
                    res.writeHead(500)
                    res.end('not json')
                },
                503,
                {
                    code: 'UNAVAILABLE',
                },
            ],
        ]
        for (const [answer, status, body] of cases) {
            tex.answer(answer)
            const res = await (await t.as()).get(PATH)
            expect(res.status, JSON.stringify(body)).toBe(status)
            expect(res.body).toMatchObject({
                ...body,
                requestId: res.headers['x-request-id'],
            })
        }
    })
})

describe('master CV: tailor-tex not there', () => {
    let t: TestApp

    afterAll(async () => {
        await t?.close()
        delete process.env.TAILOR_TEX_TOKEN
    })

    it('answers 503 when nothing listens at TAILOR_TEX_URL', async () => {
        t = await startApp({
            TAILOR_TEX_URL: 'http://127.0.0.1:9',
            TAILOR_TEX_TOKEN: TOKEN,
        })
        await (await t.as()).put('/api/v1/profile').send(exampleProfile())
        const res = await (await t.as()).get(PATH)
        expect(res.status).toBe(503)
        expect(res.body).toMatchObject({
            code: 'UNAVAILABLE',
            message: 'The CV renderer is unavailable, retry later',
        })
        await t.close()
    })

    it('answers 503 with the reason without TAILOR_TEX_TOKEN', async () => {
        delete process.env.TAILOR_TEX_TOKEN
        t = await startApp()
        await (await t.as()).put('/api/v1/profile').send(exampleProfile())
        const res = await (await t.as()).get(PATH)
        expect(res.status).toBe(503)
        expect(res.body).toEqual({
            code: 'UNAVAILABLE',
            message: 'PDF rendering is not configured on this server (TAILOR_TEX_TOKEN)',
            requestId: res.headers['x-request-id'],
        })
    })
})
