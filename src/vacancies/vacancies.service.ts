import { Inject, Injectable } from '@nestjs/common'
import { DB } from '../common/database/database.js'
import type { Db, VacancyRow } from '../db/types.js'
import { vacancyUrlKey } from './url-key.js'
import { VacanciesRepository } from './vacancies.repository.js'
import type { VacancyIntake, VacancyIntakeResult } from './vacancies.schemas.js'

@Injectable()
export class VacanciesService {
    constructor(
        @Inject(DB) private readonly db: Db,
        private readonly repository: VacanciesRepository,
    ) {}

    /**
     * Pasted vacancies into the caller's pool, one transaction for the batch.
     * Nothing is parsed here: new vacancies start `pending`.
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
            const byKey = new Map<string, VacancyRow>()
            for (const urlKey of [
                ...linked.keys(),
            ].sort()) {
                const seen = linked.get(urlKey)
                if (!seen) continue
                byKey.set(
                    urlKey,
                    await this.repository.findOrCreateByUrl(tx, {
                        ...seen,
                        urlKey,
                        createdBy: userId,
                    }),
                )
            }

            const results: VacancyIntakeResult['items'] = []
            for (const { url, urlKey, text } of items) {
                const vacancy =
                    urlKey === undefined ? await this.repository.insertText(tx, text, userId) : byKey.get(urlKey)
                if (!vacancy) throw new Error('a linked vacancy was not resolved')
                const entry = await this.repository.addToPool(tx, userId, vacancy, url ?? null)
                results.push({
                    applicationId: entry.applicationId,
                    vacancyId: vacancy.id,
                    result: entry.created ? 'created' : 'existing',
                })
            }
            const created = results.filter(item => item.result === 'created').length
            return {
                created,
                existing: results.length - created,
                items: results,
            }
        })
    }
}
