import { describe, expect, it } from 'vitest'
import { aiProfile, exampleCase } from '../../test/fixtures/cv-profile.js'
import type { EmploymentPlan } from './analysis.js'
import { bulletVariants, cleanText, composeJobs, composeSummary, keepsFigures } from './compose.js'

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

    it("keeps the model's choice within the quota, drops cases of another employment, tops up to the minimum", () => {
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
        expect(job?.bullets.map(bullet => bullet.caseId)).toEqual([
            'a4',
            'a2',
        ])
        expect(job?.bullets[0]?.variants.full).toBe('Rewritten a4.')
        expect(job?.bullets[1]?.sourced).toBe(true)

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
})
