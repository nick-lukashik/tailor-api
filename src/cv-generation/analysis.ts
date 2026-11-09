import { caseCategories, type ProfileDocument } from '../profile/profile.schemas.js'
import type { AnalysisAnswer, RequirementImportance } from './cv-generation.schemas.js'
import { matchingStack } from './skills.js'

/*
 * The analysis step, ported from Work Finder (resume/domain: references,
 * role-policy, scoring, selection): the model's requirements and matches
 * grounded in the bank, the AI-role decision (D-115), the cases each
 * employment may print and their ranking.
 */

export type CaseCategory = (typeof caseCategories)[number]
type ProfileCase = ProfileDocument['cases'][number]
type Employment = ProfileDocument['employments'][number]

export type Requirement = AnalysisAnswer['requirements'][number]
export type Match = {
    requirementId: string
    caseId: string
    match: 0.5 | 1
    claimIds: string[]
}

/** The analysis as stored on the CV (`cvs.analysis`) and used by the later steps. */
export type Analysis = {
    aiRole: boolean
    aiRoleReason: string
    requirements: Requirement[]
    matches: Match[]
}

const MAX_REQUIREMENTS = 60

/**
 * The model's answer kept only where it holds: unique requirement ids,
 * matches to active cases and known requirements only, a match of 1 or 0.5
 * (anything below 0.25 is no match), claim ids of that case only, each pair once.
 */
export function groundAnalysis(
    answer: AnalysisAnswer,
    cases: ProfileCase[],
): Omit<Analysis, 'aiRole'> & {
    modelAiRole: boolean
} {
    const seen = new Set<string>()
    const requirements: Requirement[] = []
    for (const requirement of answer.requirements) {
        const id = requirement.id.trim()
        if (!id || seen.has(id) || !requirement.text.trim() || requirements.length >= MAX_REQUIREMENTS) continue
        seen.add(id)
        requirements.push({
            ...requirement,
            id,
            text: requirement.text.trim().slice(0, 500),
            categories: [
                ...new Set(requirement.categories),
            ].slice(0, 3),
            technologies: [
                ...new Set(requirement.technologies.map(item => item.trim()).filter(Boolean)),
            ].slice(0, 20),
        })
    }
    const active = new Map(
        cases
            .filter(item => item.active)
            .map(item => [
                item.id,
                item,
            ]),
    )
    const pairs = new Map<string, Match>()
    for (const match of answer.matches) {
        const item = active.get(match.caseId)
        if (!item || !seen.has(match.requirementId) || !(match.match >= 0.25)) continue
        const claims = new Set(
            [
                ...item.keyClaims,
                ...item.metricClaims,
            ].map(claim => claim.id),
        )
        const grounded: Match = {
            requirementId: match.requirementId,
            caseId: match.caseId,
            match: match.match >= 0.75 ? 1 : 0.5,
            claimIds: [
                ...new Set(match.claimIds.filter(id => claims.has(id))),
            ],
        }
        const key = `${match.requirementId} ${match.caseId}`
        const before = pairs.get(key)
        if (!before || before.match < grounded.match) pairs.set(key, grounded)
    }
    return {
        modelAiRole: answer.aiRole,
        aiRoleReason: answer.aiRoleReason.trim().slice(0, 300),
        requirements,
        matches: [
            ...pairs.values(),
        ],
    }
}

/** Titles that name an applied-AI, LLM or forward-deployed role outright. */
const AI_TITLE =
    /forward[\s-]*deployed|\bllms?\b|\bapplied\s+(ai|ml)\b|\bgen(erative)?[\s-]*ai\b|\bai\b[^,;|()]*\b(engineer|developer)\b/i

/**
 * D-115: the AI-only parts of the profile (employments, skill rows, summary
 * paragraphs) are in only for an applied-AI, LLM engineer or forward-deployed
 * engineer vacancy. The model decides it in the analysis; a title that names
 * such a role says so on its own.
 */
export const decideAiRole = (title: string, modelAiRole: boolean) => modelAiRole || AI_TITLE.test(title)

