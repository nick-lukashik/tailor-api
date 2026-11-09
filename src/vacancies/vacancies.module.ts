import { Module } from '@nestjs/common'
import { VacanciesController } from './vacancies.controller.js'
import { VacanciesRepository } from './vacancies.repository.js'
import { VacanciesService } from './vacancies.service.js'

/**
 * Vacancies: one shared row per vacancy (found again by its normalized link)
 * and the intake that puts pasted ones into the caller's pool of applications.
 */
@Module({
    controllers: [
        VacanciesController,
    ],
    providers: [
        VacanciesRepository,
        VacanciesService,
    ],
})
export class VacanciesModule {}
