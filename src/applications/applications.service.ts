import { Inject, Injectable, Logger } from '@nestjs/common'
import { z } from 'zod'
import { DB } from '../common/database/database.js'
import { notFound } from '../common/http/app-error.js'
import { cursorCodec } from '../common/http/cursor.js'
import type { Db } from '../db/types.js'
import { parsedVacancySchema } from '../vacancies/parse.schemas.js'
import { type ApplicationDetailView, ApplicationsRepository, type ApplicationView } from './applications.repository.js'
import {
    type Application,
    type ApplicationDetail,
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

const metaSchema = z.object({
    model: z.string().optional(),
})

/** `vacancies.parsed` split into the answer (checked against its schema) and the model in `_meta`. */
function splitParsed(stored: unknown) {
    if (!stored || typeof stored !== 'object') {
        return {
            parsed: null,
            model: null,
            valid: true,
        }
    }
    const { _meta, ...answer } = stored as Record<string, unknown>
    const result = parsedVacancySchema.safeParse(answer)
    return {
        parsed: result.success ? result.data : null,
        model: metaSchema.safeParse(_meta).data?.model ?? null,
        valid: result.success,
    }
}

@Injectable()
export class ApplicationsService {
    private readonly logger = new Logger(ApplicationsService.name)

    constructor(
        @Inject(DB) private readonly db: Db,
        private readonly repository: ApplicationsRepository,
    ) {}

    /** A transaction even for one insert: follow-ups (an outbox event, a job) join it. */
    async create(userId: string, input: CreateApplication): Promise<Application> {
        const row = await this.db.transaction(tx => this.repository.insert(tx, userId, input))
        return toApplication(row)
    }

    /** The person's own, with its vacancy. A malformed id, or someone else's application, is a 404 like any missing one. */
    async get(id: string, userId: string): Promise<ApplicationDetail> {
        const row = uuid.safeParse(id).success ? await this.repository.findOwnedDetail(id, userId) : undefined
        if (!row) throw notFound('Application')
        return {
            ...toApplication(row),
            vacancy: this.toVacancy(row),
            cv: {
                status: 'none',
            },
        }
    }

    /** A demo row (no person) by its id, for the public CV link; any other application is a 404. */
    async getDemoForCv(id: string): Promise<Application> {
        const row = uuid.safeParse(id).success ? await this.repository.findDemo(id) : undefined
        if (!row) throw notFound('CV')
        return toApplication(row)
    }

    private toVacancy(row: ApplicationDetailView): ApplicationDetail['vacancy'] {
        if (!row.vacancyId || !row.parseStatus || !row.vacancyUpdatedAt) return null
        const { parsed, model, valid } = splitParsed(row.parsed)
        if (!valid) {
            this.logger.warn(
                {
                    vacancyId: row.vacancyId,
                },
                'stored parse does not match the schema',
            )
        }
        return {
            id: row.vacancyId,
            url: row.vacancyRowUrl,
            rawText: row.rawText ?? '',
            parseStatus: row.parseStatus,
            parseError: row.parseError,
            updatedAt: row.vacancyUpdatedAt.toISOString(),
            model,
            parsed,
        }
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