export type RoleProfile = 'frontend' | 'backend' | 'fullstack' | 'ai'

const PRIORITIES: Record<RoleProfile, Record<CaseCategory, number>> = {
    frontend: {
        FE: 24,
        BE: 4,
        AR: 8,
        RE: 6,
        PF: 10,
        QA: 8,
        SE: 4,
        OW: 8,
        EE: 8,
        CO: 5,
        UX: 13,
        AI: 2,
    },
    backend: {
        FE: 3,
        BE: 24,
        AR: 13,
        RE: 13,
        PF: 8,
        QA: 8,
        SE: 10,
        OW: 8,
        EE: 7,
        CO: 4,
        UX: 1,
        AI: 1,
    },
    fullstack: {
        FE: 16,
        BE: 16,
        AR: 10,
        RE: 8,
        PF: 6,
        QA: 8,
        SE: 5,
        OW: 10,
        EE: 12,
        CO: 5,
        UX: 3,
        AI: 1,
    },
    ai: {
        FE: 8,
        BE: 12,
        AR: 10,
        RE: 10,
        PF: 4,
        QA: 8,
        SE: 5,
        OW: 8,
        EE: 10,
        CO: 3,
        UX: 2,
        AI: 20,
    },
}

export const IMPORTANCE: Record<RequirementImportance, number> = {
    must: 3,
    responsibility: 2,
    preferred: 1,
}

/** The role profile from the title and the core requirements (Work Finder's role policy). */
export function roleProfile(title: string, analysis: Pick<Analysis, 'aiRole' | 'requirements'>): RoleProfile {
    if (analysis.aiRole) return 'ai'
    const core = analysis.requirements.filter(item => item.importance !== 'preferred')
    const demand = (category: CaseCategory) => core.filter(item => item.categories.includes(category)).length
    const frontend = /front[\s-]?end/i.test(title)
    const backend = /back[\s-]?end/i.test(title)
    if (/full[\s-]?stack/i.test(title)) return 'fullstack'
    if (frontend && !backend) return 'frontend'
    if (backend && !frontend) return 'backend'
    if (demand('FE') > 0 && demand('FE') >= 2 * demand('BE')) return 'frontend'
    if (demand('BE') > 0 && demand('BE') >= 2 * demand('FE')) return 'backend'
    return 'fullstack'
}

/** Weights of the 12 categories, summing to 1: 60 % the role's priorities, 40 % what the requirements ask for. */
export function categoryWeights(role: RoleProfile, requirements: Requirement[]): Record<CaseCategory, number> {
    const signals = Object.fromEntries(
        caseCategories.map(id => [
            id,
            0,
        ]),
    ) as Record<CaseCategory, number>
    for (const item of requirements)
        for (const id of item.categories) signals[id] += IMPORTANCE[item.importance] / item.categories.length
    const total = Object.values(signals).reduce((sum, value) => sum + value, 0)
    const priors = PRIORITIES[role]
    const priorTotal = Object.values(priors).reduce((sum, value) => sum + value, 0)
    return Object.fromEntries(
        caseCategories.map(id => [
            id,
            total ? (0.6 * priors[id]) / priorTotal + (0.4 * signals[id]) / total : priors[id] / priorTotal,
        ]),
    ) as Record<CaseCategory, number>
}

