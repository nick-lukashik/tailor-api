import { buildMasterCv, masterCases } from '../master-cv/master-cv.js'
import type { ProfileDocument } from '../profile/profile.schemas.js'
import type { CvDocument } from '../tex/cv-document.js'
import type { TailoredContent } from './compose.js'
import { bulletId, type FitState } from './tailored-cv.js'

/*
 * A general vacancy (a talent pool, an open application: `vacancyKind`
 * general) gets the master CV as is, the document of `buildMasterCv`. The fit
 * may still shorten it to `settings.maxPages`: the compact summary, the
 * cases' own compact and minimal variants, then whole bullets within the
 * general quota's minimum. Its skill rows are kept whole.
 */

/** Above `DROPPABLE_BELOW`: the fit never drops an item of the master CV's skills. */
const KEPT = 100

/** The master CV as the fit's content: what it may shorten and in which order. */
export function generalContent(profile: ProfileDocument): TailoredContent {
    const document = buildMasterCv(profile)
    return {
        summary: profile.summary
            .filter(item => !item.aiOnly && (item.full || item.compact))
            .slice(0, 2)
            .map(item => {
                const full = item.full || item.compact
                const compact = item.compact || item.full
                return {
                    id: item.id,
                    full,
                    compact: compact.length > full.length ? full : compact,
                }
            }),
        jobs: masterCases(profile).map(({ employment, cases }) => ({
            employment,
            minBullets: Math.min(employment.quota?.general.min ?? 0, cases.length),
            bullets: cases.map(item => ({
                caseId: item.id,
                variants: item.variants,
                score: 0,
                sourced: false,
            })),
        })),
        skills: document.skills.map(row => ({
            label: row.label,
            items: row.items.map(name => ({
                name,
                priority: KEPT,
            })),
        })),
    }
}

/** The master CV with the fit state applied; with no change, exactly `buildMasterCv(profile)`. */
export function buildGeneralCv(profile: ProfileDocument, content: TailoredContent, state: FitState): CvDocument {
    const document = buildMasterCv(profile)
    const caseIndex = new Map(
        profile.cases.map((item, index) => [
            item.id,
            index,
        ]),
    )
    const removed = new Set(state.removed)
    return {
        ...document,
        summary: state.summaryCompact ? content.summary.map(item => item.compact).filter(Boolean) : document.summary,
        jobs: document.jobs.map((job, jobIndex) => {
            const fixed = content.jobs[jobIndex]?.employment.fixedBullets.length ?? 0
            const bullets = new Map(
                (content.jobs[jobIndex]?.bullets ?? []).map(bullet => [
                    bulletId(bullet.caseId, caseIndex.get(bullet.caseId) ?? 0),
                    bullet,
                ]),
            )
            return {
                ...job,
                bullets: job.bullets.flatMap((printed, position) => {
                    const bullet = position < fixed ? undefined : bullets.get(printed.id)
                    if (!bullet)
                        return [
                            printed,
                        ]
                    if (removed.has(bullet.caseId)) return []
                    const variant = state.variants[bullet.caseId]
                    return [
                        variant
                            ? {
                                  id: printed.id,
                                  text: bullet.variants[variant],
                              }
                            : printed,
                    ]
                }),
            }
        }),
    }
}
