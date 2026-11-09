import 'reflect-metadata'
import { text } from 'node:stream/consumers'
import { NestFactory } from '@nestjs/core'
import { z } from 'zod'
import { INTAKE_MAX_ITEMS, type VacancyIntake, vacancyIntakeSchema } from '../vacancies/vacancies.schemas.js'
import type { VacanciesService } from '../vacancies/vacancies.service.js'

/**
 * Vacancies from a JSON file into a person's pool:
 * `node dist/cli/import-vacancies.js <userId> < file.json` in a pod of
 * tailor-api (kubectl exec -i), the file `{ "items": [{ "url"?, "text"? }] }`.
 * The same intake as POST /api/v1/vacancies/intake, in chunks of its 200, so
 * the parses and CVs are queued; a vacancy already in the pool counts as existing.
 */

const fileSchema = z.object({
    items: z.array(z.unknown()).min(1),
})

/** A file that does not hold vacancies: nothing was imported. */
export class ImportInputError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'ImportInputError'
    }
}

/** Checks the whole file first, then takes it in chunks; prints nothing. */
export async function importVacancies(
    intake: Pick<VacanciesService, 'intake'>,
    userId: string,
    input: unknown,
): Promise<{
    created: number
    existing: number
}> {
    if (!z.uuid().safeParse(userId).success) throw new ImportInputError('the user id is not a uuid')
    const file = fileSchema.safeParse(input)
    if (!file.success)
        throw new ImportInputError('expected { "items": [{ "url"?, "text"? }, …] } with at least one item')
    const chunks: VacancyIntake[] = []
    for (let start = 0; start < file.data.items.length; start += INTAKE_MAX_ITEMS) {
        const chunk = vacancyIntakeSchema.safeParse({
            items: file.data.items.slice(start, start + INTAKE_MAX_ITEMS),
        })
        if (!chunk.success) {
            const issue = chunk.error.issues[0]
            const [, index, ...field] = issue?.path ?? []
            const at =
                typeof index === 'number'
                    ? `item ${start + index}${field.length ? ` (${field.join('.')})` : ''}`
                    : 'a chunk'
            throw new ImportInputError(`${at}: ${issue?.message ?? 'invalid'}`)
        }
        chunks.push(chunk.data)
    }
    let created = 0
    let existing = 0
    for (const chunk of chunks) {
        const result = await intake.intake(userId, chunk)
        created += result.created
        existing += result.existing
    }
    return {
        created,
        existing,
    }
}

async function main() {
    const [userId] = process.argv.slice(2)
    if (!userId) {
        process.stderr.write('usage: node dist/cli/import-vacancies.js <userId> < file.json\n')
        process.exit(2)
    }
    let input: unknown
    try {
        input = JSON.parse(await text(process.stdin))
    } catch {
        process.stderr.write('stdin is not JSON\n')
        process.exit(2)
    }
    // Runs next to the live server in its pod: no metrics listener of its own, or its
    // port is taken (EADDRINUSE). Set before the modules read the environment.
    process.env.METRICS_PORT = '0'
    const { AppModule } = await import('../app.module.js')
    const { VacanciesService } = await import('../vacancies/vacancies.service.js')
    const app = await NestFactory.createApplicationContext(AppModule, {
        logger: [
            'error',
        ],
    })
    try {
        const result = await importVacancies(app.get(VacanciesService), userId, input)
        process.stdout.write(`created ${result.created}, existing ${result.existing}\n`)
    } catch (error) {
        if (!(error instanceof ImportInputError)) throw error
        process.stderr.write(`${error.message}\n`)
        process.exitCode = 2
    } finally {
        await app.close()
    }
}

if (import.meta.main) await main()
