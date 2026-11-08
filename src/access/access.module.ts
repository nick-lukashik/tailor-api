import { Global, Module } from '@nestjs/common'
import { InvitedGuard } from './invited.guard.js'
import { MeController } from './me.controller.js'

/** Who may use Tailor: the allowlist guard for every module, and GET /me. */
@Global()
@Module({
    controllers: [
        MeController,
    ],
    providers: [
        InvitedGuard,
    ],
    exports: [
        InvitedGuard,
    ],
})
export class AccessModule {}
