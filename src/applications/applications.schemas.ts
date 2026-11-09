import { z } from 'zod'
import { applicationStatuses, cvStatuses, vacancyParseStatuses } from '../db/schema.js'
import { parsedVacancySchema } from '../vacancies/parse.schemas.js'

/** The API contract of `applications`; OpenAPI is generated from these schemas. */
export const applicationSchema = z
    .object({
        id: z.uuid(),
        company: z.string(),
        role: z.string(),
        vacancyUrl: z.string().nullable(),
        vacancyText: z.string(),
        status: z.enum(applicationStatuses),
        /** The shared vacancy behind it; null for one created by hand (POST /applications). */
        vacancyId: z.uuid().nullable(),
        /** The vacancy's parsing; null without a vacancy. */
        parseStatus: z.enum(vacancyParseStatuses).nullable(),
        /** The status of its newest CV version; `none` before the first. */
        cvStatus: z.enum([
            'none',
            ...cvStatuses,
        ]),
        createdAt: z.iso.datetime(),
    })
    .meta({
        id: 'Application',
    })
export type Application = z.infer<typeof applicationSchema>

/** The vacancy behind an application, for its page: the pasted text and what the model read from it. */
export const applicationVacancySchema = z
    .object({
        id: z.uuid(),
        url: z.string().nullable(),
        rawText: z.string(),
        parseStatus: z.enum(vacancyParseStatuses),
        parseError: z.string().nullable(),
        updatedAt: z.iso.datetime(),
        /** The model that parsed it (`parsed._meta.model`); null before a parse. */
        model: z.string().nullable(),
        /** `vacancies.parsed` without `_meta`; null until parsed. */
        parsed: parsedVacancySchema
            .meta({
                id: 'ParsedVacancy',
            })
            .nullable(),
    })
    .meta({
        id: 'ApplicationVacancy',
    })
export type ApplicationVacancy = z.infer<typeof applicationVacancySchema>

/**
 * The CV of an application: its newest version's status, and the link once a
 * version is ready (it serves the newest ready one, so it stays while a newer
 * one is made).
 */
export const applicationCvSchema = z
    .object({
        status: z.enum([
            'none',
            ...cvStatuses,
        ]),
        /** The newest version: 1, 2, … */
        version: z.number().int().min(1).optional(),
        /** `https://cv.<domain>/<application id>/<file name>`, once a version is ready. */
        url: z.string().optional(),
        /** Pages of the version the link serves. */
        pages: z.number().int().min(1).optional(),
        /** The model that generates or generated the newest version. */
        model: z.string().optional(),
        /** A short code when the newest version failed: `llm_bad_request`, `cv_does_not_fit`, … */
        error: z.string().optional(),
        updatedAt: z.iso.datetime().optional(),
    })
    .meta({
        id: 'ApplicationCv',
    })
export type ApplicationCv = z.infer<typeof applicationCvSchema>

/** One application with its vacancy and CV (GET /applications/:id); the list stays light. */
export const applicationDetailSchema = applicationSchema
    .extend({
        /** Null for one created by hand. */
        vacancy: applicationVacancySchema.nullable(),
        cv: applicationCvSchema,
    })
    .meta({
        id: 'ApplicationDetail',
    })
export type ApplicationDetail = z.infer<typeof applicationDetailSchema>

// Strict: an unknown or misspelled field is a client error, not silently dropped.
export const createApplicationSchema = z
    .strictObject({
        company: z.string().trim().min(1).max(200),
        role: z.string().trim().max(200).default(''),
        vacancyUrl: z
            .url({
                protocol: /^https?$/,
            })
            .max(2048)
            .optional(),
        vacancyText: z.string().max(50_000).default(''),
    })
    .meta({
        id: 'CreateApplication',
    })
export type CreateApplication = z.output<typeof createApplicationSchema>

export const listApplicationsQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    /** Opaque: `nextCursor` of the previous page. */
    cursor: z.string().min(1).max(256).optional(),
})
export type ListApplicationsQuery = z.output<typeof listApplicationsQuerySchema>

export const applicationListSchema = z
    .object({
        items: z.array(applicationSchema),
        nextCursor: z.string().nullable(),
    })
    .meta({
        id: 'ApplicationList',
    })
export type ApplicationList = z.infer<typeof applicationListSchema>

/** What a cursor carries: the keyset position of the last item of a page. */
export const applicationsCursorSchema = z.object({
    createdAt: z.iso.datetime(),
    id: z.uuid(),
})
