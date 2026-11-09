import { Inject, Injectable } from '@nestjs/common'
import { and, eq, inArray, isNotNull, or, sql } from 'drizzle-orm'
import { DB } from '../common/database/database.js'
import { applications, vacancies } from '../db/schema.js'
import type { Db, Tx, VacancyRow } from '../db/types.js'
import type { ApplyForm } from './apply-form.js'

type PoolEntry = {
    applicationId: string
    created: boolean
}

/** SQL of the vacancies module: the shared vacancy rows and the caller's pool entries for them. */
@Injectable()
export class VacanciesRepository {
    constructor(@Inject(DB) private readonly db: Db) {}

    /**
     * The vacancy behind `urlKey`, created when there is none. A found one with
     * an empty raw text takes `rawText` and is `pending` again; one that has a
     * text keeps it.
     */
    async findOrCreateByUrl(
        tx: Tx,
        input: {
            url: string
            urlKey: string
            rawText: string
            createdBy: string
        },
    ): Promise<{
        vacancy: VacancyRow
        /** Created, or its empty text filled: there is something new to parse. */
        changed: boolean
    }> {
        const [created] = await tx
            .insert(vacancies)
            .values(input)
            .onConflictDoNothing({
                target: vacancies.urlKey,
            })
            .returning()
        if (created)
            return {
                vacancy: created,
                changed: true,
            }
        const [found] = await tx.select().from(vacancies).where(eq(vacancies.urlKey, input.urlKey)).limit(1)
        if (!found) throw new Error('vacancy conflicted on url_key but was not found')
        if (found.rawText !== '' || input.rawText === '')
            return {
                vacancy: found,
                changed: false,
            }
        const [filled] = await tx
            .update(vacancies)
            .set({
                rawText: input.rawText,
                // A text to parse again, e.g. after `no_text`.
                parseStatus: 'pending',
                parseError: null,
                updatedAt: sql`now()`,
            })
            .where(and(eq(vacancies.id, found.id), eq(vacancies.rawText, '')))
            .returning()
        return {
            vacancy: filled ?? found,
            changed: filled !== undefined,
        }
    }

    /** Whether the person has an application for the vacancy (their pool). */
    async inPool(tx: Tx, userId: string, vacancyId: string): Promise<boolean> {
        return (
            (await tx.$count(applications, and(eq(applications.userId, userId), eq(applications.vacancyId, vacancyId))))
            > 0
        )
    }

    /** Back to `pending` before a parse is queued again. */
    async markPending(tx: Tx, id: string) {
        await tx
            .update(vacancies)
            .set({
                parseStatus: 'pending',
                parseError: null,
                updatedAt: sql`now()`,
            })
            .where(eq(vacancies.id, id))
    }

    /**
     * Locks the vacancies before their parse is queued. Every path that queues
     * one (intake, re-parse, a move to another model) holds this row lock, so
     * two of them never decide the queue of one vacancy at the same time.
     */
    async lockForParse(tx: Tx, ids: string[]) {
        if (ids.length === 0) return
        await tx
            .select({
                id: vacancies.id,
            })
            .from(vacancies)
            .where(inArray(vacancies.id, ids))
            .orderBy(vacancies.id)
            .for('update')
    }

    async findById(id: string): Promise<VacancyRow | undefined> {
        const [row] = await this.db.select().from(vacancies).where(eq(vacancies.id, id)).limit(1)
        return row
    }

    async markFailed(id: string, code: string) {
        await this.db
            .update(vacancies)
            .set({
                parseStatus: 'failed',
                parseError: code,
                updatedAt: sql`now()`,
            })
            .where(eq(vacancies.id, id))
    }

    /**
     * The parse result, and in the caller's transaction the company and role
     * of every application on the vacancy that still has them empty.
     */
    async saveParsed(
        tx: Tx,
        id: string,
        result: {
            parsed: unknown
            title: string
            company: string
        },
    ) {
        const [row] = await tx
            .update(vacancies)
            .set({
                parsed: result.parsed,
                title: result.title,
                company: result.company,
                parseStatus: 'parsed',
                parseError: null,
                updatedAt: sql`now()`,
            })
            .where(eq(vacancies.id, id))
            .returning({
                id: vacancies.id,
            })
        const empty = [
            ...(result.company
                ? [
                      eq(applications.company, ''),
                  ]
                : []),
            ...(result.title
                ? [
                      eq(applications.role, ''),
                  ]
                : []),
        ]
        if (!row || empty.length === 0) return
        await tx
            .update(applications)
            .set({
                company: sql`case when ${applications.company} = '' then ${result.company} else ${applications.company} end`,
                role: sql`case when ${applications.role} = '' then ${result.title} else ${applications.role} end`,
            })
            .where(and(eq(applications.vacancyId, id), or(...empty)))
    }

