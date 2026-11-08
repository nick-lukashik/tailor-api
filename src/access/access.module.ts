import { Module } from '@nestjs/common'
import { MeController } from './me.controller.js'

/** Who may use Tailor: `@TailorAccess()` (the role check, used by every module) and GET /me. */
@Module({
    controllers: [
        MeController,
    ],
})
export class AccessModule {}
