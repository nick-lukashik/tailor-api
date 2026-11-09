import { BULLET_ID_MAX, cvDates, cvFrame } from '../master-cv/master-cv.js'
import type { ProfileDocument } from '../profile/profile.schemas.js'
import type { CvDocument } from '../tex/cv-document.js'
import type { TailoredContent, VariantName } from './compose.js'
import { DROPPABLE_BELOW } from './skills.js'

/** What the fit changed: shorter summary and bullets, bullets left out, skills dropped from a row that wraps. */
export type FitState = {
    summaryCompact: boolean
    variants: Record<string, VariantName>
    removed: string[]
    /** Per skill row (its index in the content): how many of its droppable items are left out. */
    skillDrops: Record<number, number>
}

export const initialFitState = (): FitState => ({
    summaryCompact: false,
    variants: {},
    removed: [],
    skillDrops: {},
})

/** The bullet id tailor-tex measures as `bullet:<id>`: the case id, or `case-<n>` for a long one. */
export const bulletId = (caseId: string, index: number) => (caseId.length <= BULLET_ID_MAX ? caseId : `case-${index}`)

/** A skill row's items with `drops` of its droppable ones left out, the lowest priority first. */
export function rowItems(row: TailoredContent['skills'][number], drops: number): string[] {
    const droppable = row.items
        .map((item, index) => ({
            item,
            index,
        }))
        .filter(({ item }) => item.priority < DROPPABLE_BELOW)
        .map(({ index }) => index)
        .reverse()
        .slice(0, Math.max(0, drops))
    const out = new Set(droppable)
    return row.items.filter((_, index) => !out.has(index)).map(item => item.name)
}

/**
 * The tailored CV document for tailor-tex: the header, education and
 * languages as the master CV has them (`cvFrame`), the vacancy's own title as
 * the headline (Work Finder), the composed summary, jobs and skills as the
 * fit state has them.
 */
export function buildTailoredCv(
    profile: ProfileDocument,
    content: TailoredContent,
    state: FitState,
    meta: {
        headline: string
        keywords: string[]
    },
): CvDocument {
    const caseIndex = new Map(
        profile.cases.map((item, index) => [
            item.id,
            index,
        ]),
    )
    const removed = new Set(state.removed)
    return {
        ...cvFrame(profile),
        headline: meta.headline,
        stack: profile.career.stackLine.slice(0, 160),
        summary: content.summary.map(item => (state.summaryCompact ? item.compact : item.full)).filter(Boolean),
        skills: content.skills
            .map((row, index) => ({
                label: row.label,
                items: rowItems(row, state.skillDrops[index] ?? 0),
            }))
            .filter(row => row.items.length),
        jobs: content.jobs.slice(0, 10).map((job, jobIndex) => ({
            title: job.employment.title,
            company: job.employment.company.name,
            dates: cvDates(job.employment.start, job.employment.end),
            location: job.employment.location,
            description: job.employment.company.description,
            bullets: [
                ...job.employment.fixedBullets.map((text, position) => ({
                    id: `fixed-${jobIndex}-${position}`,
                    text,
                })),
                ...job.bullets
                    .filter(bullet => !removed.has(bullet.caseId))
                    .map(bullet => ({
                        id: bulletId(bullet.caseId, caseIndex.get(bullet.caseId) ?? 0),
                        text: bullet.variants[state.variants[bullet.caseId] ?? 'full'],
                    })),
            ].slice(0, 20),
        })),
        pdf: {
            title: '',
            subject: `${meta.headline} CV`.slice(0, 500),
            keywords: [
                ...new Set(meta.keywords.map(keyword => keyword.slice(0, 80)).filter(Boolean)),
            ].slice(0, 200),
        },
    }
}
