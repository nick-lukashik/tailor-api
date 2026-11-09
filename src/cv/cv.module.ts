import { Module } from '@nestjs/common'
import { ApplicationsModule } from '../applications/applications.module.js'
import { CvGenerationModule } from '../cv-generation/cv-generation.module.js'
import { StorageModule } from '../storage/storage.module.js'
import { CvController } from './cv.controller.js'
import { CvService } from './cv.service.js'

/** CV files on `cv.<domain>`: the newest ready CV of an application from R2, the demo PDF for the demo rows. */
@Module({
    imports: [
        ApplicationsModule,
        CvGenerationModule,
        StorageModule,
    ],
    controllers: [
        CvController,
    ],
    providers: [
        CvService,
    ],
})
export class CvModule {}
