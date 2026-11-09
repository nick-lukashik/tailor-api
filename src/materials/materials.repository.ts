import { Inject, Injectable } from '@nestjs/common'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { DB } from '../common/database/database.js'
import { applications, cvs, materials, vacancies } from '../db/schema.js'
import type { CvRow, Db, MaterialsRow, Tx, VacancyRow } from '../db/types.js'

/** A materials row with what its generation reads: the person, the vacancy and the CV it is written from. */
export type MaterialsForGeneration = {
    materials: MaterialsRow
    userId: string | null
    vacancy: Pick<VacancyRow, 'parseStatus' | 'parsed' | 'rawText'> | null
    cv: Pick<CvRow, 'status' | 'document' | 'fileName'>
}

/** SQL of the materials of applications (`materials`). */
@Injectable()
export class MaterialsRepository {
    constructor(@Inject(DB) private readonly db: Db) {}

    /** The person's application, locked for a new version; someone else's is not found. */
    async lockOwnedApplication(tx: Tx, id: string, userId: string) {
        const [row] = await tx
            .select({
                id: applications.id,
            })
            .from(applications)
            .where(and(eq(applications.id, id), eq(applications.userId, userId)))
            .for('update')
            .limit(1)
        return row
    }

    /** The newest ready CV version of an application. */
    async latestReadyCv(tx: Tx, applicationId: string) {
        const [row] = await tx
            .select({
                id: cvs.id,
            })
            .from(cvs)
            .where(and(eq(cvs.applicationId, applicationId), eq(cvs.status, 'ready')))
            .orderBy(desc(cvs.version))
            .limit(1)
        return row
    }

    /** Whether a version is still being written: queued, or generating since after `staleBefore`. */
    async hasLiveVersion(tx: Tx, applicationId: string, staleBefore: Date): Promise<boolean> {
        const live = await tx.$count(
            materials,
            and(
                eq(materials.applicationId, applicationId),
                sql`(${materials.status} = 'queued' or (${materials.status} = 'generating' and ${materials.updatedAt} > ${staleBefore.toISOString()}::timestamptz))`,
            ),
        )
        return live > 0
    }

    /** A new queued version from a CV: the next number of the application. */
    async insertVersion(tx: Tx, applicationId: string, cvId: string): Promise<MaterialsRow> {
        const [row] = await tx
            .insert(materials)
            .values({
                applicationId,
                cvId,
                version: sql`(select coalesce(max(${materials.version}), 0) + 1 from ${materials} where ${materials.applicationId} = ${applicationId})`,
            })
            .returning()
        if (!row) throw new Error('insert into materials returned no row')
        return row
    }

    /** The model of the queue it was sent to. */
    async setModel(tx: Tx, id: string, model: string, effort: string) {
        await tx
            .update(materials)
            .set({
                model,
                effort,
                status: 'queued',
                updatedAt: sql`now()`,
            })
            .where(eq(materials.id, id))
    }

    async findForGeneration(id: string): Promise<MaterialsForGeneration | undefined> {
        const [row] = await this.db
            .select({
                materials,
                userId: applications.userId,
                parseStatus: vacancies.parseStatus,
                parsed: vacancies.parsed,
                rawText: vacancies.rawText,
                cvStatus: cvs.status,
                document: cvs.document,
                fileName: cvs.fileName,
            })
            .from(materials)
            .innerJoin(applications, eq(applications.id, materials.applicationId))
            .innerJoin(cvs, eq(cvs.id, materials.cvId))
            .leftJoin(vacancies, eq(vacancies.id, applications.vacancyId))
            .where(eq(materials.id, id))
            .limit(1)
        if (!row) return undefined
        return {
            materials: row.materials,
            userId: row.userId,
            vacancy:
                row.parseStatus && row.rawText !== null
                    ? {
                          parseStatus: row.parseStatus,
                          parsed: row.parsed,
                          rawText: row.rawText,
                      }
                    : null,
            cv: {
                status: row.cvStatus,
                document: row.document,
                fileName: row.fileName,
            },
        }
    }

    /** Generating with this model: false when the version is already ready or failed (a repeated delivery). */
    async markGenerating(id: string, model: string, effort: string): Promise<boolean> {
        const rows = await this.db
            .update(materials)
            .set({
                status: 'generating',
                model,
                effort,
                error: null,
                updatedAt: sql`now()`,
            })
            .where(
                and(
                    eq(materials.id, id),
                    inArray(materials.status, [
                        'queued',
                        'generating',
                    ]),
                ),
            )
            .returning({
                id: materials.id,
            })
        return rows.length > 0
    }

    async markReady(id: string, fields: Pick<MaterialsRow, 'content' | 'promptVersion'>) {
        await this.db
            .update(materials)
            .set({
                ...fields,
                status: 'ready',
                error: null,
                updatedAt: sql`now()`,
            })
            .where(eq(materials.id, id))
    }

    async markFailed(id: string, code: string) {
        await this.db
            .update(materials)
            .set({
                status: 'failed',
                error: code.slice(0, 100),
                updatedAt: sql`now()`,
            })
            .where(eq(materials.id, id))
    }
}
