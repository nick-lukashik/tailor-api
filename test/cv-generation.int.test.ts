import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { applications, cvs, vacancies } from '../src/db/schema.js'
import type { CvDocument } from '../src/tex/cv-document.js'
import type { ParsedVacancy } from '../src/vacancies/parse.schemas.js'
import { analysis, composition, parsed, scripted } from './fixtures/cv-answers.js'
import { exampleProfile } from './fixtures/profile.js'
import { OWNER, startApp, type TestApp } from './harness.js'
import { completionOf, errorOf } from './llm-gateway.js'
import { type FakeTex, pdfOf, startTex, TEX_TEST_TOKEN } from './tailor-tex.js'

const STRANGER = '019a5f00-0000-7000-8000-00000000e005'
const FILE_NAME = 'Alex-Example-Senior-Backend-Engineer-CV.pdf'

const download = (t: TestApp, path: string) =>
    t
        .http()
        .get(path)
        .buffer(true)
        .parse((stream, done) => {
            const chunks: Buffer[] = []
            stream.on('data', (chunk: Buffer) => chunks.push(chunk))
            stream.on('end', () => done(null, Buffer.concat(chunks)))
        })

describe('CV generation', () => {
    let t: TestApp
    let tex: FakeTex

    beforeAll(async () => {
        tex = await startTex()
        t = await startApp({
            TAILOR_TEX_URL: tex.url,
            TAILOR_TEX_TOKEN: TEX_TEST_TOKEN,
        })
        expect((await (await t.as()).put('/api/v1/profile').send(exampleProfile())).status).toBe(200)
    })
    afterAll(async () => {
        await t?.close()
        await tex?.close()
        delete process.env.TAILOR_TEX_TOKEN
    })
    beforeEach(() => {
        tex.reset()
        t.llm.calls.length = 0
        t.llm.answer(scripted())
    })

    const cvRows = (applicationId: string) =>
        t.db.select().from(cvs).where(eq(cvs.applicationId, applicationId)).orderBy(cvs.version)
    const settled = (applicationId: string, version = 1, timeout = 20_000) =>
        expect.poll(async () => (await cvRows(applicationId)).find(row => row.version === version)?.status, {
            timeout,
            interval: 200,
        })
    /** A parsed vacancy and the owner's application for it, without going through the parse job. */
    const parsedApplication = async (
        userId = OWNER,
        parseStatus: 'parsed' | 'pending' = 'parsed',
        vacancy: ParsedVacancy = parsed,
    ) => {
        const [row] = await t.db
            .insert(vacancies)
            .values({
                rawText: 'Example Labs hires a Senior Backend Engineer.',
                title: vacancy.title ?? '',
                company: vacancy.company ?? '',
                parseStatus,
                parsed: parseStatus === 'parsed' ? vacancy : null,
                createdBy: userId,
            })
            .returning()
        if (!row) throw new Error('no vacancy')
        const [application] = await t.db
            .insert(applications)
            .values({
                userId,
                vacancyId: row.id,
                company: 'Example Labs',
                role: 'Senior Backend Engineer',
            })
            .returning()
        if (!application) throw new Error('no application')
        return application.id
    }

    it('makes the first CV once the vacancy is parsed and serves it on the CV link', async () => {
        const res = await (await t.as()).post('/api/v1/vacancies/intake').send({
            items: [
                {
                    text: 'Example Labs is hiring a Senior Backend Engineer (Node.js). Keep the checkout fast.',
                },
            ],
        })
        const { applicationId } = res.body.items[0]
        await settled(applicationId).toBe('ready')

        const [row] = await cvRows(applicationId)
        const document = row?.document as CvDocument
        expect(row).toMatchObject({
            version: 1,
            fileName: FILE_NAME,
            fileKey: `tailor/cv/${applicationId}/${row?.id}.pdf`,
            role: 'Senior Backend Engineer',
            effort: 'low',
            promptVersion: 4,
            profileVersion: 1,
            aiRole: false,
            pages: 1,
            error: null,
        })
        expect(row?.analysis).toMatchObject({
            vacancyKind: 'specific',
            aiRole: false,
            requirements: [
                {
                    id: 'R1',
                },
                {
                    id: 'R2',
                },
            ],
        })
        expect(document).toMatchObject({
            name: 'Alex Example',
            headline: 'Senior Backend Engineer',
            summary: [
                'A backend engineer who ships fast services.',
            ],
            jobs: [
                {
                    company: 'Acme Example',
                    bullets: [
                        {
                            id: 'c1',
                            text: 'Rebuilt the checkout on Node.js with server rendering, so it loads 2x as fast.',
                        },
                    ],
                },
            ],
        })
        // D-118: every skill of the vacancy is on the CV, spelled as the vacancy does.
        expect(document.skills.flatMap(skill => skill.items)).toEqual(
            expect.arrayContaining([
                'Node.js',
                'K8s',
                'React',
            ]),
        )

        // The materials written from the ready CV may already be under way (test/materials.int.test.ts).
        const purposes = t.llm.calls.map(call => call.body.metadata?.purpose).filter(purpose => purpose !== 'materials')
        expect(purposes).toEqual([
            'vacancy-parse',
            'cv-analyze',
            'cv-compose',
        ])
        const compose = t.llm.calls[2]
        expect(compose?.body.model).toBe(row?.model)
        expect(compose?.idempotencyKey).toMatch(new RegExp(`^cv-compose-${row?.id}-`))
        // The person's own additions close the system prompt.
        expect(compose?.body.messages[0]?.content).toMatch(/Prefer measurable results\.$/)
        expect(tex.calls.map(call => call.path)).toEqual([
            '/api/v1/cv/measure',
            '/api/v1/cv/render',
        ])

        const detail = await (await t.as()).get(`/api/v1/applications/${applicationId}`)
        expect(detail.body.cvStatus).toBe('ready')
        expect(detail.body.cv).toEqual({
            status: 'ready',
            version: 1,
            url: `https://cv.nick-lukashik.com/${applicationId}/${FILE_NAME}`,
            pages: 1,
            model: row?.model,
            updatedAt: row?.updatedAt.toISOString(),
        })
        const list = await (await t.as()).get('/api/v1/applications')
        expect(list.body.items.find((item: { id: string }) => item.id === applicationId)?.cvStatus).toBe('ready')

        const bare = await t.http().get(`/api/v1/cv/${applicationId}`)
        expect(bare.status).toBe(302)
        expect(bare.headers.location).toBe(`${applicationId}/${FILE_NAME}`)
        const wrong = await t.http().get(`/api/v1/cv/${applicationId}/cv.pdf`)
        expect(wrong.status).toBe(302)
        expect(wrong.headers.location).toBe(FILE_NAME)

        const pdf = await download(t, `/api/v1/cv/${applicationId}/${FILE_NAME}`)
        expect(pdf.status).toBe(200)
        expect(pdf.headers['content-type']).toBe('application/pdf')
        expect(pdf.headers['content-disposition']).toBe(`inline; filename="${FILE_NAME}"`)
        expect(pdf.headers['cache-control']).toBe('private, no-store')
        expect(pdf.headers['x-robots-tag']).toBe('noindex, nofollow')
        expect(Buffer.compare(pdf.body as Buffer, pdfOf(document))).toBe(0)
        expect(Number(pdf.headers['content-length'])).toBe((pdf.body as Buffer).length)

        expect(
            await t.metric('cv_generate_total', {
                result: 'ready',
                model: row?.model ?? '',
            }),
        ).toBeGreaterThanOrEqual(1)
    })

    it('makes a new version on request and the link serves the newest ready one', async () => {
        const applicationId = await parsedApplication()
        const first = await (await t.as()).post(`/api/v1/applications/${applicationId}/cv`)
        expect(first.status).toBe(202)
        expect(first.body).toMatchObject({
            status: 'queued',
            version: 1,
        })
        await settled(applicationId, 1).toBe('ready')

        t.llm.answer(
            scripted({
                cv_composition: () =>
                    completionOf({
                        ...composition,
                        summary: [
                            {
                                id: 'profile',
                                full: 'The second version.',
                                compact: 'Second.',
                            },
                        ],
                    }),
            }),
        )
        const second = await (await t.as()).post(`/api/v1/applications/${applicationId}/cv`)
        expect(second.status).toBe(202)
        expect(second.body.version).toBe(2)
        await settled(applicationId, 2).toBe('ready')
        const rows = await cvRows(applicationId)
        expect(rows.map(row => row.version)).toEqual([
            1,
            2,
        ])
        const newest = rows[1]?.document as CvDocument
        expect(newest.summary).toEqual([
            'The second version.',
        ])
        const pdf = await download(t, `/api/v1/cv/${applicationId}/${FILE_NAME}`)
        expect(Buffer.compare(pdf.body as Buffer, pdfOf(newest))).toBe(0)
        expect((await (await t.as()).get(`/api/v1/applications/${applicationId}`)).body.cv).toMatchObject({
            status: 'ready',
            version: 2,
        })
    })

    it('gives a general vacancy the master CV as is, without the composition', async () => {
        const applicationId = await parsedApplication(OWNER, 'parsed', {
            ...parsed,
            title: 'Talent pool',
        })
        t.llm.answer(
            scripted({
                cv_analysis: () =>
                    completionOf({
                        ...analysis,
                        vacancyKind: 'general',
                        vacancyKindReason: 'A talent pool with no concrete role.',
                    }),
            }),
        )
        await (await t.as()).post(`/api/v1/applications/${applicationId}/cv`)
        await settled(applicationId).toBe('ready')
        const [row] = await cvRows(applicationId)
        expect(row).toMatchObject({
            fileName: 'Alex-Example-Senior-Full-Stack-Engineer-CV.pdf',
            promptVersion: 4,
        })
        expect(row?.analysis).toMatchObject({
            vacancyKind: 'general',
            vacancyKindReason: 'A talent pool with no concrete role.',
        })
        expect(t.llm.calls.map(call => call.body.metadata?.purpose).filter(purpose => purpose !== 'materials')).toEqual(
            [
                'cv-analyze',
            ],
        )

        tex.reset()
        const master = await (await t.as()).get('/api/v1/profile/cv.pdf')
        expect(master.status).toBe(200)
        expect(row?.document).toEqual(tex.calls[0]?.body.document)
        const pdf = await download(t, `/api/v1/cv/${applicationId}/Alex-Example-Senior-Full-Stack-Engineer-CV.pdf`)
        expect(Buffer.compare(pdf.body as Buffer, master.body as Buffer)).toBe(0)
    })

    it('refuses a new version with 409 before the vacancy is parsed or while one is being made', async () => {
        const pending = await parsedApplication(OWNER, 'pending')
        const early = await (await t.as()).post(`/api/v1/applications/${pending}/cv`)
        expect(early.status).toBe(409)
        expect(early.body).toMatchObject({
            code: 'CONFLICT',
            message: 'The vacancy is not parsed yet: its CV is made once it is',
        })

        const byHand = await (await t.as()).post('/api/v1/applications').send({
            company: 'Example Labs',
        })
        expect((await (await t.as()).post(`/api/v1/applications/${byHand.body.id}/cv`)).status).toBe(409)

        const busy = await parsedApplication()
        await t.db.insert(cvs).values({
            applicationId: busy,
            version: 1,
            status: 'generating',
        })
        const again = await (await t.as()).post(`/api/v1/applications/${busy}/cv`)
        expect(again.status).toBe(409)
        expect(again.body.message).toBe('A CV of this application is already being made')
        // A version generating for longer than every try of its job was lost: a new one may start.
        await t.db
            .update(cvs)
            .set({
                updatedAt: new Date(Date.now() - 24 * 3600 * 1000),
            })
            .where(eq(cvs.applicationId, busy))
        const after = await (await t.as()).post(`/api/v1/applications/${busy}/cv`)
        expect(after.status).toBe(202)
        expect(after.body.version).toBe(2)
        await settled(busy, 2).toBe('ready')
    })

    it("answers 404 for someone else's application, on its CV request and its CV link before it is ready", async () => {
        const theirs = await parsedApplication(STRANGER)
        for (const path of [
            `/api/v1/applications/${theirs}/cv`,
            '/api/v1/applications/019a5f00-0000-7000-8000-000000000999/cv',
            '/api/v1/applications/not-a-uuid/cv',
        ]) {
            const res = await (await t.as()).post(path)
            expect(res.status, path).toBe(404)
            expect(res.body.code).toBe('NOT_FOUND')
        }
        expect(await cvRows(theirs)).toEqual([])
        for (const path of [
            `/api/v1/cv/${theirs}`,
            `/api/v1/cv/${theirs}/${FILE_NAME}`,
        ])
            expect((await t.http().get(path)).status).toBe(404)
    })

    it('marks a version failed with the short code of a refused model call', async () => {
        const applicationId = await parsedApplication()
        t.llm.answer(
            scripted({
                cv_composition: () => errorOf(400, 'bad_request'),
            }),
        )
        expect((await (await t.as()).post(`/api/v1/applications/${applicationId}/cv`)).status).toBe(202)
        await settled(applicationId).toBe('failed')
        const [row] = await cvRows(applicationId)
        expect(row).toMatchObject({
            error: 'llm_bad_request',
            fileKey: null,
        })
        expect(t.llm.calls.filter(call => call.idempotencyKey?.startsWith(`cv-compose-${row?.id}-`))).toHaveLength(1)
        expect((await (await t.as()).get(`/api/v1/applications/${applicationId}`)).body.cv).toMatchObject({
            status: 'failed',
            version: 1,
            error: 'llm_bad_request',
        })
        expect((await t.http().get(`/api/v1/cv/${applicationId}`)).status).toBe(404)
        // A failed version does not block the next one.
        t.llm.answer(scripted())
        expect((await (await t.as()).post(`/api/v1/applications/${applicationId}/cv`)).status).toBe(202)
        await settled(applicationId, 2).toBe('ready')
    })

    it('titles the CV in English for a Russian vacancy, never with an entry-level word', async () => {
        const russian: ParsedVacancy = {
            ...parsed,
            title: 'Backend-разработчик Python (начинающий)',
            seniority: 'junior',
            language: 'ru',
            skills: [
                {
                    name: 'Python',
                    required: true,
                },
                {
                    name: 'unit-тесты',
                    required: false,
                },
            ],
        }
        const applicationId = await parsedApplication(OWNER, 'parsed', russian)
        const answer = (title: string) =>
            scripted({
                cv_composition: () =>
                    completionOf({
                        ...composition,
                        title,
                        vacancySkills: [
                            {
                                name: 'Python',
                                english: 'Python',
                                row: 'Frontend',
                            },
                            {
                                name: 'unit-тесты',
                                english: 'Unit testing',
                                row: 'Frontend',
                            },
                        ],
                    }),
            })
        t.llm.answer(answer('Senior Backend Engineer (Python)'))
        await (await t.as()).post(`/api/v1/applications/${applicationId}/cv`)
        await settled(applicationId, 1).toBe('ready')
        const [first] = await cvRows(applicationId)
        expect(first?.fileName).toBe('Alex-Example-Senior-Backend-Engineer-Python-CV.pdf')
        const document = first?.document as CvDocument
        expect(document.headline).toBe('Senior Backend Engineer (Python)')
        const items = document.skills.flatMap(skill => skill.items)
        expect(items).toEqual(
            expect.arrayContaining([
                'Python',
                'Unit testing',
            ]),
        )
        expect(items.filter(item => /[^\x20-\x7E]/.test(item))).toEqual([])

        // A proposal with an entry-level word, and a vacancy title that is not English: the profile's headline.
        t.llm.answer(answer('Junior Python Developer'))
        await (await t.as()).post(`/api/v1/applications/${applicationId}/cv`)
        await settled(applicationId, 2).toBe('ready')
        const second = (await cvRows(applicationId))[1]
        expect(second?.fileName).toBe('Alex-Example-Senior-Full-Stack-Engineer-CV.pdf')
        expect((second?.document as CvDocument | undefined)?.headline).toBe('Senior Full-Stack Engineer')
    })

    it('fails a CV that does not fit the pages as cv_does_not_fit', async () => {
        const applicationId = await parsedApplication()
        tex.answer((call, res) => {
            res.writeHead(200, {
                'content-type': 'application/json',
            })
            res.end(
                JSON.stringify({
                    pages: 3,
                    fill: [
                        1,
                        1,
                        1,
                    ],
                    sizeBytes: 1,
                    fits: false,
                    overfullPt: 0,
                    fontsOk: true,
                    blocks: [],
                    warnings: [],
                    path: call.path,
                }),
            )
        })
        await (await t.as()).post(`/api/v1/applications/${applicationId}/cv`)
        await settled(applicationId).toBe('failed')
        expect((await cvRows(applicationId))[0]?.error).toBe('cv_does_not_fit')
        expect(tex.calls.every(call => call.path === '/api/v1/cv/measure')).toBe(true)
    })
})

