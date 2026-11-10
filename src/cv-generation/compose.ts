import type { ProfileDocument } from '../profile/profile.schemas.js'
import type { Analysis, EmploymentPlan } from './analysis.js'
import type { CompositionAnswer } from './cv-generation.schemas.js'
import { skillKey, type TailoredSkillRow, tailorSkills, textSkillKeys, type VacancySkill } from './skills.js'

/*
 * The composition applied in code (Work Finder's composition policy and
 * source fallback): every bullet is a case of its employment, kept by id;
 * a rewrite that breaks a rule takes the case's own text instead of failing
 * the CV; each employment prints exactly its quota's target.
 */

type ProfileCase = ProfileDocument['cases'][number]
type Employment = ProfileDocument['employments'][number]

export const variantNames = [
    'full',
    'compact',
    'minimal',
] as const
export type VariantName = (typeof variantNames)[number]
export type Variants = Record<VariantName, string>

export type TailoredBullet = {
    caseId: string
    variants: Variants
    /** The case's score in the analysis: the fit drops lower ones first. */
    score: number
    /** True when the rewrite broke a rule and the case's own text is printed. */
    sourced: boolean
}

export type TailoredJob = {
    employment: Employment
    minBullets: number
    bullets: TailoredBullet[]
}

export type TailoredSummary = {
    id: string
    full: string
    compact: string
}

/** The CV's content before fitting: what the fit shortens and the document is built from. */
export type TailoredContent = {
    summary: TailoredSummary[]
    jobs: TailoredJob[]
    skills: TailoredSkillRow[]
}

const BULLET_MAX = 700
const SUMMARY_MAX = 1_200

/** One line of plain text: no line breaks, single spaces, no long dashes (the owner's rule). */
export const cleanText = (value: string, max: number) =>
    value
        .replace(/\s+/g, ' ')
        .replace(/\s*—\s*/g, ', ')
        .trim()
        .slice(0, max)
        .trim()

const NUMBER_WORDS =
    'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|a dozen|dozens|a hundred|hundreds|a thousand|thousands'
const HEDGE = new RegExp(
    `\\b(?:roughly|approximately|approx\\.|about|around|circa)\\s+(?=(?:\\*\\*)?(?:[~$€£]?\\d|(?:${NUMBER_WORDS})\\b))`,
    'gi',
)

/** A figure stated without a hedge: `roughly 3 months` → `3 months` (the case's figure stays). */
export function dropHedges(value: string): string {
    const dropped = value.replace(HEDGE, '')
    const opening = /^(\*\*)?[A-Z]/.test(value)
    return opening && /^(\*\*)?[a-z]/.test(dropped) ? dropped.replace(/[a-z]/, letter => letter.toUpperCase()) : dropped
}

/** The figures of a text: `2x`, `3.5`, `40%` → `2`, `3.5`, `40`. */
export const figures = (value: string) => value.match(/\d+(?:[.,]\d+)*/g) ?? []

/** Every figure of `text` is one of `allowed` (D-xx facts mode `strict`: no invented metrics). */
export const keepsFigures = (text: string, allowed: ReadonlySet<string>) =>
    figures(text).every(figure => allowed.has(figure))

const caseFigures = (item: ProfileCase) =>
    new Set(
        [
            item.variants.full,
            item.variants.compact,
            item.variants.minimal,
            item.title,
            ...item.keyClaims.map(claim => claim.text),
            ...item.metricClaims.map(claim => claim.text),
        ].flatMap(figures),
    )

/**
 * The model's variants of a case where each holds (not empty, no figure
 * the case does not have), else the case's own; each no longer than the one
 * before it.
 */
export function bulletVariants(
    item: ProfileCase,
    answer?: Variants,
): {
    variants: Variants
    sourced: boolean
} {
    const allowed = caseFigures(item)
    let sourced = !answer
    const pick = (name: VariantName) => {
        const text = answer ? dropHedges(cleanText(answer[name], BULLET_MAX)) : ''
        if (text && keepsFigures(text, allowed)) return text
        sourced = true
        return dropHedges(cleanText(item.variants[name], BULLET_MAX))
    }
    const full = pick('full')
    const compactText = pick('compact')
    const compact = compactText.length > full.length ? full : compactText
    const minimalText = pick('minimal')
    const minimal = minimalText.length > compact.length ? compact : minimalText
    return {
        variants: {
            full,
            compact,
            minimal,
        },
        sourced,
    }
}

/**
 * The bullets of each employment, exactly the quota's target: the model's
 * choice, in its order, of the employment's own ranked cases, one per
 * achievement group on the whole CV, its first `target` only; topped up to
 * the target from the code's suggestion, then the ranking, in rank order,
 * with the cases' own text. An employment the model left out gets the
 * suggestion. Only the fit prints fewer, down to the minimum.
 */
