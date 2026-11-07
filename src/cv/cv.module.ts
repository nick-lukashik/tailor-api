import { Module } from '@nestjs/common'
import { CvController } from './cv.controller.js'
import { CvService } from './cv.service.js'

/** CV files on `cv.<domain>`: a mock demo file until the pipeline stores real ones. */
@Module({
    controllers: [
        CvController,
    ],
    providers: [
        CvService,
    ],
})
export class CvModule {}
