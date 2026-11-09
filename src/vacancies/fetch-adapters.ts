import { z } from 'zod'
import { type ApplyField, type ApplyFieldType, type ApplyForm, type ApplyFormSource, applyForm } from './apply-form.js'
import { decodeEntities, formFields, htmlToText, jsonLdJobPosting, pageText, postingText } from './fetch-html.js'
import { FetchError } from './fetch-http.js'

/** What a reader got from a vacancy link. */
export type FetchedVacancy = {
    source: ApplyFormSource
    /** The vacancy as plain text; empty when the page gave none. */
    text: string
    /** Null when the source has no form to read (a page without an apply form). */
    form: ApplyForm | null
}

const optionalText = z.string().nullish()

const parse = <T>(schema: z.ZodType<T>, data: unknown): T => {
    const result = schema.safeParse(data)
    if (!result.success) throw new FetchError('bad_response', false)
    return result.data
}

const isYesNo = (options: string[]) =>
    options.length === 2
    && options.some(option => /^yes$/i.test(option.trim()))
    && options.some(option => /^no$/i.test(option.trim()))

// Greenhouse: GET boards-api.greenhouse.io/v1/boards/<board>/jobs/<id>?questions=true

const greenhouseQuestion = z.looseObject({
    label: optionalText,
    required: z.boolean().nullish(),
    fields: z
        .array(
            z.looseObject({
                name: z.string(),
                type: z.string(),
                values: z
                    .array(
                        z.looseObject({
                            label: z.unknown(),
                        }),
                    )
                    .nullish(),
            }),
        )
        .nullish(),
})

const greenhouseJobSchema = z.looseObject({
    title: optionalText,
    company_name: optionalText,
    location: z
        .looseObject({
            name: optionalText,
        })
        .nullish(),
    /** HTML with its markup escaped once more: `&lt;p&gt;`. */
    content: optionalText,
    questions: z.array(greenhouseQuestion).nullish(),
    location_questions: z.array(greenhouseQuestion).nullish(),
})

const GREENHOUSE_TYPES: Record<string, ApplyFieldType> = {
    input_text: 'text',
    textarea: 'textarea',
    input_file: 'file',
    multi_value_single_select: 'select',
    multi_value_multi_select: 'multiselect',
}

function greenhouseField(question: z.infer<typeof greenhouseQuestion>): ApplyField | undefined {
    const fields = (question.fields ?? []).filter(field => field.type !== 'input_hidden')
    // A file question also offers a text box to paste into: the file is the field.
    const field = fields.find(item => item.type === 'input_file') ?? fields[0]
    if (!field) return undefined
    const options = (field.values ?? []).map(value => String(value.label ?? '')).filter(Boolean)
    const type = GREENHOUSE_TYPES[field.type] ?? 'other'
    return {
        key: field.name,
        label: question.label ?? field.name,
        type: type === 'select' && isYesNo(options) ? 'boolean' : type,
        required: question.required === true,
        ...(options.length > 0
            ? {
                  options,
              }
            : {}),
    }
}

export function greenhouseVacancy(data: unknown): FetchedVacancy {
    const job = parse(greenhouseJobSchema, data)
    const description = htmlToText(decodeEntities(job.content ?? ''))
    const questions = [
        ...(job.questions ?? []),
        ...(job.location_questions ?? []),
    ]
    return {
        source: 'greenhouse',
        text: postingText({
            title: job.title ?? '',
            company: job.company_name ?? '',
            location: job.location?.name ?? '',
            description,
        }),
        form: applyForm(
            'greenhouse',
            questions.map(greenhouseField).filter(field => field !== undefined),
        ),
    }
}

