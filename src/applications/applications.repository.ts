import { Inject, Injectable } from '@nestjs/common'
import { and, desc, eq, getTableColumns, isNull, sql } from 'drizzle-orm'
import { DB } from '../common/database/database.js'
import { applications, cvs, materials, vacancies } from '../db/schema.js'
import type { ApplicationRow, CvRow, Db, MaterialsRow, Tx, VacancyRow } from '../db/types.js'
import type { CreateApplication, UpdateApplication } from './applications.schemas.js'

/** An application with the parse status of its vacancy (null without one) and of its newest CV and materials (null before one). */
export type ApplicationView = ApplicationRow & {
    parseStatus: VacancyRow['parseStatus'] | null
    cvStatus: CvRow['status'] | null
    materialsStatus: MaterialsRow['status'] | null
}

/** The newest materials version of an application, and the content of the newest ready one. */
export type MaterialsVersions = {
    latest?: Pick<MaterialsRow, 'version' | 'status' | 'error' | 'updatedAt'>
    ready?: Pick<MaterialsRow, 'content'>
}

/** The newest version of an application's CV, and the newest ready one (what its link serves). */
export type CvVersions = {
    latest?: Pick<CvRow, 'version' | 'status' | 'model' | 'error' | 'updatedAt'>
    ready?: Pick<CvRow, 'fileName' | 'pages'>
}

/** The status of an application's newest CV version, as a column of the list. */
const cvStatus = sql<CvRow['status'] | null>`(
    select ${cvs.status} from ${cvs} where ${cvs.applicationId} = ${applications.id}
    order by ${cvs.version} desc limit 1
)`

/** The status of an application's newest materials version, as a column of the list. */
const materialsStatus = sql<MaterialsRow['status'] | null>`(
    select ${materials.status} from ${materials} where ${materials.applicationId} = ${applications.id}
    order by ${materials.version} desc limit 1
)`

/** An application with the vacancy behind it, for its page (vacancy columns null without one). */
export type ApplicationDetailView = ApplicationView & {
    vacancyRowUrl: VacancyRow['url'] | null
    rawText: VacancyRow['rawText'] | null
    parseError: VacancyRow['parseError']
    parsed: VacancyRow['parsed']
    vacancyUpdatedAt: VacancyRow['updatedAt'] | null
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
                cvStatus,
                materialsStatus,
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
            cvStatus: null,
            materialsStatus: null,
        }
    }

    /** One of the person's own, as a row of the list; someone else's is not found. */
    async findOwned(id: string, userId: string): Promise<ApplicationView | undefined> {
        const [row] = await this.select()
            .where(and(eq(applications.id, id), eq(applications.userId, userId)))
            .limit(1)
        return row
    }

    /** The status of one of the person's own; false when it is not theirs. */
    async updateStatus(id: string, userId: string, input: UpdateApplication): Promise<boolean> {
        const rows = await this.db
            .update(applications)
            .set({
                status: input.status,
            })
            .where(and(eq(applications.id, id), eq(applications.userId, userId)))
            .returning({
                id: applications.id,
            })
        return rows.length > 0
    }

    /** A demo row of 0001 (no person) by its id: only for the public CV link. */
    async findDemo(id: string): Promise<ApplicationView | undefined> {
        const [row] = await this.select()
            .where(and(eq(applications.id, id), isNull(applications.userId)))
            .limit(1)
        return row
    }

    /** One of the person's own with its vacancy; someone else's is not found. */
    async findOwnedDetail(id: string, userId: string): Promise<ApplicationDetailView | undefined> {
        const [row] = await this.db
            .select({
                ...getTableColumns(applications),
                parseStatus: vacancies.parseStatus,
                cvStatus,
                materialsStatus,
                vacancyRowUrl: vacancies.url,
                rawText: vacancies.rawText,
                parseError: vacancies.parseError,
                parsed: vacancies.parsed,
                vacancyUpdatedAt: vacancies.updatedAt,
            })
            .from(applications)
            .leftJoin(vacancies, eq(vacancies.id, applications.vacancyId))
            .where(and(eq(applications.id, id), eq(applications.userId, userId)))
            .limit(1)
        return row
    }

    /** The newest CV version of an application and its newest ready one. */
    async cvVersions(applicationId: string): Promise<CvVersions> {
        const [latest] = await this.db
            .select({
                version: cvs.version,
                status: cvs.status,
                model: cvs.model,
                error: cvs.error,
                updatedAt: cvs.updatedAt,
            })
            .from(cvs)
            .where(eq(cvs.applicationId, applicationId))
            .orderBy(desc(cvs.version))
            .limit(1)
        const [ready] = latest
            ? await this.db
                  .select({
                      fileName: cvs.fileName,
                      pages: cvs.pages,
                  })
                  .from(cvs)
                  .where(and(eq(cvs.applicationId, applicationId), eq(cvs.status, 'ready')))
                  .orderBy(desc(cvs.version))
                  .limit(1)
            : []
        return {
            latest,
            ready,
        }
    }

    /** The newest materials version of an application and the content of its newest ready one. */
    async materialsVersions(applicationId: string): Promise<MaterialsVersions> {
        const [latest] = await this.db
            .select({
                version: materials.version,
                status: materials.status,
                error: materials.error,
                updatedAt: materials.updatedAt,
            })
            .from(materials)
            .where(eq(materials.applicationId, applicationId))
            .orderBy(desc(materials.version))
            .limit(1)
        const [ready] = latest
            ? await this.db
                  .select({
                      content: materials.content,
                  })
                  .from(materials)
                  .where(and(eq(materials.applicationId, applicationId), eq(materials.status, 'ready')))
                  .orderBy(desc(materials.version))
                  .limit(1)
            : []
        return {
            latest,
            ready,
        }
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
