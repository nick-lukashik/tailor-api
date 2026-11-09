import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { applications, cvs, materials, vacancies } from '../src/db/schema.js'
import type { MaterialsAnswer } from '../src/materials/materials.schemas.js'
import type { CvDocument } from '../src/tex/cv-document.js'
import { parsed, scripted } from './fixtures/cv-answers.js'
import { exampleProfile } from './fixtures/profile.js'
import { OWNER, startApp, type TestApp } from './harness.js'
import { completionOf } from './llm-gateway.js'
import { type FakeTex, startTex, TEX_TEST_TOKEN } from './tailor-tex.js'

const STRANGER = '019a5f00-0000-7000-8000-00000000e006'
const FILE_NAME = 'Alex-Example-Senior-Backend-Engineer-CV.pdf'

const answer: MaterialsAnswer = {
    coverLetter: 'Hi,\n\nWhat draws me in is a checkout that has to stay fast.\n\nAlex',
    emailSubject: 'Senior Backend Engineer: a checkout 2x as fast',
    emailBody: 'Hello,\n\nI rebuilt a checkout on Node.js so it loads 2x as fast. My CV: {cvUrl}\n\nAlex',
    telegramMessage: 'Hi! I made a checkout 2x as fast on Node.js. CV: {cvUrl}\n\nAlex',
    linkedinNote: 'Hi, about the Senior Backend Engineer role: I made a checkout 2x as fast on Node.js.',
    whyMe: [
        'Node.js in production',
        'A checkout 2x as fast',
        'Owns what he builds',
    ],
    answers: [],
}

const materialsReply = (output: MaterialsAnswer = answer) =>
    scripted({
        application_materials: () => completionOf(output),
    })

