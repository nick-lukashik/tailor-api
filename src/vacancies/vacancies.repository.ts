import { Injectable } from '@nestjs/common'
import { and, eq, sql } from 'drizzle-orm'
import { applications, vacancies } from '../db/schema.js'
import type { Tx, VacancyRow } from '../db/types.js'

type PoolEntry = {
    applicationId: string
    created: boolean
}

/** SQL of the vacancies module: the shared vacancy rows and the caller's pool entries for them. */
@Injectable()
export class VacanciesRepository {
    /**
     * The vacancy behind `urlKey`, created when there is none. A found one with
     * an empty raw text takes `rawText`; one that has a text keeps it.
     */
    async findOrCreateByUrl(
        tx: Tx,
        input: {
            url: string
            urlKey: string
            rawText: string
            createdBy: string
        },
    ): Promise<VacancyRow> {
        const [created] = await tx
            .insert(vacancies)
            .values(input)
            .onConflictDoNothing({
                target: vacancies.urlKey,
            })
            .returning()
        if (created) return created
        const [found] = await tx.select().from(vacancies).where(eq(vacancies.urlKey, input.urlKey)).limit(1)
        if (!found) throw new Error('vacancy conflicted on url_key but was not found')
        if (found.rawText !== '' || input.rawText === '') return found
        const [filled] = await tx
            .update(vacancies)
            .set({
                rawText: input.rawText,
                updatedAt: sql`now()`,
            })
            .where(and(eq(vacancies.id, found.id), eq(vacancies.rawText, '')))
            .returning()
        return filled ?? found
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
