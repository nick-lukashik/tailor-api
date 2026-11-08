import { Module } from '@nestjs/common'
import { TailorTexClient } from './tailor-tex.client.js'

/** tailor-tex, the internal CV renderer (TAILOR_TEX_URL, TAILOR_TEX_TOKEN). */
@Module({
    providers: [
        TailorTexClient,
    ],
    exports: [
        TailorTexClient,
    ],
})
export class TexModule {}
