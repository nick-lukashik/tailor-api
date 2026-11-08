import { Module } from '@nestjs/common'
import { ProfileModule } from '../profile/profile.module.js'
import { TexModule } from '../tex/tex.module.js'
import { MasterCvController } from './master-cv.controller.js'
import { MasterCvService } from './master-cv.service.js'

/** The master CV PDF of the caller's profile (`GET /api/v1/profile/cv.pdf`). */
@Module({
    imports: [
        ProfileModule,
        TexModule,
    ],
    controllers: [
        MasterCvController,
    ],
    providers: [
        MasterCvService,
    ],
})
export class MasterCvModule {}
