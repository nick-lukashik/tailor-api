import { describe, expect, it } from 'vitest'
import {
    ashbyBoard,
    greenhouseJob,
    jobPostingPage,
    leverApplyPage,
    leverPosting,
    plainJobPage,
    workableFormAnswer,
    workableJob,
} from '../../test/fixtures/vacancy-sites.js'
import {
    ashbyVacancy,
    greenhouseBoardOf,
    greenhouseVacancy,
    leverForm,
    leverText,
    pageVacancy,
    workableForm,
    workableText,
} from './fetch-adapters.js'

describe('Greenhouse', () => {
    it('maps the job: its escaped HTML as text and its questions as fields', () => {
        const vacancy = greenhouseVacancy(greenhouseJob)
        expect(vacancy.text).toBe(
            'Senior Backend Engineer\nExample Labs\nRemote, EU\n\nExample Labs builds tools for logistics.\n\nWhat you will do\n\n- Build the order API in Node.js\n- Keep the checkout fast & reliable',
        )
        expect(vacancy.form).toEqual({
            source: 'greenhouse',
            fields: [
                {
                    key: 'first_name',
                    label: 'First Name',
                    type: 'text',
                    required: true,
                },
                {
                    key: 'last_name',
                    label: 'Last Name',
                    type: 'text',
                    required: true,
                },
                {
                    key: 'email',
                    label: 'Email',
                    type: 'text',
                    required: true,
                },
                {
                    key: 'resume',
                    label: 'Resume/CV',
                    type: 'file',
                    required: true,
                },
                {
                    key: 'question_30000001',
                    label: 'LinkedIn Profile',
                    type: 'text',
                    required: false,
                },
                {
                    key: 'question_30000002',
                    label: 'Will you now or in the future require visa sponsorship?',
                    type: 'boolean',
                    required: true,
                    options: [
                        'Yes',
                        'No',
                    ],
                },
                {
                    key: 'question_30000003',
                    label: 'Why do you want to work at Example Labs?',
                    type: 'textarea',
                    required: true,
                },
                {
                    key: 'question_30000004',
                    label: 'Which of these have you used in production?',
                    type: 'multiselect',
                    required: false,
                    options: [
                        'Node.js',
                        'Go',
                        'Kubernetes',
                    ],
                },
            ],
        })
    })

    it('refuses an answer of another shape', () => {
        expect(() =>
            greenhouseVacancy({
                questions: 'none',
            }),
        ).toThrow('bad_response')
    })

    it('finds the board a careers page embeds', () => {
        expect(
            greenhouseBoardOf(
                '<script src="https://boards.greenhouse.io/embed/job_board/js?for=examplelabs"></script>',
            ),
        ).toBe('examplelabs')
        expect(greenhouseBoardOf('<a href="https://job-boards.greenhouse.io/examplelabs/jobs/1">x</a>')).toBe(
            'examplelabs',
        )
        expect(greenhouseBoardOf('<p>No board</p>')).toBeUndefined()
    })
})

describe('Workable', () => {
    it('maps the job and its form', () => {
        expect(workableText(workableJob, 'examplelabs')).toBe(
            'Platform Engineer\nexamplelabs\nExample City, Exampleland, hybrid\n\nExample Labs runs a delivery platform.\n\nRequirements\n- Kubernetes\n- PostgreSQL\n\nBenefits\nFour-day week.',
        )
        expect(workableForm(workableFormAnswer)).toEqual({
            source: 'workable',
            fields: [
                {
                    key: 'firstname',
                    label: 'First name',
                    type: 'text',
                    required: true,
                },
                {
                    key: 'email',
                    label: 'Email',
                    type: 'text',
                    required: true,
                },
                {
                    key: 'resume',
                    label: 'Resume',
                    type: 'file',
                    required: true,
                },
                {
                    key: 'QA_5001',
                    label: 'What is your notice period?',
                    type: 'textarea',
                    required: false,
                },
                {
                    key: 'QA_5002',
                    label: 'Are you willing to work from our office twice a week?',
                    type: 'boolean',
                    required: true,
                    options: [
                        'Yes',
                        'No',
                    ],
                },
                {
                    key: 'QA_5003',
                    label: 'Preferred start',
                    type: 'select',
                    required: false,
                    options: [
                        'Within a month',
                        'Later',
                    ],
                },
            ],
        })
    })

    it('reads a form given as fields alone', () => {
        expect(
            workableForm({
                fields: [
                    {
                        id: 'phone',
                        label: 'Phone',
                        type: 'phone',
                    },
                ],
            }).fields,
        ).toEqual([
            {
                key: 'phone',
                label: 'Phone',
                type: 'text',
                required: false,
            },
        ])
    })
})

describe('Lever, Ashby and pages', () => {
    it('maps a Lever posting and its apply page', () => {
        expect(leverText(leverPosting, 'examplelabs')).toBe(
            'Frontend Engineer\nexamplelabs\nRemote, Full-time\n\nExample Labs ships a web app for couriers.\n\nRequirements\n- React\n- TypeScript\n\nWe hire worldwide.',
        )
        expect(leverForm(leverApplyPage).fields.map(field => field.key)).toEqual([
            'resume',
            'name',
            'email',
            'urls[LinkedIn]',
            'cards[c1][field0]',
            'cards[c2][field0]',
            'comments',
            'eeo[gender]',
        ])
    })

    it('finds the Ashby job on its board', () => {
        expect(ashbyVacancy(ashbyBoard, 'examplelabs', '5A1B2C3D-0000-4000-8000-000000000001')).toEqual({
            source: 'ashby',
            text: 'Data Engineer\nexamplelabs\nRemote, FullTime\n\nExample Labs moves data for couriers.\n\nCompensation: EUR 70K – 90K',
            form: {
                source: 'ashby',
                fields: [],
            },
        })
        expect(() => ashbyVacancy(ashbyBoard, 'examplelabs', '5a1b2c3d-0000-4000-8000-00000000ffff')).toThrow(
            'not_found',
        )
    })

    it('reads a page by its JSON-LD first, else its main text, and no search form as the apply form', () => {
        expect(pageVacancy(jobPostingPage)).toEqual({
            source: 'page',
            text: 'Site Reliability Engineer\nExample Labs\nExample City, EX\n\nKeep the platform up.\n\n- On-call',
            form: null,
        })
        const plain = pageVacancy(plainJobPage)
        expect(plain.text.startsWith('QA Engineer\n\nExample Labs is looking for a QA engineer')).toBe(true)
        expect(plain.form).toBeNull()
        expect(pageVacancy(`<main><h1>Job</h1></main>${leverApplyPage}`).form?.source).toBe('page')
    })
})
