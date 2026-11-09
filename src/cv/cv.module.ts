import { Module } from '@nestjs/common'
import { ApplicationsModule } from '../applications/applications.module.js'
import { CvController } from './cv.controller.js'
import { CvService } from './cv.service.js'

/** CV files on `cv.<domain>`: the demo PDF for the demo rows until the pipeline builds real ones. */
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
