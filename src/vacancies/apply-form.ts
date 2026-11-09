import { z } from 'zod'

/** Where the questions of an apply form came from: an ATS API or the vacancy page itself. */
export const applyFormSources = [
    'greenhouse',
    'lever',
    'ashby',
    'workable',
    'page',
] as const
export type ApplyFormSource = (typeof applyFormSources)[number]

export const applyFieldTypes = [
    'text',
    'textarea',
    'select',
    'multiselect',
    'boolean',
    'file',
    'other',
] as const
export type ApplyFieldType = (typeof applyFieldTypes)[number]

export const applyFieldSchema = z
    .object({
        /** The field's name in the form, unique within it: `first_name`, `question_123`. */
        key: z.string().min(1).max(300),
        label: z.string().max(2000),
        type: z.enum(applyFieldTypes),
        required: z.boolean(),
        /** The choices of a select, multiselect or boolean, as the form words them. */
        options: z.array(z.string().max(500)).max(200).optional(),
    })
    .meta({
        id: 'ApplyField',
    })
export type ApplyField = z.infer<typeof applyFieldSchema>

/** The apply form of a vacancy (`vacancies.apply_form`): the questions a person answers when applying. */
export const applyFormSchema = z
    .object({
        source: z.enum(applyFormSources),
        fields: z.array(applyFieldSchema).max(300),
    })
    .meta({
        id: 'ApplyForm',
    })
export type ApplyForm = z.infer<typeof applyFormSchema>

/** At most this many fields are kept, the first ones. */
export const APPLY_FORM_MAX_FIELDS = 300

/** A clean form: trimmed labels and options, unique keys (the first wins), at most 300 fields. */
export function applyForm(source: ApplyFormSource, fields: ApplyField[]): ApplyForm {
    const seen = new Set<string>()
    const kept: ApplyField[] = []
    for (const field of fields) {
        const key = field.key.trim().slice(0, 300)
        if (!key || seen.has(key)) continue
        seen.add(key)
        const options = field.options
            ?.map(option => option.replace(/\s+/g, ' ').trim().slice(0, 500))
            .filter(Boolean)
            .slice(0, 200)
        kept.push({
            key,
            label: field.label.replace(/\s+/g, ' ').trim().slice(0, 2000),
            type: field.type,
            required: field.required,
            ...(options && options.length > 0
                ? {
                      options,
                  }
                : {}),
        })
        if (kept.length >= APPLY_FORM_MAX_FIELDS) break
    }
    return {
        source,
        fields: kept,
    }
}
