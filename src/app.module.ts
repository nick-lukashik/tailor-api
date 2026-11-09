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
import { appConfig, authConfig, dbConfig } from './config/config.js'
import { AppConfigModule } from './config/config.module.js'
import { CvModule } from './cv/cv.module.js'
import * as schema from './db/schema.js'
import { MasterCvModule } from './master-cv/master-cv.module.js'
import { ProfileModule } from './profile/profile.module.js'
import { VacanciesModule } from './vacancies/vacancies.module.js'

type App = ConfigType<typeof appConfig>

/**
 * The base every service needs, plus pg-boss for the vacancy parse job. Redis
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
            ],
            useFactory: (db: ConfigType<typeof dbConfig>, app: App) => ({
                connectionString: db.url,
                applicationName: `${app.service}-jobs`,
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
        ProfileModule,
        MasterCvModule,
        VacanciesModule,
    ],
})
export class AppModule {}
