import { Inject, Injectable } from '@nestjs/common'
import { and, desc, eq, getTableColumns, sql } from 'drizzle-orm'
import { DB } from '../common/database/database.js'
import { applications, vacancies } from '../db/schema.js'
import type { ApplicationRow, Db, Tx, VacancyRow } from '../db/types.js'
import type { CreateApplication } from './applications.schemas.js'

/** An application with the parse status of its vacancy (null without one). */
export type ApplicationView = ApplicationRow & {
    parseStatus: VacancyRow['parseStatus'] | null
}

/** SQL of the applications module; services never build queries themselves. */
@Injectable()
export class ApplicationsRepository {
    constructor(@Inject(DB) private readonly db: Db) {}

    private select() {
        return this.db
            .select({
                ...getTableColumns(applications),
                parseStatus: vacancies.parseStatus,
            })
            .from(applications)
            .leftJoin(vacancies, eq(vacancies.id, applications.vacancyId))
    }

    /** Created by hand: no vacancy behind it, so no parse status. */
    async insert(tx: Tx, userId: string, input: CreateApplication): Promise<ApplicationView> {
        const [row] = await tx
            .insert(applications)
            .values({
                ...input,
                userId,
            })
            .returning()
        if (!row) throw new Error('insert into applications returned no row')
        return {
            ...row,
            parseStatus: null,
        }
    }

    /** By id alone, whoever it belongs to: only for the public CV link. */
    async findById(id: string): Promise<ApplicationView | undefined> {
        const [row] = await this.select().where(eq(applications.id, id)).limit(1)
        return row
    }

    /** One of the person's own; someone else's is not found. */
    async findOwned(id: string, userId: string): Promise<ApplicationView | undefined> {
        const [row] = await this.select()
            .where(and(eq(applications.id, id), eq(applications.userId, userId)))
            .limit(1)
        return row
    }

    /** The person's own, newest first, keyset pagination; one extra row tells whether a next page exists. */
    page(
        userId: string,
        limit: number,
        after?: {
            createdAt: string
            id: string
        },
    ) {
        return this.select()
            .where(
                and(
                    eq(applications.userId, userId),
                    after
                        ? sql`(${applications.createdAt}, ${applications.id}) < (${after.createdAt}::timestamptz, ${after.id}::uuid)`
                        : undefined,
                ),
            )
            .orderBy(desc(applications.createdAt), desc(applications.id))
            .limit(limit + 1)
    }
}
