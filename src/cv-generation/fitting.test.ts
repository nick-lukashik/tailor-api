import { describe, expect, it } from 'vitest'
import { aiProfile } from '../../test/fixtures/cv-profile.js'
import type { CvDocument, CvMeasurement } from '../tex/cv-document.js'
import type { TailoredContent } from './compose.js'
import { fitCv, LINES_PER_PAGE, MAX_FIT_BUILDS, overflowLines } from './fitting.js'
import { buildTailoredCv, initialFitState } from './tailored-cv.js'

const CHARS_PER_LINE = 50

/** A stand-in for tailor-tex: lines from the text length, pages from the lines. */
const measureOf =
    (overfull: (document: CvDocument) => number = () => 0) =>
    async (document: CvDocument): Promise<CvMeasurement> => {
        const blocks = [
            ...document.summary.map((text, index) => ({
                id: `summary:${index}`,
                lines: Math.ceil(text.length / CHARS_PER_LINE),
            })),
            ...document.skills.map((row, index) => ({
                id: `skill:${index}`,
                lines: Math.ceil(`${row.label}: ${row.items.join(', ')}`.length / CHARS_PER_LINE),
            })),
            ...document.jobs.flatMap(job =>
                job.bullets.map(bullet => ({
                    id: `bullet:${bullet.id}`,
                    lines: Math.ceil(bullet.text.length / CHARS_PER_LINE),
                })),
            ),
        ]
        const lines = 10 + blocks.reduce((sum, block) => sum + block.lines, 0)
        const pages = Math.ceil(lines / LINES_PER_PAGE)
        return {
            pages,
            fill: [
                ...Array.from(
                    {
                        length: pages - 1,
                    },
                    () => 1,
                ),
                (lines % LINES_PER_PAGE || LINES_PER_PAGE) / LINES_PER_PAGE,
            ],
            sizeBytes: 1,
            fits: pages <= 1,
            overfullPt: overfull(document),
            fontsOk: true,
            blocks,
            warnings: [],
        }
    }

const long = (id: string) => `${id} `.repeat(60).trim()

function content(bullets: number): TailoredContent {
    const profile = aiProfile()
    const acme = profile.employments.find(item => item.id === 'acme')
    if (!acme) throw new Error('no acme')
    return {
        summary: [
            {
                id: 'profile',
                full: long('summary'),
                compact: 'A short summary.',
            },
        ],
        jobs: [
            {
                employment: acme,
                minBullets: 2,
                bullets: Array.from(
                    {
                        length: bullets,
                    },
                    (_, index) => ({
                        caseId: `b${index}`,
                        score: 100 - index,
                        sourced: false,
                        variants: {
                            full: long(`full${index}`),
                            compact: `${long(`c${index}`).slice(0, 150)}.`,
                            minimal: `Minimal ${index}.`,
                        },
                    }),
                ),
            },
        ],
        skills: [
            {
                label: 'Frontend',
                items: [
                    {
                        name: 'React',
                        priority: 100,
                    },
                ],
            },
        ],
    }
}

const fitted = (tailored: TailoredContent, measure = measureOf(), maxPages = 1) => {
    const profile = aiProfile()
    return fitCv(
        {
            content: tailored,
            maxPages,
            build: state =>
                buildTailoredCv(profile, tailored, state, {
                    headline: 'Backend Engineer',
                    keywords: [],
                }),
            bulletIds: new Map(
                tailored.jobs.flatMap(job =>
                    job.bullets.map(bullet => [
                        bullet.caseId,
                        bullet.caseId,
                    ]),
                ),
            ),
        },
        measure,
        initialFitState(),
    )
}

describe('fitting a CV to its pages', () => {
    it('estimates the lines over the allowed pages', async () => {
        const measurement = await measureOf()(
            buildTailoredCv(aiProfile(), content(2), initialFitState(), {
                headline: 'x',
                keywords: [],
            }),
        )
        expect(overflowLines(measurement, 3)).toBe(0)
        expect(
            overflowLines(
                {
                    ...measurement,
                    pages: 3,
                    fill: [
                        1,
                        1,
                        0.5,
                    ],
                },
                2,
            ),
        ).toBe(LINES_PER_PAGE / 2)
    })

    it('keeps a CV that already fits as it is, in one build', async () => {
        const result = await fitted(content(2), measureOf(), 2)
        expect(result).toMatchObject({
            fitted: true,
            builds: 1,
            nearMiss: false,
            state: initialFitState(),
        })
    })

    it('compacts the summary first, then the last bullets, before removing any', async () => {
        const result = await fitted(content(8))
        if (!result.fitted) throw new Error(`not fitted: ${result.code}`)
        expect(result.measurement.pages).toBe(1)
        expect(result.state.summaryCompact).toBe(true)
        expect(result.state.removed).toEqual([])
        // The first bullet is the last to shorten.
        expect(result.state.variants.b0).toBeUndefined()
        expect(result.state.variants.b7).toBe('compact')
        expect(result.builds).toBeLessThanOrEqual(MAX_FIT_BUILDS)
    })

    it('removes the lowest bullets once nothing is left to shorten, never below the minimum', async () => {
        const tailored = content(12)
        for (const bullet of tailored.jobs[0]?.bullets ?? []) {
            bullet.variants.compact = bullet.variants.full
            bullet.variants.minimal = bullet.variants.full
        }
        const result = await fitted(tailored)
        if (!result.fitted) throw new Error(`not fitted: ${result.code}`)
        expect(result.measurement.pages).toBe(1)
        expect(result.state.removed.length).toBeGreaterThan(0)
        expect(result.state.removed).not.toContain('b0')
        expect(result.state.variants).toEqual({})
        expect(result.document.jobs[0]?.bullets.length).toBeGreaterThanOrEqual(2)
    })

    it('fails a CV that cannot fit within the minimum', async () => {
        const tailored = content(3)
        const [job] = tailored.jobs
        if (job) job.minBullets = 3
        const result = await fitted(tailored, async document => ({
            ...(await measureOf()(document)),
            pages: 2,
            fill: [
                1,
                0.9,
            ],
        }))
        expect(result).toMatchObject({
            fitted: false,
            code: 'cv_does_not_fit',
        })
    })

    it('undoes cuts that bring an overfull line and finds others', async () => {
        // Only minimal variants are shorter, and the one of b9, the first to try, overflows its line.
        const tailored = content(10)
        for (const bullet of tailored.jobs[0]?.bullets ?? []) bullet.variants.compact = bullet.variants.full
        const overflowing = (document: CvDocument) =>
            document.jobs.some(job => job.bullets.some(bullet => bullet.text === 'Minimal 9.')) ? 20 : 0
        const builds: number[] = []
        const measure = measureOf(overflowing)
        const result = await fitted(tailored, async document => {
            builds.push(overflowing(document))
            return measure(document)
        })
        if (!result.fitted) throw new Error(`not fitted: ${result.code}`)
        expect(builds).toContain(20)
        expect(result.measurement.overfullPt).toBe(0)
        expect(result.measurement.pages).toBe(1)
        expect(result.state.variants.b9).not.toBe('minimal')
    })

    it('takes a near miss on the pages when every build overflows a little, and fails a wide overflow', async () => {
        const near = await fitted(
            content(1),
            measureOf(() => 5),
        )
        expect(near).toMatchObject({
            fitted: true,
            nearMiss: true,
        })
        const wide = await fitted(
            content(1),
            measureOf(() => 40),
        )
        expect(wide).toMatchObject({
            fitted: false,
            code: 'cv_overfull',
        })
    })
})
