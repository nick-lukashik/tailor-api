import { Inject, Injectable } from '@nestjs/common'
import { z } from 'zod'
import { DB } from '../common/database/database.js'
import { notFound } from '../common/http/app-error.js'
import { cursorCodec } from '../common/http/cursor.js'
import type { ApplicationRow, Db } from '../db/types.js'
import { ApplicationsRepository } from './applications.repository.js'
import {
    type Application,
    type ApplicationList,
    applicationsCursorSchema,
    type CreateApplication,
    type ListApplicationsQuery,
} from './applications.schemas.js'

const cursor = cursorCodec(applicationsCursorSchema)
const uuid = z.uuid()

const toApplication = (row: ApplicationRow): Application => ({
    id: row.id,
    company: row.company,
    role: row.role,
    vacancyUrl: row.vacancyUrl,
    vacancyText: row.vacancyText,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
})

@Injectable()
export class ApplicationsService {
    constructor(
        @Inject(DB) private readonly db: Db,
        private readonly repository: ApplicationsRepository,
    ) {}

    /** A transaction even for one insert: follow-ups (an outbox event, a job) join it. */
    async create(input: CreateApplication): Promise<Application> {
        const row = await this.db.transaction(tx => this.repository.insert(tx, input))
        return toApplication(row)
    }

    /** A malformed id cannot exist: 404 like any other missing application. */
    async get(id: string): Promise<Application> {
        const row = uuid.safeParse(id).success ? await this.repository.findById(id) : undefined
        if (!row) throw notFound('Application')
        return toApplication(row)
    }

    async list(query: ListApplicationsQuery): Promise<ApplicationList> {
        const after = query.cursor ? cursor.decode(query.cursor) : undefined
        const rows = await this.repository.page(query.limit, after)
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
