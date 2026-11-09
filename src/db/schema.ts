import { sql } from 'drizzle-orm'
import { check, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
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
