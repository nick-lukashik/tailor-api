import { z } from 'zod'
import { caseCategories } from '../profile/profile.schemas.js'

/*
 * What the models return for a CV (sent to the gateway as JSON Schema: every
 * key required, no length limits, so the answer has one shape; the code
 * grounds and clips it afterwards). Change them with the prompts in
 * `cv.prompts.ts` and bump `CV_PROMPT_VERSION`.
 */

export const requirementImportances = [
    'must',
    'responsibility',
    'preferred',
] as const
export type RequirementImportance = (typeof requirementImportances)[number]

export const vacancyKinds = [
    'general',
    'specific',
] as const
export type VacancyKind = (typeof vacancyKinds)[number]

/**
 * Step 1: whether the vacancy is general (a talent pool, an open application:
 * the master CV as is), its requirements, which cases evidence them, and
 * whether it is an AI role (D-115).
 */
export const analysisAnswerSchema = z.strictObject({
    vacancyKind: z.enum(vacancyKinds),
    vacancyKindReason: z.string(),
    aiRole: z.boolean(),
    aiRoleReason: z.string(),
    requirements: z.array(
        z.strictObject({
            id: z.string(),
            text: z.string(),
            importance: z.enum(requirementImportances),
            categories: z.array(z.enum(caseCategories)),
            technologies: z.array(z.string()),
        }),
    ),
    matches: z.array(
        z.strictObject({
            requirementId: z.string(),
            caseId: z.string(),
            /** 1: directly evidenced; 0.5: a specific transferable contribution. */
            match: z.number(),
            claimIds: z.array(z.string()),
        }),
    ),
})
export type AnalysisAnswer = z.output<typeof analysisAnswerSchema>

/**
 * Step 2: the CV's English title, the chosen cases rewritten, the summary
 * adapted, the skill rows ordered and spelled as the vacancy does, and the
 * vacancy's skills read in English with their rows.
 */
export const compositionAnswerSchema = z.strictObject({
    title: z.string(),
    summary: z.array(
        z.strictObject({
            id: z.string(),
            full: z.string(),
            compact: z.string(),
        }),
    ),
    employments: z.array(
        z.strictObject({
            employmentId: z.string(),
            bullets: z.array(
                z.strictObject({
                    caseId: z.string(),
                    full: z.string(),
                    compact: z.string(),
                    minimal: z.string(),
                }),
            ),
        }),
    ),
    skills: z.array(
        z.strictObject({
            label: z.string(),
            items: z.array(z.string()),
        }),
    ),
    vacancySkills: z.array(
        z.strictObject({
            /** As the vacancy's skills list has it. */
            name: z.string(),
            english: z.string(),
            /** The label of the row it went into; empty when it is no technology or practice. */
            row: z.string(),
        }),
    ),
})
export type CompositionAnswer = z.output<typeof compositionAnswerSchema>
