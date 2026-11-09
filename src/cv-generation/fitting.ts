import type { CvDocument, CvMeasurement } from '../tex/cv-document.js'
import { type TailoredContent, type VariantName, variantNames } from './compose.js'
import { DROPPABLE_BELOW } from './skills.js'
import type { FitState } from './tailored-cv.js'

/*
 * The fit, ported from Work Finder's fitting (resume/domain/fitting.ts,
 * application/fit-resume.ts) to tailor-tex's measure: build, measure, and
 * while the CV has more pages than allowed, shorten in this order: the
 * compact summary, the lowest-priority bullets to compact then minimal, a
 * skill row that wraps loses its least relevant items (never a vacancy skill
 * or the core), and only then a whole bullet within its employment's minimum.
 * A change that brings an overfull line is undone and not tried again.
 */

/** Builds per CV: tailor-tex takes about a second each. */
export const MAX_FIT_BUILDS = 12
/** An overfull line up to this is invisible (Work Finder's tolerance). */
export const OVERFULL_TOLERANCE_PT = 2
/** Past this a line visibly runs into the margin: no CV rather than that. */
export const OVERFULL_NEAR_MISS_PT = 12
/** Printed lines of a full page of the template, for the estimate of what to cut. */
export const LINES_PER_PAGE = 60

export type FitInput = {
    content: TailoredContent
    maxPages: number
    /** The document of a state (`buildTailoredCv`). */
    build: (state: FitState) => CvDocument
    /** The measured lines of each block id: `bullet:<id>` of a case is `bulletIds.get(caseId)`. */
    bulletIds: ReadonlyMap<string, string>
}

export type FitResult =
    | {
          fitted: true
          state: FitState
          document: CvDocument
          measurement: CvMeasurement
          builds: number
          /** Accepted with an overfull line over the tolerance, but under the near miss. */
          nearMiss: boolean
      }
    | {
          fitted: false
          /** `cv_does_not_fit`: more pages after every legal cut; `cv_overfull`: a line runs into the margin. */
          code: 'cv_does_not_fit' | 'cv_overfull'
          builds: number
      }

type Action =
    | {
          kind: 'summary'
      }
    | {
          kind: 'variant'
          caseId: string
          variant: VariantName
      }
    | {
          kind: 'skills'
          row: number
      }
    | {
          kind: 'remove'
          caseId: string
      }

const blockLines = (measurement: CvMeasurement, id: string, text: string) => {
    const measured = measurement.blocks.find(block => block.id === id)?.lines
    return measured ?? Math.max(1, Math.ceil(text.length / 100))
}

/** Lines a shorter text saves, from the block's measured lines and the length ratio; at least a quarter. */
const saving = (lines: number, before: string, after: string) =>
    Math.max(0.25, lines - Math.max(1, Math.ceil((lines * after.length) / Math.max(1, before.length))))

/** Lines over the allowed pages, from the page count and the fill of the last page. */
export const overflowLines = (measurement: CvMeasurement, maxPages: number) =>
    measurement.pages <= maxPages
        ? 0
        : Math.max(1, Math.ceil((measurement.pages - maxPages - 1 + (measurement.fill.at(-1) ?? 1)) * LINES_PER_PAGE))

const apply = (state: FitState, action: Action): FitState => {
    switch (action.kind) {
        case 'summary':
            return {
                ...state,
                summaryCompact: true,
            }
        case 'variant':
            return {
                ...state,
                variants: {
                    ...state.variants,
                    [action.caseId]: action.variant,
                },
            }
        case 'skills':
            return {
                ...state,
                skillDrops: {
                    ...state.skillDrops,
                    [action.row]: (state.skillDrops[action.row] ?? 0) + 1,
                },
            }
        case 'remove':
            return {
                ...state,
                removed: [
                    ...state.removed,
                    action.caseId,
                ],
            }
    }
}

/** Bullets in the order the fit cuts them: the last of each employment first, a lower score first on a tie. */
function cutOrder(content: TailoredContent) {
    return content.jobs
        .flatMap(job =>
            job.bullets.map((bullet, position) => ({
                job,
                bullet,
                position,
            })),
        )
        .sort((a, b) => b.position - a.position || a.bullet.score - b.bullet.score)
}

/**
 * The cuts for one round, in the order above, until they are estimated to
 * save the lines over the pages; each phase only once the ones before have
 * nothing left. Empty when nothing legal remains.
 */
