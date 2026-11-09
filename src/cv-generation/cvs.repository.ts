import { Inject, Injectable } from '@nestjs/common'
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import { DB } from '../common/database/database.js'
import { applications, cvs, vacancies } from '../db/schema.js'
import type { CvRow, Db, Tx, VacancyRow } from '../db/types.js'

/** A CV row with what its generation reads: the application's person and its vacancy. */
export type CvForGeneration = {
    cv: CvRow
    userId: string | null
    vacancy: Pick<VacancyRow, 'id' | 'parseStatus' | 'parsed' | 'rawText' | 'title'> | null
}

/** SQL of the CVs of applications (`cvs`). */
@Injectable()
export class CvsRepository {
    constructor(@Inject(DB) private readonly db: Db) {}

    /** The person's application, locked for a new version, with its vacancy's parse status; someone else's is not found. */
    async lockOwnedApplication(tx: Tx, id: string, userId: string) {
        const [row] = await tx
            .select({
                id: applications.id,
                parseStatus: vacancies.parseStatus,
            })
            .from(applications)
            .leftJoin(vacancies, eq(vacancies.id, applications.vacancyId))
            .where(and(eq(applications.id, id), eq(applications.userId, userId)))
            .for('update', {
                of: applications,
            })
            .limit(1)
        return row
    }

    /**
     * Whether a version of the application is still being made: queued, or
     * generating since after `staleBefore` (an older one was lost with its job).
     */
    async hasLiveVersion(tx: Tx, applicationId: string, staleBefore: Date): Promise<boolean> {
        const live = await tx.$count(
            cvs,
            and(
                eq(cvs.applicationId, applicationId),
                sql`(${cvs.status} = 'queued' or (${cvs.status} = 'generating' and ${cvs.updatedAt} > ${staleBefore.toISOString()}::timestamptz))`,
            ),
        )
        return live > 0
    }

    /** A new queued version: the next number of the application (its row is locked by the caller). */
    async insertVersion(tx: Tx, applicationId: string): Promise<CvRow> {
        const [row] = await tx
            .insert(cvs)
            .values({
                applicationId,
                version: sql`(select coalesce(max(${cvs.version}), 0) + 1 from ${cvs} where ${cvs.applicationId} = ${applicationId})`,
            })
            .returning()
        if (!row) throw new Error('insert into cvs returned no row')
        return row
    }

    /**
     * Version 1, queued, for every application of the vacancy that belongs to a
     * person and has no CV yet. The applications are locked first, so a
     * concurrent new version waits for this transaction.
     */
    async insertFirstVersions(tx: Tx, vacancyId: string): Promise<CvRow[]> {
        const owned = await tx
            .select({
                id: applications.id,
            })
            .from(applications)
            .where(and(eq(applications.vacancyId, vacancyId), isNotNull(applications.userId)))
            .orderBy(applications.id)
            .for('update')
        if (owned.length === 0) return []
        const withCv = await tx
            .selectDistinct({
                applicationId: cvs.applicationId,
            })
            .from(cvs)
            .where(
                inArray(
                    cvs.applicationId,
                    owned.map(row => row.id),
                ),
            )
        const has = new Set(withCv.map(row => row.applicationId))
        const without = owned.filter(row => !has.has(row.id))
        if (without.length === 0) return []
        return tx
            .insert(cvs)
            .values(
                without.map(row => ({
                    applicationId: row.id,
                    version: 1,
                })),
            )
            .returning()
    }

    /** The model of the queue it was sent to. */
    async setModel(tx: Tx, id: string, model: string, effort: string) {
        await tx
            .update(cvs)
            .set({
                model,
                effort,
                status: 'queued',
                updatedAt: sql`now()`,
            })
            .where(eq(cvs.id, id))
    }

    async findForGeneration(id: string): Promise<CvForGeneration | undefined> {
        const [row] = await this.db
            .select({
                cv: cvs,
                userId: applications.userId,
                vacancyId: vacancies.id,
                parseStatus: vacancies.parseStatus,
                parsed: vacancies.parsed,
                rawText: vacancies.rawText,
                title: vacancies.title,
            })
            .from(cvs)
            .innerJoin(applications, eq(applications.id, cvs.applicationId))
            .leftJoin(vacancies, eq(vacancies.id, applications.vacancyId))
            .where(eq(cvs.id, id))
            .limit(1)
        if (!row) return undefined
        return {
            cv: row.cv,
            userId: row.userId,
            vacancy:
                row.vacancyId && row.parseStatus && row.rawText !== null && row.title !== null
                    ? {
                          id: row.vacancyId,
                          parseStatus: row.parseStatus,
                          parsed: row.parsed,
                          rawText: row.rawText,
                          title: row.title,
                      }
                    : null,
        }
    }

    /** Generating with this model: false when the version is already ready or failed (a repeated delivery). */
    async markGenerating(id: string, model: string, effort: string): Promise<boolean> {
        const rows = await this.db
            .update(cvs)
            .set({
                status: 'generating',
                model,
                effort,
                error: null,
                updatedAt: sql`now()`,
            })
            .where(
                and(
                    eq(cvs.id, id),
                    inArray(cvs.status, [
                        'queued',
                        'generating',
                    ]),
                ),
            )
            .returning({
                id: cvs.id,
            })
        return rows.length > 0
    }

    /** What the analysis decided, before the slower steps. */
    async saveAnalysis(
        id: string,
        fields: Pick<CvRow, 'analysis' | 'aiRole' | 'role' | 'promptVersion' | 'profileVersion'>,
    ) {
        await this.db
            .update(cvs)
            .set({
                ...fields,
                updatedAt: sql`now()`,
            })
            .where(eq(cvs.id, id))
    }

    async markReady(tx: Tx, id: string, fields: Pick<CvRow, 'fileKey' | 'fileName' | 'pages' | 'document'>) {
        await tx
            .update(cvs)
            .set({
                ...fields,
                status: 'ready',
                error: null,
                updatedAt: sql`now()`,
            })
            .where(eq(cvs.id, id))
    }

    async markFailed(id: string, code: string, document?: unknown) {
        await this.db
            .update(cvs)
            .set({
                status: 'failed',
                error: code.slice(0, 100),
                ...(document === undefined
                    ? {}
                    : {
                          document,
                      }),
                updatedAt: sql`now()`,
            })
            .where(eq(cvs.id, id))
    }

    /** The newest ready version of an application, whoever's: the public link. */
    async latestReady(applicationId: string) {
        const [row] = await this.db
            .select({
                id: cvs.id,
                fileKey: cvs.fileKey,
                fileName: cvs.fileName,
            })
            .from(cvs)
            .where(and(eq(cvs.applicationId, applicationId), eq(cvs.status, 'ready')))
            .orderBy(desc(cvs.version))
            .limit(1)
        return row
    }
}
