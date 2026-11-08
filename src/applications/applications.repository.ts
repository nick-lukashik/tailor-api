import { Inject, Injectable } from '@nestjs/common'
import { and, desc, eq, sql } from 'drizzle-orm'
import { DB } from '../common/database/database.js'
import { applications } from '../db/schema.js'
import type { ApplicationRow, Db, Tx } from '../db/types.js'
import type { CreateApplication } from './applications.schemas.js'

/** SQL of the applications module; services never build queries themselves. */
@Injectable()
export class ApplicationsRepository {
    constructor(@Inject(DB) private readonly db: Db) {}

    async insert(tx: Tx, userId: string, input: CreateApplication): Promise<ApplicationRow> {
        const [row] = await tx
            .insert(applications)
            .values({
                ...input,
                userId,
            })
            .returning()
        if (!row) throw new Error('insert into applications returned no row')
        return row
    }

    /** By id alone, whoever it belongs to: only for the public CV link. */
    async findById(id: string): Promise<ApplicationRow | undefined> {
        const [row] = await this.db.select().from(applications).where(eq(applications.id, id)).limit(1)
        return row
    }

    /** One of the person's own; someone else's is not found. */
    async findOwned(id: string, userId: string): Promise<ApplicationRow | undefined> {
        const [row] = await this.db
            .select()
            .from(applications)
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
        return this.db
            .select()
            .from(applications)
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
