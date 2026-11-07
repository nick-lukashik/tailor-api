import { Module } from '@nestjs/common'
import { ApplicationsController } from './applications.controller.js'
import { ApplicationsRepository } from './applications.repository.js'
import { ApplicationsService } from './applications.service.js'

/**
 * Sample module: the layout of a feature (schemas → repository → service →
 * controller) on Postgres. Rename or replace it; its full version with cache,
 * events and a job is in nest-example.
 */
@Module({
    controllers: [
        ApplicationsController,
    ],
    providers: [
        ApplicationsRepository,
        ApplicationsService,
    ],
})
export class ApplicationsModule {}
