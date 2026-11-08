import { describe, expect, it } from 'vitest'
import { type ProfileDocument, profileDocumentSchema } from '../profile/profile.schemas.js'
import { cvDocumentSchema } from '../tex/cv-document.js'
import { buildMasterCv, cvDates, cvLocation, masterCvIssues } from './master-cv.js'

/** The value, or a failed test. */
function present<T>(value: T | undefined): T {
    if (value === undefined) throw new Error('missing')
    return value
}

const variants = (text: string) => ({
    full: `${text}, in full.`,
    compact: `${text}.`,
    minimal: text,
})

/** An invented person: two jobs and side projects, one AI-only job, cases of every kind. */
const profile = (): ProfileDocument =>
    profileDocumentSchema.parse({
        person: {
            names: [
                {
                    locale: 'ru',
                    firstName: 'Алекс',
                    lastName: 'Пример',
                },
                {
                    locale: 'en',
                    firstName: 'Alex',
                    lastName: 'Example',
                },
            ],
            email: 'alex@example.com',
            phone: {
                display: '+1 555 010 0000',
                e164: '+15550100000',
            },
            telegram: 'alex_example',
            location: {
                city: 'Example City',
                country: 'Exampleland',
            },
            links: [
                {
                    kind: 'github',
                    url: 'https://github.example.com/alex/',
                    label: '',
                },
                {
                    kind: 'website',
                    url: 'https://alex.example.com',
                    label: 'alex.example.com',
                },
            ],
        },
        career: {
            headline: 'Software Engineer',
            targetRoles: [
                {
                    role: 'backend',
                    headline: 'Senior Backend Engineer',
                },
                {
                    role: 'frontend',
                    headline: 'Senior Frontend Engineer',
                },
            ],
            stackLine: 'TypeScript · Node.js · PostgreSQL',
            careerStartYear: 2019,
        },
        employments: [
            {
                id: 'side',
                kind: 'side_projects',
                company: {
                    name: 'Independent Projects',
                },
                title: 'Engineer',
                start: '2015-06',
                end: '2016-12',
                order: 3,
                quota: {
                    general: {
                        min: 0,
                        target: 0,
                    },
                    ai: {
                        min: 0,
                        target: 0,
                    },
                },
                fixedBullets: [
                    'Built small tools for friends.',
                ],
            },
            {
                id: 'contoso',
                company: {
                    name: 'Contoso Example',
                    description: 'An example bank.',
                },
                title: 'Backend Engineer',
                start: '2019-02',
                end: '2022-02',
                location: 'Remote',
                order: 1,
            },
            {
                id: 'acme',
                company: {
                    name: 'Acme Example',
                    description: 'An example marketplace.',
                },
                title: 'Senior Software Engineer',
                start: '2022-03',
                end: null,
                location: 'Remote',
                order: 0,
                quota: {
                    general: {
                        min: 1,
                        target: 2,
                    },
                    ai: {
                        min: 1,
                        target: 4,
                    },
                },
            },
            {
                id: 'lab',
                company: {
                    name: 'AI Lab Example',
                },
                title: 'AI Engineer',
                start: '2024-01',
                aiOnly: true,
            },
        ],
        cases: [
            {
                id: 'a1',
                employmentId: 'acme',
                title: 'Checkout',
                achievementGroup: 'checkout',
                variants: variants('Rebuilt the **checkout**'),
            },
            {
                id: 'a2',
                employmentId: 'acme',
                title: 'Checkout again',
                achievementGroup: 'checkout',
                variants: variants('Sped up the checkout'),
            },
            {
                id: 'a3',
                employmentId: 'acme',
                title: 'Search',
                active: false,
                variants: variants('Added search'),
            },
            {
                id: 'a4',
                employmentId: 'acme',
                title: 'Payments',
                variants: variants('Moved payments to a queue'),
            },
            {
                id: 'a5',
                employmentId: 'acme',
                title: 'Over the quota',
                variants: variants('Wrote docs'),
            },
            {
                id: 'c1',
                employmentId: 'contoso',
                title: 'Ledger',
                variants: variants('Built the ledger'),
            },
            {
                id: 'c-a-very-long-case-id-that-is-over-forty-characters',
                employmentId: 'contoso',
                title: 'Reports',
                variants: variants('Built reports'),
            },
            {
                id: 'l1',
                employmentId: 'lab',
                title: 'Agents',
                variants: variants('Built agents'),
            },
        ],
        skills: [
            {
                label: 'Backend',
                items: [
                    {
                        name: 'Node.js',
                        core: true,
                    },
                    {
                        name: 'PostgreSQL',
                    },
                ],
            },
            {
                label: 'Empty',
                items: [],
            },
            {
                label: 'Languages',
                items: [
                    {
                        name: 'TypeScript',
                        core: true,
                    },
                ],
            },
        ],
        education: {
            degrees: [
                {
                    institution: 'Example University',
                    degree: 'BSc',
                    field: 'Computer Science',
                    start: '2011-09',
                    end: '2015-06',
                },
            ],
        },
        languages: [
            {
                code: 'en',
                name: 'English',
                level: 'c1',
                note: 'C1, full professional proficiency',
            },
            {
                code: 'ru',
                name: 'Russian',
                level: 'native',
            },
            {
                code: 'de',
                name: 'German',
                level: 'none',
            },
        ],
        summary: [
            {
                id: 'profile',
                full: 'Backend engineer with 5+ years of **APIs**.',
                compact: 'Backend engineer.',
            },
            {
                id: 'ai_tools',
                full: '',
                compact: 'Uses AI tools daily.',
            },
            {
                id: 'third',
                full: 'Never printed: the template has two paragraphs.',
            },
        ],
    })

