import { sql } from 'drizzle-orm'
import {
    boolean,
    check,
    index,
    integer,
    jsonb,
    pgTable,
    text,
    timestamp,
    unique,
    uniqueIndex,
    uuid,
} from 'drizzle-orm/pg-core'
import type { ProfileDocument } from '../profile/profile.schemas.js'

/** Millisecond precision, so an ISO string from JSON round-trips exactly (cursors). */
const at = (name: string) =>
    timestamp(name, {
        withTimezone: true,
        precision: 3,
    })

/** Where an application is: set by hand until the pipeline and the mail parsing move it. */
export const applicationStatuses = [
    'new',
    'sent',
    'interview',
    'offer',
    'rejected',
] as const

/** Where the parsing of a vacancy is: every row starts `pending` until a model reads it. */
export const vacancyParseStatuses = [
    'pending',
    'parsed',
    'failed',
] as const

/**
 * A vacancy as pasted (src/vacancies): one shared row per vacancy, found again
 * by its normalized link (`url_key`), so every person who adds it points at the
 * same row. Title, company and `parsed` are filled by parsing later.
 */
export const vacancies = pgTable(
    'vacancies',
    {
        id: uuid('id').primaryKey().default(sql`uuidv7()`),
        /** The link as first given; null for a vacancy pasted as text only. */
        url: text('url'),
        /** `vacancyUrlKey(url)`: the same vacancy behind tracking params, `www.` or a trailing slash. */
        urlKey: text('url_key'),
        rawText: text('raw_text').notNull().default(''),
        title: text('title').notNull().default(''),
        company: text('company').notNull().default(''),
        parseStatus: text('parse_status', {
            enum: vacancyParseStatuses,
        })
            .notNull()
            .default('pending'),
        parsed: jsonb('parsed').$type<unknown>(),
        parseError: text('parse_error'),
        /** The person (`sub`) who added it first. */
        createdBy: uuid('created_by').notNull(),
        createdAt: at('created_at').notNull().defaultNow(),
        updatedAt: at('updated_at').notNull().defaultNow(),
    },
    t => [
        unique('vacancies_url_key_key').on(t.urlKey),
        check('vacancies_url_with_key', sql`(${t.url} is null) = (${t.urlKey} is null)`),
        check('vacancies_url_length', sql`char_length(${t.url}) <= 2048`),
        check('vacancies_raw_text_length', sql`char_length(${t.rawText}) <= 100000`),
        check('vacancies_title_length', sql`char_length(${t.title}) <= 200`),
        check('vacancies_company_length', sql`char_length(${t.company}) <= 200`),
        check('vacancies_parse_status', sql`${t.parseStatus} in ('pending', 'parsed', 'failed')`),
        check('vacancies_parse_error_length', sql`char_length(${t.parseError}) <= 2000`),
    ],
)

/**
 * A vacancy in the pool of a person and what was sent to it (src/applications). The skeleton of
 * Tailor: the CV, the letter and the pipeline steps come with the logic.
 */
export const applications = pgTable(
    'applications',
    {
        // PostgreSQL 18 built-in: time-ordered ids, index-friendly.
        id: uuid('id').primaryKey().default(sql`uuidv7()`),
        /** The person (`sub` of the access token). Null only on the demo rows of 0001, which nobody lists. */
        userId: uuid('user_id'),
        /** The shared vacancy row; null on rows created before the intake (POST /applications, the demo rows). */
        vacancyId: uuid('vacancy_id').references(() => vacancies.id, {
            onDelete: 'restrict',
        }),
        /** Empty until the vacancy is parsed. */
        company: text('company').notNull(),
        role: text('role').notNull().default(''),
        vacancyUrl: text('vacancy_url'),
        vacancyText: text('vacancy_text').notNull().default(''),
        status: text('status', {
            enum: applicationStatuses,
        })
            .notNull()
            .default('new'),
        createdAt: at('created_at').notNull().defaultNow(),
    },
    t => [
        index('applications_created_at_id_idx').on(t.createdAt.desc(), t.id.desc()),
        index('applications_user_id_created_at_id_idx').on(t.userId, t.createdAt.desc(), t.id.desc()),
        uniqueIndex('applications_user_id_vacancy_id_key').on(t.userId, t.vacancyId),
        check('applications_company_length', sql`char_length(${t.company}) <= 200`),
        check('applications_role_length', sql`char_length(${t.role}) <= 200`),
        check('applications_vacancy_url_length', sql`char_length(${t.vacancyUrl}) <= 2048`),
        check('applications_vacancy_text_length', sql`char_length(${t.vacancyText}) <= 50000`),
        check('applications_status', sql`${t.status} in ('new', 'sent', 'interview', 'offer', 'rejected')`),
    ],
)

/** Where the generation of a CV version is: queued, then generating, then ready or failed. */
export const cvStatuses = [
    'queued',
    'generating',
    'ready',
    'failed',
] as const

