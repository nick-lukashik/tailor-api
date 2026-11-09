import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ImportInputError, importVacancies } from '../src/cli/import-vacancies.js'
import { applications } from '../src/db/schema.js'
import { VacanciesService } from '../src/vacancies/vacancies.service.js'
import { OWNER, startApp, type TestApp } from './harness.js'

describe('import-vacancies CLI', () => {
    let t: TestApp

    beforeAll(async () => {
        t = await startApp()
    })
    afterAll(async () => {
        await t?.close()
    })

    const owned = () => t.db.$count(applications, eq(applications.userId, OWNER))

    it('imports a file larger than one intake in chunks, then counts the same file as existing', async () => {
        const file = {
            items: Array.from(
                {
                    length: 201,
                },
                (_, index) => ({
                    url: `https://example.com/jobs/${index}`,
                }),
            ),
        }
        const service = t.app.get(VacanciesService)
        expect(await importVacancies(service, OWNER, file)).toEqual({
            created: 201,
            existing: 0,
        })
        expect(await owned()).toBe(201)
        expect(await importVacancies(service, OWNER, file)).toEqual({
            created: 0,
            existing: 201,
        })
        expect(await owned()).toBe(201)
    })

    it('imports nothing from a file with an invalid item, naming it', async () => {
        const before = await owned()
        const service = t.app.get(VacanciesService)
        const items = [
            ...Array.from(
                {
                    length: 250,
                },
                (_, index) => ({
                    text: `Vacancy ${index}`,
                }),
            ),
        ]
        items[230] = {
            text: '',
        }
        await expect(
            importVacancies(service, OWNER, {
                items,
            }),
        ).rejects.toThrow(/^item 230/)
        await expect(importVacancies(service, OWNER, [])).rejects.toThrow(ImportInputError)
        await expect(
            importVacancies(service, 'not-a-uuid', {
                items: [
                    {
                        text: 'A vacancy',
                    },
                ],
            }),
        ).rejects.toThrow(ImportInputError)
        expect(await owned()).toBe(before)
    })
})