describe('buildMasterCv', () => {
    it('builds the whole document from the profile, valid for tailor-tex', () => {
        const document = buildMasterCv(profile())
        expect(cvDocumentSchema.safeParse(document).success).toBe(true)
        expect(document).toEqual({
            name: 'Alex Example',
            location: 'Example City, Exampleland',
            phoneDisplay: '+1 555 010 0000',
            phoneDigits: '+15550100000',
            headline: 'Senior Backend Engineer',
            stack: 'TypeScript · Node.js · PostgreSQL',
            links: [
                {
                    url: 'mailto:alex@example.com',
                    text: 'alex@example.com',
                },
                {
                    url: 'https://github.example.com/alex/',
                    text: 'github.example.com/alex',
                },
                {
                    url: 'https://alex.example.com',
                    text: 'alex.example.com',
                },
                {
                    url: 'https://t.me/alex_example',
                    text: 't.me/alex_example',
                },
            ],
            summary: [
                'Backend engineer with 5+ years of **APIs**.',
                'Uses AI tools daily.',
            ],
            skills: [
                {
                    label: 'Backend',
                    items: [
                        'Node.js',
                        'PostgreSQL',
                    ],
                },
                {
                    label: 'Languages',
                    items: [
                        'TypeScript',
                    ],
                },
            ],
            jobs: [
                {
                    title: 'Senior Software Engineer',
                    company: 'Acme Example',
                    dates: 'Mar 2022 – Present',
                    location: 'Remote',
                    description: 'An example marketplace.',
                    // Quota 2: a1, then a4 (a2 shares a1's group, a3 is inactive).
                    bullets: [
                        {
                            id: 'a1',
                            text: 'Rebuilt the **checkout**, in full.',
                        },
                        {
                            id: 'a4',
                            text: 'Moved payments to a queue, in full.',
                        },
                    ],
                },
                {
                    title: 'Backend Engineer',
                    company: 'Contoso Example',
                    dates: 'Feb 2019 – Feb 2022',
                    location: 'Remote',
                    description: 'An example bank.',
                    // No quota: every active case.
                    bullets: [
                        {
                            id: 'c1',
                            text: 'Built the ledger, in full.',
                        },
                        {
                            id: 'case-6',
                            text: 'Built reports, in full.',
                        },
                    ],
                },
                {
                    title: 'Engineer',
                    company: 'Independent Projects',
                    dates: 'Jun 2015 – Dec 2016',
                    location: '',
                    description: '',
                    bullets: [
                        {
                            id: 'fixed-0-0',
                            text: 'Built small tools for friends.',
                        },
                    ],
                },
            ],
            education: [
                {
                    degree: 'BSc in Computer Science',
                    school: 'Example University',
                    dates: 'Sep 2011 – Jun 2015',
                },
            ],
            languages: [
                {
                    name: 'English',
                    level: 'C1, full professional proficiency',
                },
                {
                    name: 'Russian',
                    level: 'Native',
                },
            ],
            pdf: {
                title: '',
                subject: 'Senior Backend Engineer CV',
                keywords: [
                    'Node.js',
                    'TypeScript',
                ],
            },
        })
    })

    it('is deterministic', () => {
        expect(buildMasterCv(profile())).toEqual(buildMasterCv(profile()))
    })

    it('falls back to the career headline and keeps contacts already linked once', () => {
        const input = profile()
        input.career.targetRoles = []
        input.person.links.push(
            {
                kind: 'email',
                url: 'mailto:alex@example.com',
                label: 'alex@example.com',
            },
            {
                kind: 'telegram',
                url: 'https://t.me/alex_example',
                label: '@alex_example',
            },
        )
        const document = buildMasterCv(input)
        expect(document.headline).toBe('Software Engineer')
        expect(document.links.map(link => link.text)).toEqual([
            'github.example.com/alex',
            'alex.example.com',
            'alex@example.com',
            '@alex_example',
        ])
    })

    it('cuts counts to the template limits', () => {
        const input = profile()
        present(input.employments[2]).quota = undefined
        input.cases = Array.from(
            {
                length: 25,
            },
            (_, index) => ({
                ...present(input.cases[0]),
                id: `x${index}`,
                achievementGroup: '',
            }),
        )
        const [acme] = buildMasterCv(input).jobs
        expect(acme?.bullets).toHaveLength(20)
    })
})

