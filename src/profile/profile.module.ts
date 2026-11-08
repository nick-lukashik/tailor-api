import { Module } from '@nestjs/common'
import { ProfileController } from './profile.controller.js'
import { ProfileRepository } from './profile.repository.js'
import { ProfileService } from './profile.service.js'

/** The person's profile (notes: tailor/02-cv/profile.md): sections, versions, snapshots. */
@Module({
    controllers: [
        ProfileController,
    ],
    providers: [
        ProfileRepository,
        ProfileService,
    ],
})
export class ProfileModule {}
