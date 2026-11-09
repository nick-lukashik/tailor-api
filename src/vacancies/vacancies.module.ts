import { Module } from '@nestjs/common'
import { CvGenerationModule } from '../cv-generation/cv-generation.module.js'
import { LlmModule } from '../llm/llm.module.js'
import { VacanciesController } from './vacancies.controller.js'
import { VacanciesRepository } from './vacancies.repository.js'
import { VacanciesService } from './vacancies.service.js'
import { VacancyFetchJob } from './vacancy-fetch.job.js'
import { VacancyFetcher } from './vacancy-fetcher.js'
import { VacancyParseJob } from './vacancy-parse.job.js'

/**
 * Vacancies: one shared row per vacancy (found again by its normalized link),
 * the intake that puts pasted ones into the caller's pool of applications, the
 * `vacancy.fetch` job that reads each link (text and apply form) and the
 * `vacancy.parse` job that reads each one with a model.
 */
@Module({
    imports: [
        CvGenerationModule,
        LlmModule,
    ],
    controllers: [
        VacanciesController,
    ],
    providers: [
        VacanciesRepository,
        VacanciesService,
        VacancyFetcher,
        VacancyFetchJob,
        VacancyParseJob,
    ],
})
export class VacanciesModule {}
