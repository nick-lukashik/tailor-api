import { describe, expect, it } from 'vitest'
import { aiProfile, exampleCase } from '../../test/fixtures/cv-profile.js'
import { type Analysis, decideAiRole, groundAnalysis, planEmployments, tailoredEmployments } from './analysis.js'
import { tailoredSummarySource } from './compose.js'

const analysis = (aiRole: boolean, extra: Partial<Analysis> = {}): Analysis => ({
    vacancyKind: 'specific',
    vacancyKindReason: '',
    aiRole,
    aiRoleReason: '',
    requirements: [
        {
            id: 'R1',
            text: 'PostgreSQL in production',
            importance: 'must',
            categories: [
                'BE',
            ],
            technologies: [
                'PostgreSQL',
            ],
        },
    ],
    matches: [],
    ...extra,
})

describe('the AI-role rule (D-115)', () => {
    it.each([
        [
            'Forward Deployed Engineer',
            true,
        ],
        [
            'Senior LLM Engineer',
            true,
        ],
        [
            'Applied AI Engineer',
            true,
        ],
        [
            'Senior AI Full-Stack Engineer',
            true,
        ],
        [
            'Senior Full-Stack Engineer',
            false,
        ],
        [
            'Backend Engineer (Node.js)',
            false,
        ],
        [
            'Frontend Developer, AI-assisted team',
            false,
        ],
    ])('reads the title %j as an AI role: %s', (title, ai) => {
        expect(decideAiRole(title, false)).toBe(ai)
    })

    it("takes the model's decision for a title that does not say it", () => {
        expect(decideAiRole('Software Engineer', true)).toBe(true)
    })

    it('leaves the AI-only employment, summary paragraph and their cases out of a regular role', () => {
        const profile = aiProfile()
        expect(tailoredEmployments(profile, false).map(item => item.id)).toEqual([
            'acme',
        ])
        expect(tailoredEmployments(profile, true).map(item => item.id)).toEqual([
            'acme',
            'toggle',
        ])
        expect(tailoredSummarySource(profile, false).map(item => item.id)).toEqual([
            'profile',
        ])
        expect(tailoredSummarySource(profile, true).map(item => item.id)).toEqual([
            'profile',
            'ai_tools',
        ])
        const regular = planEmployments(profile, 'Backend Engineer', analysis(false))
        expect(regular.flatMap(plan => plan.ranked.map(entry => entry.item.id))).not.toContain('t1')
        const ai = planEmployments(profile, 'LLM Engineer', analysis(true))
        expect(ai.find(plan => plan.employment.id === 'toggle')?.suggested).toEqual([
            't1',
        ])
    })
})

describe('the analysis', () => {
    it('keeps only grounded requirements and matches', () => {
        const profile = aiProfile()
        const grounded = groundAnalysis(
            {
                vacancyKind: 'general',
                vacancyKindReason: ' A talent pool. ',
                aiRole: false,
                aiRoleReason: ' A backend role. ',
                requirements: [
                    {
                        id: 'R1',
                        text: 'PostgreSQL',
                        importance: 'must',
                        categories: [
                            'BE',
                            'BE',
                        ],
                        technologies: [
                            'PostgreSQL',
                        ],
                    },
                    {
                        id: 'R1',
                        text: 'A duplicate id',
                        importance: 'must',
                        categories: [],
                        technologies: [],
                    },
                ],
                matches: [
                    {
                        requirementId: 'R1',
                        caseId: 'c2',
                        match: 0.9,
                        claimIds: [
                            'nope',
                        ],
                    },
                    {
                        requirementId: 'R1',
                        caseId: 'c1',
                        match: 0.5,
                        claimIds: [
                            'c1:main',
                        ],
                    },
                    {
                        requirementId: 'R1',
                        caseId: 'unknown',
                        match: 1,
                        claimIds: [],
                    },
                    {
                        requirementId: 'R9',
                        caseId: 'c1',
                        match: 1,
                        claimIds: [],
                    },
                    {
                        requirementId: 'R1',
                        caseId: 't1',
                        match: 0.1,
                        claimIds: [],
                    },
                ],
            },
            profile.cases,
        )
        expect(grounded.requirements).toEqual([
            {
                id: 'R1',
                text: 'PostgreSQL',
                importance: 'must',
                categories: [
                    'BE',
                ],
                technologies: [
                    'PostgreSQL',
                ],
            },
        ])
        expect(grounded.matches).toEqual([
            {
                requirementId: 'R1',
                caseId: 'c2',
                match: 1,
                claimIds: [],
            },
            {
                requirementId: 'R1',
                caseId: 'c1',
                match: 0.5,
                claimIds: [
                    'c1:main',
                ],
            },
        ])
        expect(grounded.aiRoleReason).toBe('A backend role.')
        expect(grounded.vacancyKind).toBe('general')
        expect(grounded.vacancyKindReason).toBe('A talent pool.')
    })

    it('ranks the evidenced case first, the target capped by the candidates, one per group, a limited case only when named', () => {
        const profile = aiProfile()
        profile.cases.push(
            exampleCase('c3', 'acme', {
                achievementGroup: 'c2',
            }),
        )
        const [acme] = planEmployments(
            profile,
            'Backend Engineer',
            analysis(false, {
                matches: [
                    {
                        requirementId: 'R1',
                        caseId: 'c2',
                        match: 1,
                        claimIds: [],
                    },
                ],
            }),
        )
        expect(acme?.ranked[0]?.item.id).toBe('c2')
        // The quota's 5 capped by the two eligible cases.
        expect(acme?.quota).toEqual({
            min: 2,
            target: 2,
        })
        // c3 shares c2's group; c1 competes only when the vacancy mentions performance.
        expect(acme?.suggested).toEqual([
            'c2',
        ])
        expect(acme?.ranked.map(entry => entry.item.id)).toEqual([
            'c2',
            'c3',
        ])
        const named = planEmployments(
            profile,
            'Backend Engineer',
            analysis(false, {
                requirements: [
                    {
                        id: 'R1',
                        text: 'Web performance',
                        importance: 'must',
                        categories: [
                            'PF',
                        ],
                        technologies: [],
                    },
                ],
            }),
        )
        expect(named[0]?.suggested).toContain('c1')
    })

    it("ranks a case listing the vacancy's main stack above an equal one that does not", () => {
        const profile = aiProfile()
        profile.cases = [
            exampleCase('n1', 'acme', {
                technologies: [
                    'Node.js',
                ],
            }),
            exampleCase('p1', 'acme', {
                technologies: [
                    'Python (FastAPI)',
                ],
            }),
        ]
        const [acme] = planEmployments(
            profile,
            'Backend Engineer',
            analysis(false, {
                requirements: [
                    {
                        id: 'R1',
                        text: 'Python and FastAPI',
                        importance: 'must',
                        categories: [
                            'BE',
                        ],
                        technologies: [
                            'Python',
                            'FastAPI',
                        ],
                    },
                ],
            }),
        )
        expect(acme?.ranked.map(entry => entry.item.id)).toEqual([
            'p1',
            'n1',
        ])
    })
})
