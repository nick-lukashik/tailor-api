import { Module } from '@nestjs/common'
import { ObjectStorage } from './object-storage.js'

/** Cloudflare R2 for the service's files (R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PREFIX). */
@Module({
    providers: [
        ObjectStorage,
    ],
    exports: [
        ObjectStorage,
    ],
})
export class StorageModule {}
