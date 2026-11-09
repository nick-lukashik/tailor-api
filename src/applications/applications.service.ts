import { Inject, Injectable } from '@nestjs/common'
import { z } from 'zod'
import { DB } from '../common/database/database.js'
import { notFound } from '../common/http/app-error.js'
import { cursorCodec } from '../common/http/cursor.js'
import type { Db } from '../db/types.js'
import { ApplicationsRepository, type ApplicationView } from './applications.repository.js'
import {
    type Application,
    type ApplicationList,
    applicationsCursorSchema,
    type CreateApplication,
    type ListApplicationsQuery,
} from './applications.schemas.js'

const cursor = cursorCodec(applicationsCursorSchema)
const uuid = z.uuid()

const toApplication = (row: ApplicationView): Application => ({
    id: row.id,
    company: row.company,
    role: row.role,
    vacancyUrl: row.vacancyUrl,
    vacancyText: row.vacancyText,
    status: row.status,
    vacancyId: row.vacancyId,
    parseStatus: row.parseStatus,
    createdAt: row.createdAt.toISOString(),
})

@Injectable()
export class ApplicationsService {
    constructor(
        @Inject(DB) private readonly db: Db,
        private readonly repository: ApplicationsRepository,
    ) {}

    /** A transaction even for one insert: follow-ups (an outbox event, a job) join it. */
    async create(userId: string, input: CreateApplication): Promise<Application> {
        const row = await this.db.transaction(tx => this.repository.insert(tx, userId, input))
        return toApplication(row)
    }

    /** The person's own. A malformed id, or someone else's application, is a 404 like any missing one. */
    async get(id: string, userId: string): Promise<Application> {
        const row = uuid.safeParse(id).success ? await this.repository.findOwned(id, userId) : undefined
        if (!row) throw notFound('Application')
        return toApplication(row)
    }

    /** Any application by its id, for the public CV link (an unguessable uuidv7). */
    async getForCv(id: string): Promise<Application> {
        const row = uuid.safeParse(id).success ? await this.repository.findById(id) : undefined
        if (!row) throw notFound('Application')
        return toApplication(row)
    }

    async list(userId: string, query: ListApplicationsQuery): Promise<ApplicationList> {
        const after = query.cursor ? cursor.decode(query.cursor) : undefined
        const rows = await this.repository.page(userId, query.limit, after)
        const items = rows.slice(0, query.limit).map(toApplication)
        const last = items.at(-1)
        return {
            items,
            nextCursor:
                rows.length > query.limit && last
                    ? cursor.encode({
                          createdAt: last.createdAt,
                          id: last.id,
                      })
                    : null,
        }
    }
}
