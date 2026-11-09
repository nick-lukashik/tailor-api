import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { buildDemoPdf } from '../src/cv/demo-pdf.js'
import type { CvDocument } from '../src/tex/cv-document.js'

export const TEX_TEST_TOKEN = 'test-tex-token-0123456789abcdef0123456789'

/** Characters of the request's document per page: a stand-in for the layout. */
export const CHARS_PER_PAGE = 6_000

export type TexCall = {
    path: string
    body: {
        document: CvDocument
        template: string
        maxPages: number
    }
}

type Answer = (call: TexCall, res: ServerResponse) => void

const read = async (request: IncomingMessage) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk as Buffer)
    return Buffer.concat(chunks).toString('utf8')
}

const pagesOf = (document: CvDocument) => Math.max(1, Math.ceil(JSON.stringify(document).length / CHARS_PER_PAGE))

/** The PDF the stand-in renders: its first line names the headline, so a test can tell versions apart. */
export const pdfOf = (document: CvDocument) =>
    buildDemoPdf([
        document.name,
        document.headline,
        document.jobs.flatMap(job => job.bullets.map(bullet => bullet.id)).join(' '),
    ])

/**
 * A stand-in for tailor-tex's internal API: `measure` answers pages from the
 * size of the request's document and lines per block from their length,
 * `render` a small PDF with `x-pdf-pages`. Records every call.
 */
export async function startTex() {
    const calls: TexCall[] = []
    const ok: Answer = (call, res) => {
        const pages = pagesOf(call.body.document)
        if (call.path === '/api/v1/cv/measure') {
            const { document } = call.body
            res.writeHead(200, {
                'content-type': 'application/json',
            })
            res.end(
                JSON.stringify({
                    pages,
                    fill: Array.from(
                        {
                            length: pages,
                        },
                        () => 0.8,
                    ),
                    sizeBytes: 1000,
                    fits: pages <= call.body.maxPages,
                    overfullPt: 0,
                    fontsOk: true,
                    blocks: [
                        ...document.summary.map((text, index) => ({
                            id: `summary:${index}`,
                            lines: Math.ceil(text.length / 100),
                        })),
                        ...document.skills.map((_, index) => ({
                            id: `skill:${index}`,
                            lines: 1,
                        })),
                        ...document.jobs.flatMap(job =>
                            job.bullets.map(bullet => ({
                                id: `bullet:${bullet.id}`,
                                lines: Math.ceil(bullet.text.length / 100),
                            })),
                        ),
                    ],
                    warnings: [],
                }),
            )
            return
        }
        const pdf = pdfOf(call.body.document)
        res.writeHead(200, {
            'content-type': 'application/pdf',
            'content-length': String(pdf.length),
            'x-pdf-pages': String(pages),
            'x-pdf-fill': '0.8',
        })
        res.end(pdf)
    }
    let answer = ok
    const server: Server = createServer(async (req, res) => {
        const call: TexCall = {
            path: req.url ?? '',
            body: JSON.parse((await read(req)) || '{}'),
        }
        calls.push(call)
        if (req.headers.authorization !== `Bearer ${TEX_TEST_TOKEN}`) {
            res.writeHead(401).end()
            return
        }
        answer(call, res)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('no address')
    return {
        url: `http://127.0.0.1:${address.port}`,
        calls,
        answer: (next: Answer) => {
            answer = next
        },
        reset: () => {
            calls.length = 0
            answer = ok
        },
        close: () => new Promise<void>(resolve => server.close(() => resolve())),
    }
}
export type FakeTex = Awaited<ReturnType<typeof startTex>>