/** The Greenhouse board a company's careers page embeds, for a `gh_jid` link. */
export function greenhouseBoardOf(html: string): string | undefined {
    const byParam = /greenhouse\.io\/embed\/[a-z_/]+\?(?:[^"'\s<>]*?&(?:amp;)?)?for=([A-Za-z0-9_-]+)/i.exec(html)?.[1]
    if (byParam) return byParam
    const byPath = /(?:job-)?boards(?:-api)?\.greenhouse\.io\/(?:v1\/boards\/)?([A-Za-z0-9_-]+)/gi
    for (const match of html.matchAll(byPath)) if (match[1] && match[1].toLowerCase() !== 'embed') return match[1]
    return undefined
}

// Lever: GET api.lever.co/v0/postings/<company>/<id>; the form from jobs.lever.co/<company>/<id>/apply

const leverPostingSchema = z.looseObject({
    text: optionalText,
    categories: z
        .looseObject({
            location: optionalText,
            commitment: optionalText,
            team: optionalText,
        })
        .nullish(),
    description: optionalText,
    descriptionPlain: optionalText,
    lists: z
        .array(
            z.looseObject({
                text: optionalText,
                content: optionalText,
            }),
        )
        .nullish(),
    additional: optionalText,
    additionalPlain: optionalText,
})

export function leverText(data: unknown, company: string): string {
    const posting = parse(leverPostingSchema, data)
    const parts = [
        posting.descriptionPlain?.trim() || htmlToText(posting.description ?? ''),
        ...(posting.lists ?? []).map(list =>
            [
                list.text?.trim() ?? '',
                htmlToText(`<ul>${list.content ?? ''}</ul>`),
            ]
                .filter(Boolean)
                .join('\n'),
        ),
        posting.additionalPlain?.trim() || htmlToText(posting.additional ?? ''),
    ].filter(Boolean)
    return postingText({
        title: posting.text ?? '',
        company,
        location: [
            posting.categories?.location,
            posting.categories?.commitment,
        ]
            .filter(Boolean)
            .join(', '),
        description: parts.join('\n\n'),
    })
}

export const leverForm = (html: string): ApplyForm => applyForm('lever', formFields(html))

// Ashby: GET api.ashbyhq.com/posting-api/job-board/<org>?includeCompensation=true

const ashbyBoardSchema = z.looseObject({
    jobs: z.array(
        z.looseObject({
            id: z.string(),
            title: optionalText,
            location: optionalText,
            employmentType: optionalText,
            descriptionPlain: optionalText,
            descriptionHtml: optionalText,
            compensation: z
                .looseObject({
                    compensationTierSummary: optionalText,
                })
                .nullish(),
        }),
    ),
})

/** The job of the board; its public API has no application form, so the form has no fields. */
export function ashbyVacancy(data: unknown, org: string, jobId: string): FetchedVacancy {
    const board = parse(ashbyBoardSchema, data)
    const job = board.jobs.find(item => item.id.toLowerCase() === jobId.toLowerCase())
    if (!job) throw new FetchError('not_found', false)
    const description = job.descriptionPlain?.trim() || htmlToText(job.descriptionHtml ?? '')
    const pay = job.compensation?.compensationTierSummary?.trim()
    return {
        source: 'ashby',
        text: postingText({
            title: job.title ?? '',
            company: org,
            location: [
                job.location,
                job.employmentType,
            ]
                .filter(Boolean)
                .join(', '),
            description: pay ? `${description}\n\nCompensation: ${pay}` : description,
        }),
        form: applyForm('ashby', []),
    }
}

// Workable: GET apply.workable.com/api/v2/accounts/<account>/jobs/<shortcode> and …/form

const workableJobSchema = z.looseObject({
    title: optionalText,
    location: z
        .looseObject({
            city: optionalText,
            region: optionalText,
            country: optionalText,
        })
        .nullish(),
    workplace: optionalText,
    description: optionalText,
    requirements: optionalText,
    benefits: optionalText,
})

export function workableText(data: unknown, account: string): string {
    const job = parse(workableJobSchema, data)
    const sections = [
        htmlToText(job.description ?? ''),
        job.requirements ? `Requirements\n${htmlToText(job.requirements)}` : '',
        job.benefits ? `Benefits\n${htmlToText(job.benefits)}` : '',
    ].filter(Boolean)
    return postingText({
        title: job.title ?? '',
        company: account,
        location: [
            job.location?.city,
            job.location?.region,
            job.location?.country,
            job.workplace,
        ]
            .filter(Boolean)
            .join(', '),
        description: sections.join('\n\n'),
    })
}

const workableChoice = z.looseObject({
    body: optionalText,
    label: optionalText,
    name: optionalText,
})

const workableFieldSchema = z.looseObject({
    id: z.union([
        z.string(),
        z.number(),
    ]),
    label: optionalText,
    type: optionalText,
    required: z.boolean().nullish(),
    /** A question with choices answered with one (true) or several. */
    singleAnswer: z.boolean().nullish(),
    choices: z.array(workableChoice).nullish(),
    options: z.array(workableChoice).nullish(),
})

const workableSections = z.array(
    z.looseObject({
        fields: z.array(workableFieldSchema),
    }),
)

/** Sections of fields, as a list or under `sections`, or the fields alone. */
const workableFormSchema = z.union([
    workableSections,
    z
        .looseObject({
            sections: workableSections,
        })
        .transform(form => form.sections),
    z
        .looseObject({
            fields: z.array(workableFieldSchema),
        })
        .transform(form => [
            form,
        ]),
])

const WORKABLE_TYPES: Record<string, ApplyFieldType> = {
    text: 'text',
    string: 'text',
    short_text: 'text',
    email: 'text',
    phone: 'text',
    date: 'text',
    number: 'text',
    url: 'text',
    paragraph: 'textarea',
    free_text: 'textarea',
    long_text: 'textarea',
    textarea: 'textarea',
    dropdown: 'select',
    select: 'select',
    radio: 'select',
    multiple: 'multiselect',
    checkbox: 'multiselect',
    boolean: 'boolean',
    yes_no: 'boolean',
    file: 'file',
    resume: 'file',
    avatar: 'file',
}

function workableField(field: z.infer<typeof workableFieldSchema>): ApplyField {
    const options = [
        ...(field.choices ?? []),
        ...(field.options ?? []),
    ]
        .map(choice => choice.body ?? choice.label ?? choice.name ?? '')
        .filter(Boolean)
    const raw = (field.type ?? '').toLowerCase()
    const mapped =
        raw === 'multiple_choice' ? (field.singleAnswer === false ? 'multiselect' : 'select') : WORKABLE_TYPES[raw]
    const key = String(field.id)
    return {
        key,
        label: field.label ?? key,
        type: mapped ?? 'other',
        required: field.required === true,
        ...(options.length > 0
            ? {
                  options,
              }
            : mapped === 'boolean'
              ? {
                    options: [
                        'Yes',
                        'No',
                    ],
                }
              : {}),
    }
}

export function workableForm(data: unknown): ApplyForm {
    const fields = parse(workableFormSchema, data).flatMap(section => section.fields)
    return applyForm('workable', fields.map(workableField))
}

// Any other page

/** A page's own apply form only when it takes a file (a CV): search and newsletter forms are not. */
function pageForm(html: string): ApplyForm | null {
    for (const [form] of html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form\s*>/gi)) {
        const fields = formFields(form)
        if (fields.some(field => field.type === 'file')) return applyForm('page', fields)
    }
    return null
}

/** A vacancy page: its JSON-LD `JobPosting` when it has one, else the readable text of its main content. */
export function pageVacancy(html: string): FetchedVacancy {
    const posting = jsonLdJobPosting(html)
    return {
        source: 'page',
        text: posting ? postingText(posting) : pageText(html),
        form: pageForm(html),
    }
}