/**
 * A CV of an application, tailored to its vacancy (src/cv-generation): versions
 * 1, 2, … per application, each generated once by the `cv.generate` job and
 * never changed after. The link `cv.<domain>/<application id>/<file name>`
 * serves the newest `ready` one.
 */
export const cvs = pgTable(
    'cvs',
    {
        id: uuid('id').primaryKey().default(sql`uuidv7()`),
        applicationId: uuid('application_id')
            .notNull()
            .references(() => applications.id, {
                onDelete: 'restrict',
            }),
        version: integer('version').notNull(),
        status: text('status', {
            enum: cvStatuses,
        })
            .notNull()
            .default('queued'),
        /** The PDF in R2 (`<R2_PREFIX>cv/<application id>/<cv id>.pdf`); null until ready. */
        fileKey: text('file_key'),
        /** `Nick-Lukashik-<Role>-CV.pdf`; null until ready. */
        fileName: text('file_name'),
        /** The vacancy title the CV is headed with. */
        role: text('role').notNull().default(''),
        /** The model of the pool that generates it, and its effort. */
        model: text('model'),
        effort: text('effort'),
        promptVersion: integer('prompt_version'),
        /** The profile version it was built from (profile_snapshots). */
        profileVersion: integer('profile_version'),
        pages: integer('pages'),
        /** D-115: the vacancy is an applied-AI, LLM or forward-deployed role, so AI-only parts are in. */
        aiRole: boolean('ai_role'),
        /** A short code when failed: `llm_bad_request`, `storage_not_configured`, … */
        error: text('error'),
        /** The analysis of the vacancy against the case bank, for debugging. */
        analysis: jsonb('analysis').$type<unknown>(),
        /** The CvDocument the PDF was built from, for debugging and regeneration. */
        document: jsonb('document').$type<unknown>(),
        createdAt: at('created_at').notNull().defaultNow(),
        updatedAt: at('updated_at').notNull().defaultNow(),
    },
    t => [
        unique('cvs_application_id_version_key').on(t.applicationId, t.version),
        check('cvs_version', sql`${t.version} >= 1`),
        check('cvs_status', sql`${t.status} in ('queued', 'generating', 'ready', 'failed')`),
        check('cvs_file_name_length', sql`char_length(${t.fileName}) <= 120`),
        check('cvs_file_key_length', sql`char_length(${t.fileKey}) <= 300`),
        check('cvs_role_length', sql`char_length(${t.role}) <= 200`),
        check('cvs_error_length', sql`char_length(${t.error}) <= 100`),
        check(
            'cvs_ready_file',
            sql`${t.status} <> 'ready' or (${t.fileKey} is not null and ${t.fileName} is not null)`,
        ),
    ],
)

/** A section of the profile document, typed by its Zod schema (src/profile/profile.schemas.ts). */
const section = <K extends keyof ProfileDocument>(name: string) => jsonb(name).$type<ProfileDocument[K]>().notNull()

/**
 * The profile of a person: one row per user, a jsonb column per section, so a
 * pipeline step reads only its own slice (D-93). Written whole by PUT /profile,
 * validated by the Zod schema of the document; every save bumps `version`.
 */
export const profiles = pgTable(
    'profiles',
    {
        userId: uuid('user_id').primaryKey(),
        version: integer('version').notNull(),
        person: section<'person'>('person'),
        career: section<'career'>('career'),
        employments: section<'employments'>('employments'),
        cases: section<'cases'>('cases'),
        skills: section<'skills'>('skills'),
        education: section<'education'>('education'),
        languages: section<'languages'>('languages'),
        summary: section<'summary'>('summary'),
        story: section<'story'>('story'),
        applicationFacts: section<'applicationFacts'>('application_facts'),
        answers: section<'answers'>('answers'),
        voice: section<'voice'>('voice'),
        settings: section<'settings'>('settings'),
        updatedAt: at('updated_at').notNull().defaultNow(),
    },
    t => [
        check('profiles_version', sql`${t.version} >= 1`),
    ],
)

/**
 * Every saved version of a profile, whole, with its hash: a CV or a text points
 * at the snapshot it was built from, so it can always be explained.
 */
export const profileSnapshots = pgTable(
    'profile_snapshots',
    {
        id: uuid('id').primaryKey().default(sql`uuidv7()`),
        userId: uuid('user_id').notNull(),
        version: integer('version').notNull(),
        document: jsonb('document').$type<ProfileDocument>().notNull(),
        /** SHA-256 of the document as canonical JSON (sorted keys), hex. */
        sha256: text('sha256').notNull(),
        createdAt: at('created_at').notNull().defaultNow(),
    },
    t => [
        unique('profile_snapshots_user_id_version_key').on(t.userId, t.version),
        check('profile_snapshots_version', sql`${t.version} >= 1`),
        check('profile_snapshots_sha256', sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
    ],
)
