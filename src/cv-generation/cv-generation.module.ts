import { Module } from '@nestjs/common'
import { LlmModule } from '../llm/llm.module.js'
import { MaterialsModule } from '../materials/materials.module.js'
import { ProfileModule } from '../profile/profile.module.js'
import { StorageModule } from '../storage/storage.module.js'
import { TexModule } from '../tex/tex.module.js'
import { CvGenerateJob } from './cv-generate.job.js'
import { CvGenerationController } from './cv-generation.controller.js'
import { CvGenerator } from './cv-generator.js'
import { CvsRepository } from './cvs.repository.js'

/**
 * CVs tailored to a vacancy: the `cv.generate` job (analysis, composition,
 * fit in tailor-tex, the PDF in R2), the versions in `cvs` and
 * POST /applications/:id/cv. CvGenerateJob is exported for the parse job,
 * CvsRepository for the CV files.
 */
@Module({
    imports: [
        LlmModule,
        MaterialsModule,
        ProfileModule,
        StorageModule,
        TexModule,
    ],
    controllers: [
        CvGenerationController,
    ],
    providers: [
        CvsRepository,
        CvGenerator,
        CvGenerateJob,
    ],
    exports: [
        CvGenerateJob,
        CvsRepository,
    ],
})
export class CvGenerationModule {}
