import { z } from 'zod'
import { applicationStatuses, vacancyParseStatuses } from '../db/schema.js'

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
        createdAt: z.iso.datetime(),
    })
    .meta({
        id: 'Application',
    })
export type Application = z.infer<typeof applicationSchema>

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
