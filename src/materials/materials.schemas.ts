import { z } from 'zod'
import { materialsStatuses } from '../db/schema.js'

/*
 * What the model returns for an application's materials (sent to the gateway
 * as JSON Schema: every key required, no length limits, so the answer has one
 * shape; the code clips it and puts the CV link in, `materials.ts`). Change it
 * with the prompt in `materials.prompts.ts` and bump `MATERIALS_PROMPT_VERSION`.
 */
export const materialsAnswerSchema = z.strictObject({
    coverLetter: z.string(),
    emailSubject: z.string(),
    emailBody: z.string(),
    telegramMessage: z.string(),
    linkedinNote: z.string(),
    whyMe: z.array(z.string()),
    /** One per question of the apply form given to the model; empty without one. */
    answers: z.array(
        z.strictObject({
            key: z.string(),
            answer: z.string(),
        }),
    ),
})
export type MaterialsAnswer = z.infer<typeof materialsAnswerSchema>

export const materialsLanguages = [
    'en',
    'ru',
] as const
export type MaterialsLanguage = (typeof materialsLanguages)[number]

/** The texts as stored (`materials.content`) and shown, the CV link already in them. */
export const materialsContentSchema = z
    .object({
        /** English unless the vacancy is in Russian. */
        language: z.enum(materialsLanguages),
        /** 150–250 words, paragraphs separated by a blank line. */
        coverLetter: z.string(),
        emailSubject: z.string(),
        /** 80–140 words, with the CV link. */
        emailBody: z.string(),
        /** At most 600 characters, with the CV link. */
        telegramMessage: z.string(),
        /** A LinkedIn connection note, at most 300 characters. */
        linkedinNote: z.string(),
        /** Three short points matching the vacancy's top requirements. */
        whyMe: z.array(z.string()),
        /**
         * An answer to every question of the vacancy's apply form but the file
         * ones, in its order: the standard ones from the profile, the rest by
         * the model; empty when the facts do not answer it. Empty without a form.
         */
        answers: z
            .array(
                z.object({
                    key: z.string(),
                    label: z.string(),
                    answer: z.string(),
                }),
            )
            .default([]),
    })
    .meta({
        id: 'MaterialsContent',
    })
export type MaterialsContent = z.infer<typeof materialsContentSchema>

/**
 * The materials of an application: its newest version's status, and the texts
 * of the newest ready one (they stay while a newer one is written).
 */
export const applicationMaterialsSchema = z
    .object({
        status: z.enum([
            'none',
            ...materialsStatuses,
        ]),
        /** The newest version: 1, 2, … */
        version: z.number().int().min(1).optional(),
        content: materialsContentSchema.optional(),
        /** A short code when the newest version failed: `llm_bad_request`, `no_profile`, … */
        error: z.string().optional(),
        updatedAt: z.iso.datetime().optional(),
    })
    .meta({
        id: 'ApplicationMaterials',
    })
export type ApplicationMaterials = z.infer<typeof applicationMaterialsSchema>
