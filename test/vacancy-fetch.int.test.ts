import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { materials, vacancies } from '../src/db/schema.js'
import { type MaterialsAnswer, materialsContentSchema } from '../src/materials/materials.schemas.js'
import { scripted } from './fixtures/cv-answers.js'
import { exampleProfile } from './fixtures/profile.js'
import {
    ashbyBoard,
    greenhouseJob,
    jobPostingPage,
    leverApplyPage,
    leverPosting,
    workableFormAnswer,
    workableJob,
} from './fixtures/vacancy-sites.js'
import { OWNER, startApp, type TestApp } from './harness.js'
import { completionOf } from './llm-gateway.js'
import { type FakeSites, startSites } from './sites.js'
import { type FakeTex, startTex, TEX_TEST_TOKEN } from './tailor-tex.js'

const STRANGER = '019a5f00-0000-7000-8000-00000000f007'
const GREENHOUSE_API = '/greenhouse/v1/boards/examplelabs/jobs/4012345?questions=true'
const LEVER_ID = '0b9e5c4e-1111-4a2b-9c3d-000000000001'

const materialsAnswer: MaterialsAnswer = {
    coverLetter: 'Hi,\n\nWhat draws me in is a checkout that has to stay fast.\n\nAlex',
    emailSubject: 'Senior Backend Engineer: a checkout 2x as fast',
    emailBody: 'Hello,\n\nMy CV: {cvUrl}\n\nAlex',
    telegramMessage: 'Hi! CV: {cvUrl}\n\nAlex',
    linkedinNote: 'Hi, about the Senior Backend Engineer role.',
    whyMe: [
        'Node.js in production',
        'A checkout 2x as fast',
        'Owns what he builds',
    ],
    answers: [
        {
            key: 'question_30000003',
            answer: 'Example Labs keeps couriers moving, and I made a checkout 2x as fast.',
        },
        {
            key: 'question_30000004',
            answer: 'Node.js',
        },
    ],
}