export function composeJobs(plans: EmploymentPlan[], answer: CompositionAnswer['employments']): TailoredJob[] {
    const usedCases = new Set<string>()
    const usedGroups = new Set<string>()
    const take = (item: ProfileCase) => {
        if (usedCases.has(item.id) || (item.achievementGroup && usedGroups.has(item.achievementGroup))) return false
        usedCases.add(item.id)
        if (item.achievementGroup) usedGroups.add(item.achievementGroup)
        return true
    }
    return plans.map(plan => {
        const ranked = new Map(
            plan.ranked.map(entry => [
                entry.item.id,
                entry,
            ]),
        )
        const own = answer.find(entry => entry.employmentId === plan.employment.id)
        const bullets: TailoredBullet[] = []
        const add = (caseId: string, variants?: Variants) => {
            const entry = ranked.get(caseId)
            if (!entry || bullets.length >= plan.quota.target || !take(entry.item)) return
            bullets.push({
                caseId,
                score: entry.score,
                ...bulletVariants(entry.item, variants),
            })
        }
        if (own) for (const bullet of own.bullets) add(bullet.caseId.trim(), bullet)
        for (const caseId of [
            ...plan.suggested,
            ...plan.ranked.map(entry => entry.item.id),
        ]) {
            if (bullets.length >= plan.quota.target) break
            add(caseId)
        }
        return {
            employment: plan.employment,
            minBullets: Math.min(plan.quota.min, bullets.length),
            bullets,
        }
    })
}

/** A bullet's text for comparison: case, bold, hedges, punctuation and spacing aside. */
const comparable = (value: string) =>
    dropHedges(value)
        .replace(/\*\*/g, '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()

export type BulletChanges = {
    bullets: number
    /** Bullets printed as their case's own text, the fallback included. */
    unchanged: number
    /** Bullets whose case wording does not name the whole vacancy stack: they must be tailored. */
    expected: number
    unchangedExpected: number
    /** Most of the expected bullets differ from their case's text. */
    tailored: boolean
}

/**
 * How many chosen bullets the composition left as the profile wrote them.
 * A bullet is expected to change when the vacancy's stack names a technology
 * its case's wording does not: then at least most such bullets must differ.
 */
export function bulletChanges(jobs: TailoredJob[], cases: ProfileCase[], stack: string[]): BulletChanges {
    const byId = new Map(
        cases.map(item => [
            item.id,
            item,
        ]),
    )
    const stackKeys = [
        ...new Set(stack.map(skillKey).filter(Boolean)),
    ]
    let bullets = 0
    let unchanged = 0
    let expected = 0
    let unchangedExpected = 0
    for (const bullet of jobs.flatMap(job => job.bullets)) {
        const item = byId.get(bullet.caseId)
        if (!item) continue
        bullets += 1
        const sources = new Set(variantNames.map(name => comparable(item.variants[name])))
        const same = variantNames.every(name => sources.has(comparable(bullet.variants[name])))
        const wording = textSkillKeys(variantNames.map(name => item.variants[name]).join(' '))
        const differs = stackKeys.some(key => !wording.has(key))
        if (same) unchanged += 1
        if (differs) {
            expected += 1
            if (same) unchangedExpected += 1
        }
    }
    return {
        bullets,
        unchanged,
        expected,
        unchangedExpected,
        tailored: unchangedExpected * 2 <= expected,
    }
}

/** The summary paragraphs for this vacancy (the AI-only ones only for an AI role, D-115), at most the template's 2. */
export const tailoredSummarySource = (profile: ProfileDocument, aiRole: boolean) =>
    profile.summary.filter(item => (aiRole || !item.aiOnly) && (item.full || item.compact)).slice(0, 2)

/** Years of experience the summary may state, from `careerStartYear`. */
const experienceYears = (profile: ProfileDocument, now: Date) =>
    profile.career.careerStartYear ? now.getUTCFullYear() - profile.career.careerStartYear : undefined

/** The model's paragraph where it keeps the figures of the profile's summary, else the profile's own. */
export function composeSummary(
    profile: ProfileDocument,
    aiRole: boolean,
    answer: CompositionAnswer['summary'],
    now = new Date(),
): TailoredSummary[] {
    const source = tailoredSummarySource(profile, aiRole)
    const years = experienceYears(profile, now)
    const allowed = new Set([
        ...profile.summary.flatMap(item => [
            ...figures(item.full),
            ...figures(item.compact),
        ]),
        ...(years === undefined
            ? []
            : [
                  String(years),
                  String(years - 1),
              ]),
    ])
    return source.map(item => {
        const own = answer.find(entry => entry.id === item.id)
        const pick = (text: string | undefined, fallback: string) => {
            const clean = cleanText(text ?? '', SUMMARY_MAX)
            return clean && keepsFigures(clean, allowed) ? clean : cleanText(fallback, SUMMARY_MAX)
        }
        const full = pick(own?.full, item.full || item.compact)
        const compact = pick(own?.compact, item.compact || item.full)
        return {
            id: item.id,
            full,
            compact: compact.length > full.length ? full : compact,
        }
    })
}

/** The skill rows of this vacancy: the profile's rows (AI-only ones only for an AI role), tailored (skills.ts). */
export const composeSkills = (
    profile: ProfileDocument,
    aiRole: boolean,
    answer: CompositionAnswer['skills'],
    vacancySkills: VacancySkill[],
    analysis: Pick<Analysis, 'requirements'>,
) =>
    tailorSkills({
        rows: profile.skills.filter(row => aiRole || !row.aiOnly).slice(0, 14),
        model: answer,
        vacancySkills,
        vacancyTechnologies: analysis.requirements.flatMap(requirement => requirement.technologies),
    })
