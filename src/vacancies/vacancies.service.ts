import { Inject, Injectable } from '@nestjs/common'
import { z } from 'zod'
import { DB } from '../common/database/database.js'
import { notFound } from '../common/http/app-error.js'
import type { Db, VacancyRow } from '../db/types.js'
import { vacancyUrlKey } from './url-key.js'
import { VacanciesRepository } from './vacancies.repository.js'
import type { VacancyIntake, VacancyIntakeResult, VacancyParseQueued } from './vacancies.schemas.js'
import { VacancyParseJob } from './vacancy-parse.job.js'

const uuid = z.uuid()

@Injectable()
export class VacanciesService {
    constructor(
        @Inject(DB) private readonly db: Db,
        private readonly repository: VacanciesRepository,
        private readonly parseJob: VacancyParseJob,
    ) {}

    /**
     * Pasted vacancies into the caller's pool, one transaction for the batch.
     * A parse is queued in the same transaction for every vacancy it created
     * and every known one whose empty text it filled; they start `pending`.
     */
    async intake(userId: string, input: VacancyIntake): Promise<VacancyIntakeResult> {
        const items = input.items.map(item => ({
            ...item,
            urlKey: item.url === undefined ? undefined : vacancyUrlKey(item.url),
        }))
        return this.db.transaction(async tx => {
            // Linked vacancies first, in key order: concurrent batches then lock rows in the same order.
            const linked = new Map<
                string,
                {
                    url: string
                    rawText: string
                }
            >()
            for (const { url, urlKey, text } of items) {
                if (url === undefined || urlKey === undefined) continue
                const seen = linked.get(urlKey)
                if (!seen)
                    linked.set(urlKey, {
                        url,
                        rawText: text,
                    })
                else if (seen.rawText === '') seen.rawText = text
            }
            const toParse = new Set<string>()
            const byKey = new Map<string, VacancyRow>()
            for (const urlKey of [
                ...linked.keys(),
            ].sort()) {
                const seen = linked.get(urlKey)
                if (!seen) continue
                const { vacancy, changed } = await this.repository.findOrCreateByUrl(tx, {
                    ...seen,
                    urlKey,
                    createdBy: userId,
                })
                byKey.set(urlKey, vacancy)
                if (changed) toParse.add(vacancy.id)
            }

            const results: VacancyIntakeResult['items'] = []
            for (const { url, urlKey, text } of items) {
                const vacancy =
                    urlKey === undefined ? await this.repository.insertText(tx, text, userId) : byKey.get(urlKey)
                if (!vacancy) throw new Error('a linked vacancy was not resolved')
                if (urlKey === undefined) toParse.add(vacancy.id)
                const entry = await this.repository.addToPool(tx, userId, vacancy, url ?? null)
                results.push({
                    applicationId: entry.applicationId,
                    vacancyId: vacancy.id,
                    result: entry.created ? 'created' : 'existing',
                })
            }
            await this.parseJob.request(tx, [
                ...toParse,
            ])
            const created = results.filter(item => item.result === 'created').length
            return {
                created,
                existing: results.length - created,
                items: results,
            }
        })
    }

    /** Parses a vacancy of the caller's pool again (someone else's or unknown: 404); it is `pending` until then. */
    async reparse(userId: string, vacancyId: string): Promise<VacancyParseQueued> {
        if (!uuid.safeParse(vacancyId).success) throw notFound('Vacancy')
        await this.db.transaction(async tx => {
            if (!(await this.repository.inPool(tx, userId, vacancyId))) throw notFound('Vacancy')
            await this.repository.markPending(tx, vacancyId)
            await this.parseJob.request(tx, [
                vacancyId,
            ])
        })
        return {
            vacancyId,
            parseStatus: 'pending',
        }
    }
}