describe('vacancy fetch job', () => {
    let t: TestApp
    let tex: FakeTex
    let sites: FakeSites

    beforeAll(async () => {
        tex = await startTex()
        sites = await startSites()
        t = await startApp({
            ...sites.env(),
            TAILOR_TEX_URL: tex.url,
            TAILOR_TEX_TOKEN: TEX_TEST_TOKEN,
        })
        expect((await (await t.as()).put('/api/v1/profile').send(exampleProfile())).status).toBe(200)
    })
    afterAll(async () => {
        await t?.close()
        await tex?.close()
        await sites?.close()
        for (const name of Object.keys(sites?.env() ?? {})) delete process.env[name]
        delete process.env.TAILOR_TEX_TOKEN
    })
    beforeEach(() => {
        tex.reset()
        sites.reset()
        t.llm.calls.length = 0
        t.llm.answer(
            scripted({
                application_materials: () => completionOf(materialsAnswer),
            }),
        )
    })

    const intake = async (
        items: {
            url?: string
            text?: string
        }[],
        userId = OWNER,
    ) => {
        const res = await (await t.as(userId)).post('/api/v1/vacancies/intake').send({
            items,
        })
        expect(res.status).toBe(200)
        return res.body.items[0] as {
            vacancyId: string
            applicationId: string
        }
    }
    const vacancy = async (id: string) => (await t.db.select().from(vacancies).where(eq(vacancies.id, id)))[0]
    const parseSettled = (id: string) =>
        expect.poll(async () => (await vacancy(id))?.parseStatus, {
            timeout: 20_000,
            interval: 200,
        })
    const materialsOf = async (applicationId: string) =>
        (await t.db.select().from(materials).where(eq(materials.applicationId, applicationId)))[0]

    it('reads a Greenhouse link alone: text, form, parse, CV and materials with the answers', async () => {
        sites.json(GREENHOUSE_API, greenhouseJob)
        const { vacancyId, applicationId } = await intake([
            {
                url: 'https://boards.greenhouse.io/examplelabs/jobs/4012345',
            },
        ])
        expect((await vacancy(vacancyId))?.fetchStatus).toBe('pending')
        await expect
            .poll(async () => (await materialsOf(applicationId))?.status, {
                timeout: 40_000,
                interval: 300,
            })
            .toBe('ready')

        const row = await vacancy(vacancyId)
        expect(row).toMatchObject({
            fetchStatus: 'fetched',
            fetchError: null,
            parseStatus: 'parsed',
            applyForm: {
                source: 'greenhouse',
            },
        })
        expect(row?.rawText.startsWith('Senior Backend Engineer\nExample Labs\nRemote, EU\n\n')).toBe(true)
        expect(row?.applyForm?.fields).toHaveLength(8)
        const parse = t.llm.calls.find(call => call.body.metadata?.purpose === 'vacancy-parse')
        expect(parse?.body.messages[1]?.content).toContain('- Keep the checkout fast & reliable')

        expect(materialsContentSchema.parse((await materialsOf(applicationId))?.content).answers).toEqual([
            {
                key: 'first_name',
                label: 'First Name',
                answer: 'Alex',
            },
            {
                key: 'last_name',
                label: 'Last Name',
                answer: 'Example',
            },
            {
                key: 'email',
                label: 'Email',
                answer: 'alex@example.com',
            },
            {
                key: 'question_30000001',
                label: 'LinkedIn Profile',
                answer: '',
            },
            {
                key: 'question_30000002',
                label: 'Will you now or in the future require visa sponsorship?',
                answer: 'No',
            },
            {
                key: 'question_30000003',
                label: 'Why do you want to work at Example Labs?',
                answer: 'Example Labs keeps couriers moving, and I made a checkout 2x as fast.',
            },
            {
                key: 'question_30000004',
                label: 'Which of these have you used in production?',
                answer: 'Node.js',
            },
        ])
        const letters = t.llm.calls.find(call => call.body.metadata?.purpose === 'materials')
        const user = letters?.body.messages[1]?.content ?? ''
        expect(user).toContain('"key":"question_30000003","question":"Why do you want to work at Example Labs?"')
        expect(user).not.toContain('"key":"first_name"')
        expect(user).toContain('preparedAnswers')

        const detail = await (await t.as()).get(`/api/v1/applications/${applicationId}`)
        expect(detail.body.vacancy).toMatchObject({
            fetchStatus: 'fetched',
            fetchError: null,
            applyForm: row?.applyForm,
        })
        expect(detail.body.materials.content.answers).toHaveLength(7)
        expect(
            await t.metric('vacancy_fetch_total', {
                result: 'fetched',
                source: 'greenhouse',
            }),
        ).toBe(1)
    }, 60_000)

    it('keeps the pasted text and only collects the form (Workable)', async () => {
        sites.json('/workable/api/v2/accounts/examplelabs/jobs/AB12CD34EF', workableJob)
        sites.json('/workable/api/v2/accounts/examplelabs/jobs/AB12CD34EF/form', workableFormAnswer)
        const text = 'Pasted by the person: Example Labs hires a platform engineer (Kubernetes).'
        const { vacancyId } = await intake([
            {
                url: 'https://apply.workable.com/examplelabs/j/AB12CD34EF',
                text,
            },
        ])
        await parseSettled(vacancyId).toBe('parsed')
        const row = await vacancy(vacancyId)
        expect(row).toMatchObject({
            rawText: text,
            fetchStatus: 'fetched',
            applyForm: {
                source: 'workable',
            },
        })
        expect(row?.applyForm?.fields.map(field => field.key)).toEqual([
            'firstname',
            'email',
            'resume',
            'QA_5001',
            'QA_5002',
            'QA_5003',
        ])
        const parse = t.llm.calls.find(call => call.body.metadata?.purpose === 'vacancy-parse')
        expect(parse?.body.messages[1]?.content).toContain(text)
        expect(parse?.body.messages[1]?.content).not.toContain('Four-day week')
    })

    it('fails a link with no text as no_text, and parses the pasted text when there is one', async () => {
        const lonely = await intake([
            {
                url: `https://jobs.lever.co/examplelabs/${LEVER_ID}`,
            },
        ])
        const withText = await intake([
            {
                url: 'https://jobs.ashbyhq.com/examplelabs/5a1b2c3d-0000-4000-8000-00000000ffff',
                text: 'Example Labs hires a Senior Backend Engineer (Node.js).',
            },
        ])
        await parseSettled(lonely.vacancyId).toBe('failed')
        expect(await vacancy(lonely.vacancyId)).toMatchObject({
            fetchStatus: 'failed',
            fetchError: 'http_404',
            parseError: 'no_text',
            applyForm: null,
        })
        await parseSettled(withText.vacancyId).toBe('parsed')
        expect(await vacancy(withText.vacancyId)).toMatchObject({
            fetchStatus: 'failed',
            fetchError: 'http_404',
        })

        // Fetched again once the posting is there: the text fills the empty one and the parse follows.
        sites.json(`/lever-api/v0/postings/examplelabs/${LEVER_ID}`, leverPosting)
        sites.html(`/lever-jobs/examplelabs/${LEVER_ID}/apply`, leverApplyPage)
        const again = await (await t.as()).post(`/api/v1/vacancies/${lonely.vacancyId}/fetch`)
        expect(again.status).toBe(202)
        expect(again.body).toEqual({
            vacancyId: lonely.vacancyId,
            fetchStatus: 'pending',
        })
        await parseSettled(lonely.vacancyId).toBe('parsed')
        const row = await vacancy(lonely.vacancyId)
        expect(row).toMatchObject({
            fetchStatus: 'fetched',
            fetchError: null,
            parseError: null,
            applyForm: {
                source: 'lever',
            },
        })
        expect(row?.rawText).toContain('Example Labs ships a web app for couriers.')
        expect(row?.applyForm?.fields.find(field => field.key === 'cards[c1][field0]')).toMatchObject({
            label: 'Do you have experience with React Native?',
            options: [
                'Yes',
                'No',
            ],
        })
    }, 60_000)

    it('reads an Ashby job and a page by its JSON-LD or the Greenhouse board it embeds', async () => {
        sites.json('/ashby/posting-api/job-board/examplelabs?includeCompensation=true', ashbyBoard)
        sites.html('/careers/sre', jobPostingPage)
        sites.html(
            '/careers/backend?gh_jid=4012345',
            '<div id="grnhse_app"></div><script src="https://boards.greenhouse.io/embed/job_board/js?for=examplelabs"></script>',
        )
        sites.json(GREENHOUSE_API, greenhouseJob)
        const ashby = await intake([
            {
                url: 'https://jobs.ashbyhq.com/examplelabs/5a1b2c3d-0000-4000-8000-000000000001',
            },
        ])
        const page = await intake([
            {
                url: `${sites.url}/careers/sre`,
            },
        ])
        const embedded = await intake([
            {
                url: `${sites.url}/careers/backend?gh_jid=4012345`,
            },
        ])
        for (const { vacancyId } of [
            ashby,
            page,
            embedded,
        ])
            await parseSettled(vacancyId).toBe('parsed')
        expect(await vacancy(ashby.vacancyId)).toMatchObject({
            fetchStatus: 'fetched',
            rawText: expect.stringContaining('Compensation: EUR 70K – 90K'),
            applyForm: {
                source: 'ashby',
                fields: [],
            },
        })
        expect(await vacancy(page.vacancyId)).toMatchObject({
            fetchStatus: 'fetched',
            rawText: 'Site Reliability Engineer\nExample Labs\nExample City, EX\n\nKeep the platform up.\n\n- On-call',
            applyForm: null,
        })
        expect(await vacancy(embedded.vacancyId)).toMatchObject({
            fetchStatus: 'fetched',
            applyForm: {
                source: 'greenhouse',
            },
        })
    }, 60_000)

    it('re-fetches only a vacancy of the caller’s pool that has a link', async () => {
        sites.json(GREENHOUSE_API, greenhouseJob)
        const linked = await intake([
            {
                url: 'https://boards.greenhouse.io/examplelabs/jobs/4012345?gh_src=again',
                text: 'Example Labs hires a Senior Backend Engineer.',
            },
        ])
        const textOnly = await intake([
            {
                text: 'A vacancy pasted as text only.',
            },
        ])
        const stranger = await (await t.as(STRANGER)).post(`/api/v1/vacancies/${linked.vacancyId}/fetch`)
        expect(stranger.status).toBe(404)
        expect((await (await t.as()).post('/api/v1/vacancies/not-a-uuid/fetch')).status).toBe(404)
        const noLink = await (await t.as()).post(`/api/v1/vacancies/${textOnly.vacancyId}/fetch`)
        expect(noLink.status).toBe(409)
        expect(noLink.body.code).toBe('CONFLICT')
        expect((await vacancy(textOnly.vacancyId))?.fetchStatus).toBe('skipped')
        expect((await (await t.as()).post(`/api/v1/vacancies/${linked.vacancyId}/fetch`)).status).toBe(202)
        await expect
            .poll(async () => (await vacancy(linked.vacancyId))?.fetchStatus, {
                timeout: 15_000,
                interval: 200,
            })
            .toBe('fetched')
        expect((await vacancy(linked.vacancyId))?.rawText).toBe('Example Labs hires a Senior Backend Engineer.')
    })
})
