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

/** Step 1: the vacancy's requirements, which cases evidence them, and whether it is an AI role (D-115). */
export const analysisAnswerSchema = z.strictObject({
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

/** Step 2: the chosen cases rewritten, the summary adapted, the skill rows ordered and spelled as the vacancy does. */
export const compositionAnswerSchema = z.strictObject({
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
})
export type CompositionAnswer = z.output<typeof compositionAnswerSchema>