describe('Application materials', () => {
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
        t.llm.answer(materialsReply())
    })

    const rows = (applicationId: string) =>
        t.db.select().from(materials).where(eq(materials.applicationId, applicationId)).orderBy(materials.version)
    const settled = (applicationId: string, version = 1) =>
        expect.poll(async () => (await rows(applicationId)).find(row => row.version === version)?.status, {
            timeout: 20_000,
            interval: 200,
        })
    /** The owner's application for a parsed vacancy with a ready CV version, without the jobs. */
    const withReadyCv = async (userId = OWNER) => {
        const [vacancy] = await t.db
            .insert(vacancies)
            .values({
                rawText: 'Example Labs hires a Senior Backend Engineer.',
                title: 'Senior Backend Engineer',
                company: 'Example Labs',
                parseStatus: 'parsed',
                parsed,
                createdBy: userId,
            })
            .returning()
        if (!vacancy) throw new Error('no vacancy')
        const [application] = await t.db
            .insert(applications)
            .values({
                userId,
                vacancyId: vacancy.id,
                company: 'Example Labs',
                role: 'Senior Backend Engineer',
            })
            .returning()
        if (!application) throw new Error('no application')
        const [cv] = await t.db
            .insert(cvs)
            .values({
                applicationId: application.id,
                version: 1,
                status: 'ready',
                fileKey: `tailor/cv/${application.id}/cv.pdf`,
                fileName: FILE_NAME,
                document: {
                    name: 'Alex Example',
                    location: '',
                    phoneDisplay: '',
                    phoneDigits: '',
                    headline: 'Senior Backend Engineer',
                    stack: 'Node.js',
                    links: [],
                    summary: [
                        'A backend engineer who ships fast services.',
                    ],
                    skills: [
                        {
                            label: 'Backend',
                            items: [
                                'Node.js',
                            ],
                        },
                    ],
                    jobs: [
                        {
                            title: 'Engineer',
                            company: 'Acme Example',
                            dates: '2020 - now',
                            location: '',
                            description: '',
                            bullets: [
                                {
                                    id: 'c1',
                                    text: 'Made the checkout 2x as fast on Node.js.',
                                },
                            ],
                        },
                    ],
                    education: [],
                    languages: [],
                    pdf: {
                        title: 'Alex Example CV',
                        subject: 'Senior Backend Engineer',
                        keywords: [],
                    },
                } satisfies CvDocument,
            })
            .returning()
        if (!cv) throw new Error('no cv')
        return {
            applicationId: application.id,
            cvId: cv.id,
        }
    }

    it('writes the materials once a CV version is ready, the CV link in them', async () => {
        const res = await (await t.as()).post('/api/v1/vacancies/intake').send({
            items: [
                {
                    text: 'Example Labs is hiring a Senior Backend Engineer (Node.js). Keep the checkout fast.',
                },
            ],
        })
        const { applicationId } = res.body.items[0]
        await settled(applicationId).toBe('ready')

        const [cv] = await t.db.select().from(cvs).where(eq(cvs.applicationId, applicationId))
        const [row] = await rows(applicationId)
        const link = `https://cv.nick-lukashik.com/${applicationId}/${FILE_NAME}`
        expect(row).toMatchObject({
            cvId: cv?.id,
            version: 1,
            effort: 'low',
            promptVersion: 2,
            error: null,
        })
        expect(row?.content).toEqual({
            language: 'en',
            coverLetter: answer.coverLetter,
            emailSubject: answer.emailSubject,
            emailBody: `Hello,\n\nI rebuilt a checkout on Node.js so it loads 2x as fast. My CV: ${link}\n\nAlex`,
            telegramMessage: `Hi! I made a checkout 2x as fast on Node.js. CV: ${link}\n\nAlex`,
            linkedinNote: answer.linkedinNote,
            whyMe: answer.whyMe,
            answers: [],
        })

        const call = t.llm.calls.find(item => item.body.metadata?.purpose === 'materials')
        expect(call?.body.model).toBe(row?.model)
        expect(call?.idempotencyKey).toMatch(new RegExp(`^materials-${row?.id}-`))
        // The person's own letter instructions close the system prompt; the CV just built is the data.
        expect(call?.body.messages[0]?.content).toMatch(/End every text with a question\.$/)
        expect(call?.body.messages[1]?.content).toContain('Rebuilt the checkout on Node.js with server rendering')

        const detail = await (await t.as()).get(`/api/v1/applications/${applicationId}`)
        expect(detail.body.materialsStatus).toBe('ready')
        expect(detail.body.materials).toEqual({
            status: 'ready',
            version: 1,
            content: row?.content,
            updatedAt: row?.updatedAt.toISOString(),
        })
        const list = await (await t.as()).get('/api/v1/applications')
        expect(list.body.items.find((item: { id: string }) => item.id === applicationId)?.materialsStatus).toBe('ready')
        expect(
            await t.metric('materials_generate_total', {
                result: 'ready',
            }),
        ).toBeGreaterThanOrEqual(1)
    })

    it('regenerates on request with 202, keeping the ready texts shown until the new ones are', async () => {
        const { applicationId, cvId } = await withReadyCv()
        const empty = await (await t.as()).get(`/api/v1/applications/${applicationId}`)
        expect(empty.body.materials).toEqual({
            status: 'none',
        })
        expect(empty.body.materialsStatus).toBe('none')

        const first = await (await t.as()).post(`/api/v1/applications/${applicationId}/materials`)
        expect(first.status).toBe(202)
        expect(first.body).toMatchObject({
            status: 'queued',
            version: 1,
        })
        await settled(applicationId, 1).toBe('ready')

        t.llm.answer(
            materialsReply({
                ...answer,
                linkedinNote: 'The second note.',
            }),
        )
        const second = await (await t.as()).post(`/api/v1/applications/${applicationId}/materials`)
        expect(second.status).toBe(202)
        expect(second.body.version).toBe(2)
        await settled(applicationId, 2).toBe('ready')
        const all = await rows(applicationId)
        expect(all.map(row => row.cvId)).toEqual([
            cvId,
            cvId,
        ])
        const detail = await (await t.as()).get(`/api/v1/applications/${applicationId}`)
        expect(detail.body.materials).toMatchObject({
            status: 'ready',
            version: 2,
            content: {
                linkedinNote: 'The second note.',
            },
        })
    })

    it('refuses with 409 without a ready CV or while a version is being written', async () => {
        const byHand = await (await t.as()).post('/api/v1/applications').send({
            company: 'Example Labs',
        })
        const early = await (await t.as()).post(`/api/v1/applications/${byHand.body.id}/materials`)
        expect(early.status).toBe(409)
        expect(early.body).toMatchObject({
            code: 'CONFLICT',
            message: 'No CV of this application is ready: its materials follow it',
        })

        const { applicationId, cvId } = await withReadyCv()
        await t.db.insert(materials).values({
            applicationId,
            cvId,
            version: 1,
            status: 'generating',
        })
        const busy = await (await t.as()).post(`/api/v1/applications/${applicationId}/materials`)
        expect(busy.status).toBe(409)
        expect(busy.body.message).toBe('The materials of this application are already being written')
        expect(await rows(applicationId)).toHaveLength(1)
    })

    it("answers 404 for someone else's application", async () => {
        const { applicationId } = await withReadyCv(STRANGER)
        for (const path of [
            `/api/v1/applications/${applicationId}/materials`,
            '/api/v1/applications/not-a-uuid/materials',
        ]) {
            const res = await (await t.as()).post(path)
            expect(res.status, path).toBe(404)
        }
        expect(await rows(applicationId)).toEqual([])
    })

    it('marks an application as sent, only the own one and only with a known status', async () => {
        const { applicationId } = await withReadyCv()
        const sent = await (await t.as()).patch(`/api/v1/applications/${applicationId}`).send({
            status: 'sent',
        })
        expect(sent.status).toBe(200)
        expect(sent.body).toMatchObject({
            id: applicationId,
            status: 'sent',
            cvStatus: 'ready',
            materialsStatus: 'none',
        })
        expect((await (await t.as()).get(`/api/v1/applications/${applicationId}`)).body.status).toBe('sent')

        for (const body of [
            {
                status: 'archived',
            },
            {
                status: 'sent',
                company: 'Other',
            },
        ]) {
            const res = await (await t.as()).patch(`/api/v1/applications/${applicationId}`).send(body)
            expect(res.status).toBe(400)
        }

        const theirs = await withReadyCv(STRANGER)
        const foreign = await (await t.as()).patch(`/api/v1/applications/${theirs.applicationId}`).send({
            status: 'rejected',
        })
        expect(foreign.status).toBe(404)
        const [row] = await t.db.select().from(applications).where(eq(applications.id, theirs.applicationId))
        expect(row?.status).toBe('new')
    })
})
