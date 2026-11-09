import { Module } from '@nestjs/common'
import { CvGenerationModule } from '../cv-generation/cv-generation.module.js'
import { LlmModule } from '../llm/llm.module.js'
import { VacanciesController } from './vacancies.controller.js'
import { VacanciesRepository } from './vacancies.repository.js'
import { VacanciesService } from './vacancies.service.js'
import { VacancyParseJob } from './vacancy-parse.job.js'

/**
 * Vacancies: one shared row per vacancy (found again by its normalized link),
 * the intake that puts pasted ones into the caller's pool of applications, and
 * the `vacancy.parse` job that reads each one with a model.
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
        VacancyParseJob,
    ],
})
export class VacanciesModule {}
