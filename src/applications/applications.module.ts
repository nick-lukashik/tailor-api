import { Module } from '@nestjs/common'
import { ApplicationsController } from './applications.controller.js'
import { ApplicationsRepository } from './applications.repository.js'
import { ApplicationsService } from './applications.service.js'

/**
 * Applications: a vacancy and what was sent to it (schemas → repository →
 * service → controller). ApplicationsService is exported for the CV files.
 */
@Module({
    controllers: [
        ApplicationsController,
    ],
    providers: [
        ApplicationsRepository,
        ApplicationsService,
    ],
    exports: [
        ApplicationsService,
    ],
})
export class ApplicationsModule {}
