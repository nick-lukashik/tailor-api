import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { GenericContainer, Wait } from 'testcontainers'
import type { TestProject } from 'vitest/node'
import { migrateDatabase } from '../src/db/migrations.js'
import { IMAGES, TEST_BUCKET } from './containers.js'

declare module 'vitest' {
    // biome-ignore lint/style/useConsistentTypeDefinitions: module augmentation merges only with an interface
    export interface ProvidedContext {
        databaseUrl: string
        /** The S3 API of the stand-in for R2, with the bucket TEST_BUCKET. */
        s3Url: string
    }
}

const S3_PORT = 9090

/**
 * Postgres once per run: TEST_DATABASE_URL when set (the org build workflow
 * exports it for its service container), else a Testcontainers one. Plain
 * DATABASE_URL is never used: the tests truncate tables, so a shell that
 * happens to export it cannot hit a real database. Migrations run first.
 * The S3 stand-in for R2 always runs in Testcontainers (CI has no service
 * container for it), in parallel with Postgres.
 */
export default async function setup(project: TestProject) {
    const s3 = new GenericContainer(IMAGES.s3)
        .withEnvironment({
            COM_ADOBE_TESTING_S3MOCK_STORE_INITIAL_BUCKETS: TEST_BUCKET,
        })
        .withExposedPorts(S3_PORT)
        .withWaitStrategy(Wait.forLogMessage(/Started S3MockApplication/))
        .start()
    let databaseUrl = process.env.TEST_DATABASE_URL
    let postgres: Awaited<ReturnType<PostgreSqlContainer['start']>> | undefined
    if (!databaseUrl) {
        postgres = await new PostgreSqlContainer(IMAGES.postgres).start()
        databaseUrl = postgres.getConnectionUri()
    }
    const storage = await s3

    await migrateDatabase(databaseUrl)
    project.provide('databaseUrl', databaseUrl)
    project.provide('s3Url', `http://${storage.getHost()}:${storage.getMappedPort(S3_PORT)}`)
    return async () => {
        await Promise.all([
            storage.stop(),
            postgres?.stop(),
        ])
    }
}
