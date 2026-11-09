import { z } from 'zod'

/**
 * What the model returns for a vacancy (`vacancies.parsed`, stored whole).
 * Sent to the gateway as JSON Schema: every key is required, unknown scalars
 * are null and unknown lists are empty, so the answer has one shape.
 */
const text = z.string()
const maybe = z.string().nullable()

export const remoteModes = [
    'remote',
    'hybrid',
    'onsite',
    'unknown',
] as const

export const employmentTypes = [
    'full-time',
    'part-time',
    'contract',
    'freelance',
    'internship',
    'temporary',
] as const

export const salaryPeriods = [
    'hour',
    'day',
    'week',
    'month',
    'year',
] as const

export const applyChannelKinds = [
    'form',
    'email',
    'telegram',
    'link',
    'other',
] as const

export const parsedVacancySchema = z.strictObject({
    title: maybe,
    company: maybe,
    companyDescription: maybe,
    /** Lowercase as stated: `junior`, `middle`, `senior`, `lead`, … */
    seniority: maybe,
    location: maybe,
    remote: z.enum(remoteModes),
    /** Countries, regions or time zones a candidate may work from, as stated. */
    regions: z.array(text),
    employmentType: z.enum(employmentTypes).nullable(),
    salary: z
        .strictObject({
            min: z.number().nullable(),
            max: z.number().nullable(),
            currency: maybe,
            period: z.enum(salaryPeriods).nullable(),
        })
        .nullable(),
    /** ISO 639-1 code of the language the posting is written in. */
    language: maybe,
    skills: z.array(
        z.strictObject({
            name: text,
            required: z.boolean(),
        }),
    ),
    requirements: z.array(text),
    responsibilities: z.array(text),
    niceToHave: z.array(text),
    applyChannels: z.array(
        z.strictObject({
            kind: z.enum(applyChannelKinds),
            value: text,
        }),
    ),
    summary: text,
    /** What was unclear or contradictory, instead of a guess. */
    warnings: z.array(text),
})

export type ParsedVacancy = z.output<typeof parsedVacancySchema>
