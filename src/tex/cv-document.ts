import { z } from 'zod'

/**
 * The request body of tailor-tex: the CV as data for its "Minimal violet"
 * template. A copy of `cvDocumentSchema` in tailor-tex `src/cv/cv.schemas.ts`
 * (keep them equal), so a document is checked here before a build. Bullet and
 * summary text may hold `**…**` spans, printed highlighted; tailor-tex escapes
 * everything else, so callers never send LaTeX.
 */
export const cvDocumentSchema = z
    .strictObject({
        name: z.string().min(1).max(120),
        location: z.string().max(120),
        phoneDisplay: z.string().max(40),
        /** Empty together with `phoneDisplay` when the CV shows no phone. */
        phoneDigits: z.string().regex(/^(\+?\d{6,20})?$/, {
            error: 'empty, or digits only, optional leading +, 6 to 20 digits',
        }),
        headline: z.string().min(1).max(120),
        stack: z.string().max(160),
        links: z
            .array(
                z.strictObject({
                    url: z.string().min(1).max(300),
                    text: z.string().min(1).max(120),
                }),
            )
            .max(8),
        summary: z.array(z.string().min(1).max(1200)).min(1).max(2),
        skills: z
            .array(
                z.strictObject({
                    label: z.string().min(1).max(60),
                    items: z.array(z.string().min(1).max(80)).min(1).max(40),
                }),
            )
            .min(1)
            .max(14),
        jobs: z
            .array(
                z.strictObject({
                    title: z.string().min(1).max(120),
                    company: z.string().min(1).max(120),
                    dates: z.string().min(1).max(60),
                    location: z.string().max(60),
                    description: z.string().max(200),
                    bullets: z
                        .array(
                            z.strictObject({
                                id: z.string().min(1).max(40),
                                text: z.string().min(1).max(700),
                            }),
                        )
                        .max(20),
                }),
            )
            .min(1)
            .max(10),
        education: z
            .array(
                z.strictObject({
                    degree: z.string().min(1).max(160),
                    school: z.string().min(1).max(160),
                    dates: z.string().max(60),
                }),
            )
            .max(4),
        languages: z
            .array(
                z.strictObject({
                    name: z.string().max(40),
                    level: z.string().max(80),
                }),
            )
            .max(6),
        pdf: z.strictObject({
            title: z.string().max(300),
            subject: z.string().max(500),
            keywords: z.array(z.string().max(80)).max(200),
        }),
    })
    .meta({
        id: 'TexCvDocument',
    })
export type CvDocument = z.infer<typeof cvDocumentSchema>

export const cvTemplates = [
    'minimal-violet',
] as const
export type CvTemplate = (typeof cvTemplates)[number]

/**
 * What tailor-tex `POST /api/v1/cv/measure` returns: a build without the PDF,
 * for the fitting loop. A copy of its `cvMeasurementSchema`; read loosely, so
 * a field it adds later does not break this side.
 */
export const cvMeasurementSchema = z.object({
    pages: z.int().min(0),
    /** Fill of each page's text area, 0 to 1. */
    fill: z.array(z.number().min(0).max(1)),
    sizeBytes: z.int().min(0),
    /** pages <= maxPages. */
    fits: z.boolean(),
    /** Widest overfull hbox in points; 0 when none. */
    overfullPt: z.number().min(0),
    fontsOk: z.boolean(),
    /** Printed lines of each block: `summary:<i>`, `skill:<i>`, `bullet:<bullet id>`; null when not found. */
    blocks: z.array(
        z.object({
            id: z.string(),
            lines: z.int().min(0).nullable(),
        }),
    ),
    warnings: z.array(z.string()),
})
export type CvMeasurement = z.infer<typeof cvMeasurementSchema>