describe('CV generation without storage', () => {
    let t: TestApp
    let tex: FakeTex

    beforeAll(async () => {
        tex = await startTex()
        t = await startApp({
            TAILOR_TEX_URL: tex.url,
            TAILOR_TEX_TOKEN: TEX_TEST_TOKEN,
            R2_ENDPOINT: undefined,
            R2_ACCESS_KEY_ID: undefined,
            R2_SECRET_ACCESS_KEY: undefined,
        })
        t.llm.answer(scripted())
        await (await t.as()).put('/api/v1/profile').send(exampleProfile())
    })
    afterAll(async () => {
        await t?.close()
        await tex?.close()
        delete process.env.TAILOR_TEX_TOKEN
    })

    it('fails at once with storage_not_configured, before any model call', async () => {
        const res = await (await t.as()).post('/api/v1/vacancies/intake').send({
            items: [
                {
                    text: 'Example Labs is hiring a Senior Backend Engineer (Node.js).',
                },
            ],
        })
        const { applicationId } = res.body.items[0]
        await expect
            .poll(
                async () =>
                    (
                        await t.db
                            .select()
                            .from(cvs)
                            .where(and(eq(cvs.applicationId, applicationId), eq(cvs.version, 1)))
                    )[0]?.error,
                {
                    timeout: 20_000,
                    interval: 200,
                },
            )
            .toBe('storage_not_configured')
        expect(t.llm.calls.map(call => call.body.metadata?.purpose)).toEqual([
            'vacancy-parse',
        ])
        expect(tex.calls).toEqual([])
    })
})
