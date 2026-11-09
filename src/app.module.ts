import { Module } from '@nestjs/common'
import type { ConfigType } from '@nestjs/config'
import { AuthModule } from '@nick-lukashik/auth/nest'
import { AccessModule } from './access/access.module.js'
import { ApplicationsModule } from './applications/applications.module.js'
import { DatabaseModule } from './common/database/database.module.js'
import { HealthModule } from './common/health/health.module.js'
import { JobsModule } from './common/jobs/jobs.module.js'
import { createLoggerModule } from './common/logging/logger.module.js'
import { MetricsModule } from './common/metrics/metrics.module.js'
import { appConfig, authConfig, dbConfig, llmConfig } from './config/config.js'
import { AppConfigModule } from './config/config.module.js'
import { CvModule } from './cv/cv.module.js'
import { CvGenerationModule } from './cv-generation/cv-generation.module.js'
import * as schema from './db/schema.js'
import { MasterCvModule } from './master-cv/master-cv.module.js'
import { MaterialsModule } from './materials/materials.module.js'
import { ProfileModule } from './profile/profile.module.js'
import { StorageModule } from './storage/storage.module.js'
import { VacanciesModule } from './vacancies/vacancies.module.js'
import { VACANCY_FETCH_CONCURRENCY } from './vacancies/vacancy-fetch.job.js'

type App = ConfigType<typeof appConfig>

/**
 * The base every service needs, plus pg-boss for the vacancy parse and CV jobs. Redis
 * and RabbitMQ (outbox/inbox) are added only by a feature that uses them: copy
 * the module from nest-example and add it here (README, "Add a capability").
 */
@Module({
    imports: [
        AppConfigModule,
        createLoggerModule({
            inject: [
                appConfig.KEY,
            ],
            useFactory: (app: App) => ({
                service: app.service,
                version: app.version,
                level: app.logLevel,
            }),
        }),
        HealthModule.forRootAsync({
            inject: [
                appConfig.KEY,
            ],
            useFactory: (app: App) => ({
                shutdownDelayMs: app.shutdownDelayMs,
            }),
        }),
        MetricsModule.forRootAsync({
            inject: [
                appConfig.KEY,
            ],
            useFactory: (app: App) => ({
                service: app.service,
                version: app.version,
                port: app.metricsPort,
            }),
        }),
        DatabaseModule.forRootAsync({
            schema,
            inject: [
                dbConfig.KEY,
                appConfig.KEY,
            ],
            useFactory: (db: ConfigType<typeof dbConfig>, app: App) => ({
                url: db.url,
                max: db.max,
                applicationName: app.service,
            }),
        }),
        JobsModule.forRootAsync({
            inject: [
                dbConfig.KEY,
                appConfig.KEY,
                llmConfig.KEY,
            ],
            useFactory: (db: ConfigType<typeof dbConfig>, app: App, llm: ConfigType<typeof llmConfig>) => ({
                connectionString: db.url,
                applicationName: `${app.service}-jobs`,
                // Above the fetch, parse, CV and materials jobs running at once (each model's concurrency), the legacy drain and sends.
                max: [
                    ...llm.parseModels,
                    ...llm.cvModels,
                    ...llm.lettersModels,
                ].reduce((sum, model) => sum + model.concurrency, 3 + VACANCY_FETCH_CONCURRENCY),
            }),
        }),
        AuthModule.forRootAsync({
            inject: [
                authConfig.KEY,
            ],
            useFactory: (auth: ConfigType<typeof authConfig>) => ({
                jwksUrl: auth.jwksUrl,
                issuer: auth.issuer,
                audience: auth.audience,
            }),
        }),
        AccessModule,
        ApplicationsModule,
        CvModule,
        CvGenerationModule,
        ProfileModule,
        MasterCvModule,
        MaterialsModule,
        StorageModule,
        VacanciesModule,
    ],
})
export class AppModule {}