const literal = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A case limited to some vacancies (`whenVacancyMentions`) competes only when the vacancy names one of its terms. */
export function eligible(item: ProfileCase, vacancyTexts: string[]) {
    if (!item.whenVacancyMentions.length) return true
    return item.whenVacancyMentions.some(term => {
        const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${literal(term)}(?![\\p{L}\\p{N}])`, 'iu')
        return vacancyTexts.some(text => pattern.test(text))
    })
}

/** 0.6 × category fit + 0.4 × evidence fit, both 0..100 (Work Finder's scoring). */
export function scoreCase(
    item: ProfileCase,
    analysis: Pick<Analysis, 'requirements' | 'matches'>,
    weights: Record<CaseCategory, number>,
) {
    const categoryFit = 100 * caseCategories.reduce((sum, id) => sum + (weights[id] * item.categoryRatings[id]) / 5, 0)
    const total = analysis.requirements.reduce((sum, requirement) => sum + IMPORTANCE[requirement.importance], 0)
    const evidence = analysis.requirements.reduce((sum, requirement) => {
        const match = analysis.matches.find(entry => entry.caseId === item.id && entry.requirementId === requirement.id)
        return sum + IMPORTANCE[requirement.importance] * (match?.match ?? 0)
    }, 0)
    const evidenceFit = total ? (100 * evidence) / total : 0
    return 0.6 * categoryFit + 0.4 * evidenceFit
}

/** Points a case gains for listing the vacancy's main stack: 5 per technology, at most 10. */
const STACK_POINTS = 5
const STACK_BONUS_MAX = 10

/** The technologies of the requirements that are the work itself (must and responsibility). */
export const mainStack = (requirements: Requirement[]) =>
    requirements.filter(item => item.importance !== 'preferred').flatMap(item => item.technologies)

/** The bonus of a case whose technologies match the vacancy's main stack. */
export const stackBonus = (item: ProfileCase, stack: string[]) =>
    Math.min(STACK_BONUS_MAX, STACK_POINTS * matchingStack(item.technologies, stack).length)

export type Quota = {
    min: number
    target: number
}

export type EmploymentPlan = {
    employment: Employment
    quota: Quota
    /** Its eligible active cases, best first, with their score. */
    ranked: {
        item: ProfileCase
        score: number
    }[]
    /** The code's pick: the best `target` cases, one per achievement group on the whole CV. */
    suggested: string[]
}

/** Bullets an employment may print at most (the template's 20, fixed bullets first). */
const BULLETS_MAX = 20

/** Employments a CV for this vacancy prints, by `order`: the AI-only ones only for an AI role (D-115). */
export const tailoredEmployments = (profile: ProfileDocument, aiRole: boolean) =>
    profile.employments
        .map((employment, index) => ({
            employment,
            index,
        }))
        .filter(({ employment }) => aiRole || !employment.aiOnly)
        .sort((a, b) => a.employment.order - b.employment.order || a.index - b.index)
        .map(({ employment }) => employment)

/**
 * Per employment: its quota (the AI one for an AI role, the general one
 * otherwise; every eligible case without a quota), its cases ranked by score
 * (plus the bonus for the vacancy's main stack),
 * and the code's suggestion the composition may revise.
 */
export function planEmployments(profile: ProfileDocument, title: string, analysis: Analysis): EmploymentPlan[] {
    const role = roleProfile(title, analysis)
    const weights = categoryWeights(role, analysis.requirements)
    const texts = analysis.requirements.flatMap(requirement => [
        requirement.text,
        ...requirement.technologies,
    ])
    const stack = mainStack(analysis.requirements)
    const usedGroups = new Set<string>()
    return tailoredEmployments(profile, analysis.aiRole).map(employment => {
        const room = Math.max(0, BULLETS_MAX - employment.fixedBullets.length)
        const ranked = profile.cases
            .filter(item => item.employmentId === employment.id && item.active && eligible(item, texts))
            .map((item, index) => ({
                item,
                index,
                score: scoreCase(item, analysis, weights) + stackBonus(item, stack),
            }))
            .sort((a, b) => b.score - a.score || a.index - b.index)
            .map(({ item, score }) => ({
                item,
                score,
            }))
        const configured = employment.quota?.[analysis.aiRole ? 'ai' : 'general']
        const target = Math.min(room, configured?.target ?? ranked.length)
        const quota = {
            min: Math.min(target, configured?.min ?? 0),
            target,
        }
        const suggested: string[] = []
        for (const { item } of ranked) {
            if (suggested.length >= quota.target) break
            if (item.achievementGroup && usedGroups.has(item.achievementGroup)) continue
            if (item.achievementGroup) usedGroups.add(item.achievementGroup)
            suggested.push(item.id)
        }
        return {
            employment,
            quota,
            ranked,
            suggested,
        }
    })
}
