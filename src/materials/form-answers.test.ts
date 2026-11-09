import { describe, expect, it } from 'vitest'
import { exampleProfile } from '../../test/fixtures/profile.js'
import { greenhouseJob, leverApplyPage } from '../../test/fixtures/vacancy-sites.js'
import { profileDocumentSchema } from '../profile/profile.schemas.js'
import { applyForm } from '../vacancies/apply-form.js'
import { greenhouseVacancy, leverForm } from '../vacancies/fetch-adapters.js'
import { formAnswers, freeQuestions, pickOption, standardAnswer } from './form-answers.js'

const profile = profileDocumentSchema.parse(exampleProfile())
const greenhouse = greenhouseVacancy(greenhouseJob).form

describe('form answers', () => {
    it('answers the standard questions from the profile and leaves the free ones to the model', () => {
        expect(freeQuestions(greenhouse, profile).map(field => field.key)).toEqual([
            'question_30000003',
            'question_30000004',
        ])
        expect(freeQuestions(null, profile)).toEqual([])
    })

    it('puts every non-file field in order, the model answers checked against the options', () => {
        expect(
            formAnswers(greenhouse, profile, [
                {
                    key: 'question_30000003',
                    answer: 'Example Labs keeps couriers moving — and I like fast checkouts.',
                },
                {
                    key: 'question_30000004',
                    answer: 'node.js; Rust; Kubernetes',
                },
                {
                    key: 'first_name',
                    answer: 'Not used',
                },
            ]),
        ).toEqual([
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
                // The profile has no LinkedIn link: empty, not invented.
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
                answer: 'Example Labs keeps couriers moving, and I like fast checkouts.',
            },
            {
                key: 'question_30000004',
                label: 'Which of these have you used in production?',
                answer: 'Node.js; Kubernetes',
            },
        ])
    })

    it('reads the standard fields of a plain form: full name, links, EEO declined', () => {
        const answers = formAnswers(leverForm(leverApplyPage), profile, [])
        expect(
            Object.fromEntries(
                answers.map(item => [
                    item.key,
                    item.answer,
                ]),
            ),
        ).toEqual({
            name: 'Alex Example',
            email: 'alex@example.com',
            'urls[LinkedIn]': '',
            'cards[c1][field0]': '',
            'cards[c2][field0]': '',
            comments: '',
            'eeo[gender]': 'Decline to self-identify',
        })
    })

    it('writes salary, notice period, phone and location as the profile states them', () => {
        const form = applyForm('page', [
            {
                key: 'salary',
                label: 'What are your salary expectations?',
                type: 'text',
                required: true,
            },
            {
                key: 'notice',
                label: 'Notice period',
                type: 'text',
                required: false,
            },
            {
                key: 'phone',
                label: 'Phone number',
                type: 'text',
                required: false,
            },
            {
                key: 'location',
                label: 'Location',
                type: 'text',
                required: false,
            },
            {
                key: 'relocate',
                label: 'Are you open to relocation?',
                type: 'boolean',
                required: false,
            },
        ])
        expect(form.fields.map(field => standardAnswer(field, profile))).toEqual([
            '5,000 USD per month, gross (b2b)',
            '2 weeks',
            '+1 555 010 0000',
            'Example City, Exampleland',
            undefined,
        ])
        expect(
            formAnswers(form, profile, [
                {
                    key: 'relocate',
                    answer: 'maybe',
                },
            ])[4]?.answer,
        ).toBe('')
    })

    it('picks an option by its wording, exact or by its start', () => {
        expect(
            pickOption(
                [
                    'Yes, I am',
                    'No',
                ],
                'yes',
            ),
        ).toBe('Yes, I am')
        expect(
            pickOption(
                [
                    'Yes',
                    'No',
                ],
                'NO',
            ),
        ).toBe('No')
        expect(
            pickOption(
                [
                    'Yes',
                ],
                'perhaps',
            ),
        ).toBeUndefined()
    })
})
