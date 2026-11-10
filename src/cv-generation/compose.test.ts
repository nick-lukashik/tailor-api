import { describe, expect, it } from 'vitest'
import { aiProfile, exampleCase } from '../../test/fixtures/cv-profile.js'
import type { EmploymentPlan } from './analysis.js'
import {
    bulletChanges,
    bulletVariants,
    cleanText,
    composeJobs,
    composeSummary,
    dropHedges,
    keepsFigures,
    type TailoredJob,
} from './compose.js'

const metricCase = exampleCase('m1', 'acme', {
    metricClaims: [
        {
            id: 'm1:metric',
            text: '40% faster',
        },
    ],
    variants: {
        full: 'Cut the build time by 40% with remote caching across 3 pipelines.',
        compact: 'Cut the build time by 40% with remote caching.',
        minimal: 'Cut build time by 40%.',
    },
})

describe('composing a CV from the cases', () => {
    it('allows only the figures of the case', () => {
        const allowed = new Set([
            '40',
            '3',
        ])
        expect(keepsFigures('Cut it by 40% in 3 pipelines.', allowed)).toBe(true)
        expect(keepsFigures('Cut it by 45%.', allowed)).toBe(false)
    })

    it('takes a rewrite that keeps the facts, the case text where a variant invents a figure or is empty', () => {
        const { variants, sourced } = bulletVariants(metricCase, {
            full: 'Reduced **build time by 40%** with remote caching across 3 pipelines — on every commit.',
            compact: 'Reduced build time by 40% for 12 teams.',
            minimal: '',
        })
        expect(variants).toEqual({
            full: 'Reduced **build time by 40%** with remote caching across 3 pipelines, on every commit.',
            compact: 'Cut the build time by 40% with remote caching.',
            minimal: 'Cut build time by 40%.',
        })
        expect(sourced).toBe(true)
    })

    it('never lets a shorter variant be longer than the one before', () => {
        const { variants } = bulletVariants(metricCase, {
            full: 'Cut build time by 40%.',
            compact: 'Cut the build time by 40% with remote caching.',
            minimal: 'Cut the build time by 40% with remote caching across 3 pipelines.',
        })
        expect(variants.compact).toBe(variants.full)
        expect(variants.minimal).toBe(variants.full)
    })

    it('cleans a text to one line', () => {
        expect(cleanText(' A\nline\t with  spaces ', 100)).toBe('A line with spaces')
    })

    it("keeps the model's choice, drops cases of another employment or a used group, tops up to the target", () => {
        const profile = aiProfile()
        const acme = profile.employments.find(item => item.id === 'acme')
        if (!acme) throw new Error('no acme')
        const cases = [
            metricCase,
            exampleCase('a2', 'acme'),
            exampleCase('a3', 'acme'),
            exampleCase('a4', 'acme', {
                achievementGroup: 'm1',
            }),
        ]
        const plan: EmploymentPlan = {
            employment: acme,
            quota: {
                min: 2,
                target: 3,
            },
            ranked: cases.map((item, index) => ({
                item,
                score: 10 - index,
            })),
            suggested: [
                'm1',
                'a2',
                'a3',
            ],
        }
        const [job] = composeJobs(
            [
                plan,
            ],
            [
                {
                    employmentId: 'acme',
                    bullets: [
                        {
                            caseId: 'a4',
                            full: 'Rewritten a4.',
                            compact: 'a4.',
                            minimal: 'a4.',
                        },
                        {
                            caseId: 'm1',
                            full: 'Same group as a4.',
                            compact: 'x.',
                            minimal: 'x.',
                        },
                        {
                            caseId: 't1',
                            full: 'A case of another employment.',
                            compact: 'x.',
                            minimal: 'x.',
                        },
                    ],
                },
            ],
        )
        // m1 shares a4's group; the top-up follows the suggestion in rank order.
        expect(job?.bullets.map(bullet => bullet.caseId)).toEqual([
            'a4',
            'a2',
            'a3',
        ])
        expect(job?.bullets[0]?.variants.full).toBe('Rewritten a4.')
        expect(job?.bullets[1]?.sourced).toBe(true)
        expect(job?.minBullets).toBe(2)

        const [suggestedOnly] = composeJobs(
            [
                plan,
            ],
            [],
        )
        expect(suggestedOnly?.bullets.map(bullet => bullet.caseId)).toEqual([
            'm1',
            'a2',
            'a3',
        ])
    })

    it("prints exactly the target: the model's first cases when it gives more, never more than the candidates", () => {
        const profile = aiProfile()
        const acme = profile.employments.find(item => item.id === 'acme')
        if (!acme) throw new Error('no acme')
        const cases = [
            'b1',
            'b2',
            'b3',
            'b4',
        ].map(id => exampleCase(id, 'acme'))
        const plan = (target: number, ids = cases): EmploymentPlan => ({
            employment: acme,
            quota: {
                min: 1,
                target,
            },
            ranked: ids.map((item, index) => ({
                item,
                score: 10 - index,
            })),
            suggested: ids.slice(0, target).map(item => item.id),
        })
        const chosen = (ids: string[]) => [
            {
                employmentId: 'acme',
                bullets: ids.map(caseId => ({
                    caseId,
                    full: `Rewritten ${caseId}.`,
                    compact: `${caseId}.`,
                    minimal: `${caseId}.`,
                })),
            },
        ]
        const ids = (job?: TailoredJob) => job?.bullets.map(bullet => bullet.caseId)

        const [more] = composeJobs(
            [
                plan(2),
            ],
            chosen([
                'b4',
                'b3',
                'b1',
            ]),
        )
        expect(ids(more)).toEqual([
            'b4',
            'b3',
        ])
        expect(more?.bullets.every(bullet => !bullet.sourced)).toBe(true)

        const [fewer] = composeJobs(
            [
                plan(3),
            ],
            chosen([
                'b3',
            ]),
        )
        expect(ids(fewer)).toEqual([
            'b3',
            'b1',
            'b2',
        ])

        const [capped] = composeJobs(
            [
                plan(2, cases.slice(0, 1)),
            ],
            chosen([]),
        )
        expect(ids(capped)).toEqual([
            'b1',
        ])
        expect(capped?.minBullets).toBe(1)
    })

    it('adapts the summary but keeps its figures, and the AI paragraph only for an AI role', () => {
        const profile = aiProfile()
        profile.career.careerStartYear = 2018
        const answer = [
            {
                id: 'profile',
                full: 'An engineer with 8 years who ships products.',
                compact: 'Ships.',
            },
            {
                id: 'ai_tools',
                full: 'Shipped 12 LLM features.',
                compact: 'LLM.',
            },
        ]
        const now = new Date('2026-11-09T00:00:00Z')
        expect(composeSummary(profile, false, answer, now)).toEqual([
            {
                id: 'profile',
                full: 'An engineer with 8 years who ships products.',
                compact: 'Ships.',
            },
        ])
        expect(composeSummary(profile, true, answer, now)[1]).toEqual({
            id: 'ai_tools',
            full: 'Builds LLM features with evaluation.',
            compact: 'LLM.',
        })
    })

    it('drops hedges before a figure, never the figure', () => {
        expect(dropHedges('Reached **profitability in roughly 3 months**.')).toBe(
            'Reached **profitability in 3 months**.',
        )
        expect(dropHedges('Roughly seven services, about 40% faster, around two calls.')).toBe(
            'Seven services, 40% faster, two calls.',
        )
        expect(dropHedges('Talked about the design.')).toBe('Talked about the design.')
    })

    it('counts the bullets left as the profile wrote them, and expects most to change for another stack', () => {
        const python = exampleCase('p1', 'acme', {
            technologies: [
                'Python',
                'FastAPI',
            ],
            variants: {
                full: 'Built an ingestion pipeline with signed uploads and background processing in roughly 3 weeks.',
                compact: 'Built an ingestion pipeline with signed uploads.',
                minimal: 'Built an ingestion pipeline.',
            },
        })
        const cases = [
            python,
            exampleCase('a2', 'acme'),
            exampleCase('a3', 'acme'),
        ]
        const profile = aiProfile()
        const acme = profile.employments.find(item => item.id === 'acme')
        if (!acme) throw new Error('no acme')
        const job = (texts: Record<string, string | undefined>): TailoredJob[] => [
            {
                employment: acme,
                minBullets: 0,
                bullets: cases.map(item => {
                    const own = texts[item.id]
                    return {
                        caseId: item.id,
                        score: 1,
                        sourced: false,
                        variants: own
                            ? {
                                  full: own,
                                  compact: own,
                                  minimal: own,
                              }
                            : {
                                  ...item.variants,
                                  full: item.variants.full.replace('roughly ', ''),
                              },
                    }
                }),
            },
        ]
        const stack = [
            'Python',
            'FastAPI',
        ]
        expect(bulletChanges(job({}), cases, stack)).toEqual({
            bullets: 3,
            unchanged: 3,
            expected: 3,
            unchangedExpected: 3,
            tailored: false,
        })
        expect(
            bulletChanges(
                job({
                    p1: 'Built a Python and FastAPI ingestion pipeline with signed uploads in 3 weeks.',
                    a2: 'Built the a2 backend service end to end.',
                }),
                cases,
                stack,
            ),
        ).toMatchObject({
            unchanged: 1,
            unchangedExpected: 1,
            tailored: true,
        })
        // A case whose wording names the whole stack is not expected to change.
        expect(
            bulletChanges(
                job({}),
                [
                    exampleCase('a2', 'acme'),
                ],
                [
                    'a2',
                ],
            ),
        ).toMatchObject({
            bullets: 1,
            expected: 0,
            tailored: true,
        })
    })
})
