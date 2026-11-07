import { Module } from '@nestjs/common'
import { ApplicationsModule } from '../applications/applications.module.js'
import { CvController } from './cv.controller.js'
import { CvService } from './cv.service.js'

/** CV files on `cv.<domain>`: a mock demo file until the pipeline stores real ones. */
@Module({
    imports: [
        ApplicationsModule,
    ],
    controllers: [
        CvController,
    ],
    providers: [
        CvService,
    ],
})
export class CvModule {}
