import { Inject, Injectable } from '@nestjs/common'
import { eq, sql } from 'drizzle-orm'
import { DB } from '../common/database/database.js'
import { profileSnapshots, profiles } from '../db/schema.js'
import type { Db, ProfileRow, Tx } from '../db/types.js'
import type { ProfileDocument } from './profile.schemas.js'

/** SQL of the profile module. */
@Injectable()
export class ProfileRepository {
    constructor(@Inject(DB) private readonly db: Db) {}

    async find(userId: string): Promise<ProfileRow | undefined> {
        const [row] = await this.db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1)
        return row
    }

    /**
     * The whole document in place of the old one, version + 1 (1 for the first),
     * and its snapshot. The upsert locks the row, so two saves get two versions.
     */
    async save(tx: Tx, userId: string, document: ProfileDocument, sha256: string) {
        const [row] = await tx
            .insert(profiles)
            .values({
                userId,
                version: 1,
                ...document,
            })
            .onConflictDoUpdate({
                target: profiles.userId,
                set: {
                    ...document,
                    version: sql`${profiles.version} + 1`,
                    updatedAt: sql`now()`,
                },
            })
            .returning({
                version: profiles.version,
                updatedAt: profiles.updatedAt,
            })
        if (!row) throw new Error('upsert into profiles returned no row')
        await tx.insert(profileSnapshots).values({
            userId,
            version: row.version,
            document,
            sha256,
        })
        return row
    }
}