describe('buildMasterCv header settings', () => {
    it('leaves out the location when the settings hide it', () => {
        const input = profile()
        input.settings.cvShowLocation = false
        const document = buildMasterCv(input)
        expect(document.location).toBe('')
        expect(document.phoneDigits).toBe('+15550100000')
        expect(masterCvIssues(document)).toEqual([])
    })

    it('leaves out the phone when the settings hide it', () => {
        const input = profile()
        input.settings.cvShowPhone = false
        const document = buildMasterCv(input)
        expect(document).toMatchObject({
            location: 'Example City, Exampleland',
            phoneDisplay: '',
            phoneDigits: '',
        })
        expect(masterCvIssues(document)).toEqual([])
    })
})

describe('masterCvIssues', () => {
    it('is empty for a complete profile', () => {
        expect(masterCvIssues(buildMasterCv(profile()))).toEqual([])
    })

    it('names the profile section of everything a CV is missing', () => {
        const document = buildMasterCv(profileDocumentSchema.parse({}))
        const issues = masterCvIssues(document)
        expect(issues.map(issue => issue.path)).toEqual([
            'person.names',
            'career',
            'summary',
            'skills',
            'employments',
        ])
    })

    it('reports a value over a template limit at its CV path', () => {
        const input = profile()
        present(input.employments[2]).company.description = 'x'.repeat(201)
        expect(masterCvIssues(buildMasterCv(input))).toEqual([
            {
                path: 'employments',
                message: expect.stringMatching(/^CV jobs\.0\.description: /),
            },
        ])
    })
})

describe('cvLocation', () => {
    it('joins the place, the time zone and Remote', () => {
        expect(
            cvLocation(
                {
                    city: 'Example City',
                    country: 'Exampleland',
                    timezone: 'UTC+4',
                },
                true,
            ),
        ).toBe('Example City, Exampleland · UTC+4 · Remote')
    })

    it('keeps the place alone without a time zone or remote work', () => {
        expect(
            cvLocation({
                city: 'Example City',
                country: 'Exampleland',
                timezone: '',
            }),
        ).toBe('Example City, Exampleland')
    })

    it('gives the country and time zone without a city', () => {
        expect(
            cvLocation({
                city: '',
                country: 'Exampleland',
                timezone: 'UTC+4',
            }),
        ).toBe('Exampleland · UTC+4')
    })
})

describe('buildMasterCv AI-only parts', () => {
    it('leaves out AI-only skill rows and summary paragraphs', () => {
        const input = profile()
        input.skills = [
            {
                label: 'Backend',
                aiOnly: false,
                items: [
                    {
                        name: 'Node.js',
                        aliases: [],
                        core: false,
                    },
                ],
            },
            {
                label: 'AI and LLM',
                aiOnly: true,
                items: [
                    {
                        name: 'RAG',
                        aliases: [],
                        core: false,
                    },
                ],
            },
        ]
        input.summary = [
            {
                id: 'ai',
                full: 'Builds LLM products.',
                compact: '',
                aiOnly: true,
            },
            {
                id: 'base',
                full: 'Builds web products.',
                compact: '',
                aiOnly: false,
            },
        ]
        const document = buildMasterCv(input)
        expect(document.skills.map(row => row.label)).toEqual([
            'Backend',
        ])
        expect(document.summary).toEqual([
            'Builds web products.',
        ])
    })
})

describe('cvDates', () => {
    it('prints months as the template does', () => {
        expect(cvDates('2024-03', null)).toBe('Mar 2024 – Present')
        expect(cvDates('2019-12', '2020-01')).toBe('Dec 2019 – Jan 2020')
    })
})