export function plan(
    input: FitInput,
    state: FitState,
    measurement: CvMeasurement,
    blocked: ReadonlySet<string>,
): Action[] {
    const needed = overflowLines(measurement, input.maxPages)
    const actions: Action[] = []
    let saved = 0
    let current = state
    const take = (action: Action, lines: number) => {
        actions.push(action)
        current = apply(current, action)
        saved += lines
        return saved >= needed
    }
    const document = input.build(state)
    const removed = new Set(state.removed)

    const order = cutOrder(input.content)

    if (!state.summaryCompact) {
        const lines = input.content.summary.reduce(
            (sum, item, index) =>
                item.compact.length < item.full.length
                    ? sum + saving(blockLines(measurement, `summary:${index}`, item.full), item.full, item.compact)
                    : sum,
            0,
        )
        if (
            lines > 0.25 * input.content.summary.length
            && take(
                {
                    kind: 'summary',
                },
                lines,
            )
        )
            return actions
    }

    for (const step of [
        1,
        2,
    ])
        for (const { bullet } of order) {
            if (removed.has(bullet.caseId)) continue
            const now = current.variants[bullet.caseId] ?? 'full'
            const index = variantNames.indexOf(now)
            const next = variantNames.slice(index + 1).find(name => {
                const key = `${bullet.caseId}:${name}`
                return !blocked.has(key) && bullet.variants[name].length < bullet.variants[now].length
            })
            // The first pass makes bullets compact; minimal only once nothing else is left.
            if (!next || (step === 1 && next === 'minimal')) continue
            const id = `bullet:${input.bulletIds.get(bullet.caseId) ?? bullet.caseId}`
            const lines = saving(
                blockLines(measurement, id, bullet.variants[now]),
                bullet.variants[now],
                bullet.variants[next],
            )
            if (
                take(
                    {
                        kind: 'variant',
                        caseId: bullet.caseId,
                        variant: next,
                    },
                    lines,
                )
            )
                return actions
        }

    document.skills.forEach((row, index) => {
        if (saved >= needed) return
        const lines = measurement.blocks.find(block => block.id === `skill:${index}`)?.lines ?? 1
        const tailored = input.content.skills.findIndex(item => item.label === row.label)
        const droppable =
            (input.content.skills[tailored]?.items.filter(item => item.priority < DROPPABLE_BELOW).length ?? 0)
            - (current.skillDrops[tailored] ?? 0)
        if (lines > 1 && droppable > 0 && row.items.length > 1)
            take(
                {
                    kind: 'skills',
                    row: tailored,
                },
                0.5,
            )
    })
    if (saved >= needed) return actions

    const left = new Map(
        input.content.jobs.map(job => [
            job.employment.id,
            job.bullets.filter(bullet => !removed.has(bullet.caseId)).length,
        ]),
    )
    for (const { job, bullet } of order) {
        if (removed.has(bullet.caseId) || current.removed.includes(bullet.caseId)) continue
        const count = left.get(job.employment.id) ?? 0
        if (count <= job.minBullets) continue
        left.set(job.employment.id, count - 1)
        const variant = current.variants[bullet.caseId] ?? 'full'
        const id = `bullet:${input.bulletIds.get(bullet.caseId) ?? bullet.caseId}`
        if (
            take(
                {
                    kind: 'remove',
                    caseId: bullet.caseId,
                },
                blockLines(measurement, id, bullet.variants[variant]),
            )
        )
            return actions
    }
    return actions
}

const statesEqual = (a: FitState, b: FitState) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Builds and measures until the CV has at most `maxPages` pages with no
 * overfull line over the tolerance, within MAX_FIT_BUILDS builds. A round of
 * cuts after which a line overflows is undone and its variants blocked.
 * Without a clean build, the narrowest overflow under the near miss on the
 * allowed pages is taken; else the CV does not fit.
 */
export async function fitCv(
    input: FitInput,
    measure: (document: CvDocument) => Promise<CvMeasurement>,
    initial: FitState,
): Promise<FitResult> {
    const history: {
        state: FitState
        document: CvDocument
        measurement: CvMeasurement
    }[] = []
    const blocked = new Set<string>()
    let state = initial
    let previous:
        | {
              state: FitState
              measurement: CvMeasurement
              actions: Action[]
          }
        | undefined
    for (let builds = 1; builds <= MAX_FIT_BUILDS; builds++) {
        const document = input.build(state)
        const measurement = await measure(document)
        history.push({
            state,
            document,
            measurement,
        })
        const pagesOk = measurement.pages >= 1 && measurement.pages <= input.maxPages
        if (pagesOk && measurement.overfullPt <= OVERFULL_TOLERANCE_PT)
            return {
                fitted: true,
                state,
                document,
                measurement,
                builds,
                nearMiss: false,
            }
        let base = {
            state,
            measurement,
        }
        if (measurement.overfullPt > OVERFULL_TOLERANCE_PT && previous) {
            // The last cuts brought the overflow: undo them and never try their variants again.
            for (const action of previous.actions)
                if (action.kind === 'variant') blocked.add(`${action.caseId}:${action.variant}`)
            base = previous
        } else if (pagesOk) break
        const actions = plan(input, base.state, base.measurement, blocked)
        if (!actions.length) break
        const next = actions.reduce(apply, base.state)
        if (history.some(entry => statesEqual(entry.state, next))) break
        previous = {
            ...base,
            actions,
        }
        state = next
    }
    const nearMiss = history
        .filter(
            entry =>
                entry.measurement.pages >= 1
                && entry.measurement.pages <= input.maxPages
                && entry.measurement.overfullPt <= OVERFULL_NEAR_MISS_PT,
        )
        .sort((a, b) => a.measurement.overfullPt - b.measurement.overfullPt)[0]
    if (nearMiss)
        return {
            fitted: true,
            ...nearMiss,
            builds: history.length,
            nearMiss: true,
        }
    return {
        fitted: false,
        code: history.some(entry => entry.measurement.pages <= input.maxPages) ? 'cv_overfull' : 'cv_does_not_fit',
        builds: history.length,
    }
}
