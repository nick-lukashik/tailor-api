import { z } from 'zod'

/** The API contract of `vacancies`; OpenAPI is generated from these schemas. */

export const INTAKE_MAX_ITEMS = 200

// Strict: an unknown or misspelled field is a client error, not silently dropped.
export const vacancyIntakeItemSchema = z
    .strictObject({
        url: z
            .url({
                protocol: /^https?$/,
            })
            .max(2048)
            .optional(),
        /** Raw, unformatted: whatever was copied from the page. Blank counts as none. */
        text: z.string().trim().max(100_000).default(''),
    })
    .refine(item => item.url !== undefined || item.text !== '', {
        error: 'A vacancy needs a link or its text',
    })
    .meta({
        id: 'VacancyIntakeItem',
    })
export type VacancyIntakeItem = z.output<typeof vacancyIntakeItemSchema>

export const vacancyIntakeSchema = z
    .strictObject({
        items: z.array(vacancyIntakeItemSchema).min(1).max(INTAKE_MAX_ITEMS),
    })
    .meta({
        id: 'VacancyIntake',
    })
export type VacancyIntake = z.output<typeof vacancyIntakeSchema>

export const intakeResults = [
    'created',
    'existing',
] as const

export const vacancyIntakeResultSchema = z
    .object({
        created: z.number().int(),
        existing: z.number().int(),
        /** One per input item, in input order. */
        items: z.array(
            z.object({
                applicationId: z.uuid(),
                vacancyId: z.uuid(),
                result: z.enum(intakeResults),
            }),
        ),
    })
    .meta({
        id: 'VacancyIntakeResult',
    })
export type VacancyIntakeResult = z.infer<typeof vacancyIntakeResultSchema>

export const vacancyParseQueuedSchema = z
    .object({
        vacancyId: z.uuid(),
        parseStatus: z.literal('pending'),
    })
    .meta({
        id: 'VacancyParseQueued',
    })
export type VacancyParseQueued = z.infer<typeof vacancyParseQueuedSchema>

export const vacancyFetchQueuedSchema = z
    .object({
        vacancyId: z.uuid(),
        fetchStatus: z.literal('pending'),
    })
    .meta({
        id: 'VacancyFetchQueued',
    })
export type VacancyFetchQueued = z.infer<typeof vacancyFetchQueuedSchema>
