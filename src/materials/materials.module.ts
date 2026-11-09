import { Module } from '@nestjs/common'
import { LlmModule } from '../llm/llm.module.js'
import { ProfileModule } from '../profile/profile.module.js'
import { MaterialsController } from './materials.controller.js'
import { MaterialsRepository } from './materials.repository.js'
import { MaterialsGenerateJob } from './materials-generate.job.js'

/**
 * The materials for applying by hand to an application's vacancy: the
 * `materials.generate` job, the versions in `materials` and
 * POST /applications/:id/materials. MaterialsGenerateJob is exported for the
 * CV job, which queues the materials of every CV version that becomes ready.
 */
@Module({
    imports: [
        LlmModule,
        ProfileModule,
    ],
    controllers: [
        MaterialsController,
    ],
    providers: [
        MaterialsRepository,
        MaterialsGenerateJob,
    ],
    exports: [
        MaterialsGenerateJob,
    ],
})
export class MaterialsModule {}
