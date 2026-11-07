import { Inject, Injectable } from '@nestjs/common'
import { desc, eq, sql } from 'drizzle-orm'
import { DB } from '../common/database/database.js'
import { applications } from '../db/schema.js'
import type { ApplicationRow, Db, Tx } from '../db/types.js'
import type { CreateApplication } from './applications.schemas.js'

/** SQL of the applications module; services never build queries themselves. */
@Injectable()
export class ApplicationsRepository {
    constructor(@Inject(DB) private readonly db: Db) {}

    async insert(tx: Tx, input: CreateApplication): Promise<ApplicationRow> {
        const [row] = await tx.insert(applications).values(input).returning()
        if (!row) throw new Error('insert into applications returned no row')
        return row
    }

    async findById(id: string): Promise<ApplicationRow | undefined> {
        const [row] = await this.db.select().from(applications).where(eq(applications.id, id)).limit(1)
        return row
    }

    /** Newest first, keyset pagination; one extra row tells whether a next page exists. */
    page(
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
                after
                    ? sql`(${applications.createdAt}, ${applications.id}) < (${after.createdAt}::timestamptz, ${after.id}::uuid)`
                    : undefined,
            )
            .orderBy(desc(applications.createdAt), desc(applications.id))
            .limit(limit + 1)
    }
}
