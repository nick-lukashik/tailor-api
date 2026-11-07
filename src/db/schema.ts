import { sql } from 'drizzle-orm'
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

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

/**
 * A vacancy and what was sent to it (src/applications). The skeleton of
 * Tailor: the CV, the letter and the pipeline steps come with the logic.
 */
export const applications = pgTable(
    'applications',
    {
        // PostgreSQL 18 built-in: time-ordered ids, index-friendly.
        id: uuid('id').primaryKey().default(sql`uuidv7()`),
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
        check('applications_company_length', sql`char_length(${t.company}) between 1 and 200`),
        check('applications_role_length', sql`char_length(${t.role}) <= 200`),
        check('applications_vacancy_url_length', sql`char_length(${t.vacancyUrl}) <= 2048`),
        check('applications_vacancy_text_length', sql`char_length(${t.vacancyText}) <= 50000`),
        check('applications_status', sql`${t.status} in ('new', 'sent', 'interview', 'offer', 'rejected')`),
    ],
)