    /** The vacancies with a link back to `pending` before their fetch is queued; the ids of those that have one. */
    async markFetchPending(tx: Tx, ids: string[]): Promise<string[]> {
        if (ids.length === 0) return []
        const rows = await tx
            .update(vacancies)
            .set({
                fetchStatus: 'pending',
                fetchError: null,
                updatedAt: sql`now()`,
            })
            .where(and(inArray(vacancies.id, ids), isNotNull(vacancies.url)))
            .returning({
                id: vacancies.id,
            })
        return rows.map(row => row.id)
    }

    /**
     * What the fetch got, in the caller's transaction. A text fills only an
     * empty raw text (the person's own is kept) and makes the vacancy `pending`
     * to parse; the form replaces the stored one unless it is left undefined
     * (a failure keeps the last one). The parse status after the write.
     */
    async saveFetch(
        tx: Tx,
        id: string,
        result: {
            status: 'fetched' | 'failed' | 'skipped'
            error: string | null
            text: string
            form?: ApplyForm | null
        },
    ): Promise<VacancyRow['parseStatus'] | undefined> {
        const empty = sql`${vacancies.rawText} = ''`
        const [row] = await tx
            .update(vacancies)
            .set({
                fetchStatus: result.status,
                fetchError: result.error,
                ...(result.form !== undefined
                    ? {
                          applyForm: result.form,
                      }
                    : {}),
                ...(result.text
                    ? {
                          rawText: sql`case when ${empty} then ${result.text} else ${vacancies.rawText} end`,
                          parseStatus: sql`case when ${empty} then 'pending' else ${vacancies.parseStatus} end`,
                          parseError: sql`case when ${empty} then null else ${vacancies.parseError} end`,
                      }
                    : {}),
                updatedAt: sql`now()`,
            })
            .where(eq(vacancies.id, id))
            .returning({
                parseStatus: vacancies.parseStatus,
            })
        return row?.parseStatus
    }

    /** The link of a vacancy, null without one; undefined when there is no such vacancy. */
    async urlOf(tx: Tx, id: string): Promise<string | null | undefined> {
        const [row] = await tx
            .select({
                url: vacancies.url,
            })
            .from(vacancies)
            .where(eq(vacancies.id, id))
            .limit(1)
        return row?.url
    }

    /** A vacancy pasted as text only: nothing to find it by, so always a new row. */
    async insertText(tx: Tx, rawText: string, createdBy: string): Promise<VacancyRow> {
        const [row] = await tx
            .insert(vacancies)
            .values({
                rawText,
                createdBy,
            })
            .returning()
        if (!row) throw new Error('insert into vacancies returned no row')
        return row
    }

    /** The person's application for the vacancy, created (status `new`) when they have none. */
    async addToPool(tx: Tx, userId: string, vacancy: VacancyRow, vacancyUrl: string | null): Promise<PoolEntry> {
        const [created] = await tx
            .insert(applications)
            .values({
                userId,
                vacancyId: vacancy.id,
                company: vacancy.company,
                role: vacancy.title,
                vacancyUrl,
                vacancyText: '',
                status: 'new',
            })
            .onConflictDoNothing({
                target: [
                    applications.userId,
                    applications.vacancyId,
                ],
            })
            .returning({
                id: applications.id,
            })
        if (created)
            return {
                applicationId: created.id,
                created: true,
            }
        const [found] = await tx
            .select({
                id: applications.id,
            })
            .from(applications)
            .where(and(eq(applications.userId, userId), eq(applications.vacancyId, vacancy.id)))
            .limit(1)
        if (!found) throw new Error('application conflicted on (user_id, vacancy_id) but was not found')
        return {
            applicationId: found.id,
            created: false,
        }
    }
}
