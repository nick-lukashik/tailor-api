import { Inject, Injectable } from '@nestjs/common'
import { DB } from '../common/database/database.js'
import { notFound } from '../common/http/app-error.js'
import type { Db, ProfileRow } from '../db/types.js'
import { documentHash } from './canonical-json.js'
import { ProfileRepository } from './profile.repository.js'
import {
    type Profile,
    type ProfileDocument,
    profileDocumentSchema,
    profileSections,
    type SavedProfile,
} from './profile.schemas.js'

/** The stored sections as one document; a field added to the schema since gets its default. */
function toDocument(row: ProfileRow): ProfileDocument {
    const stored = Object.fromEntries(
        profileSections.map(section => [
            section,
            row[section],
        ]),
    )
    const parsed = profileDocumentSchema.safeParse(stored)
    return parsed.success ? parsed.data : (stored as ProfileDocument)
}

@Injectable()
export class ProfileService {
    constructor(
        @Inject(DB) private readonly db: Db,
        private readonly repository: ProfileRepository,
    ) {}

    async get(userId: string): Promise<Profile> {
        const row = await this.repository.find(userId)
        if (!row) throw notFound('Profile')
        return {
            version: row.version,
            updatedAt: row.updatedAt.toISOString(),
            document: toDocument(row),
        }
    }

    /** `document` is already validated whole (the schema on the body). */
    async save(userId: string, document: ProfileDocument): Promise<SavedProfile> {
        const sha256 = documentHash(document)
        const row = await this.db.transaction(tx => this.repository.save(tx, userId, document, sha256))
        return {
            version: row.version,
            sha256,
            updatedAt: row.updatedAt.toISOString(),
        }
    }
}
