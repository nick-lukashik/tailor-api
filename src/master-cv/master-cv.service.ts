import { Injectable, Logger } from '@nestjs/common'
import { AppError } from '../common/http/app-error.js'
import { cvFileName } from '../cv/cv-file-name.js'
import { ProfileService } from '../profile/profile.service.js'
import { type RenderedPdf, TailorTexClient } from '../tex/tailor-tex.client.js'
import { buildMasterCv, masterCvIssues } from './master-cv.js'

export type MasterCvPdf = RenderedPdf & {
    fileName: string
}

/** The master CV of a person: their profile, built by tailor-tex, without a vacancy. */
@Injectable()
export class MasterCvService {
    private readonly logger = new Logger(MasterCvService.name)

    constructor(
        private readonly profiles: ProfileService,
        private readonly tex: TailorTexClient,
    ) {}

    /** 503 without the renderer, 404 without a profile, 422 when the profile does not make a CV. */
    async render(userId: string, signal?: AbortSignal): Promise<MasterCvPdf> {
        this.tex.assertConfigured()
        const { document: profile, version } = await this.profiles.get(userId)
        const document = buildMasterCv(profile)
        const issues = masterCvIssues(document)
        if (issues.length) throw new AppError('UNPROCESSABLE', 'The profile does not make a CV yet', issues)
        const pdf = await this.tex.render(
            {
                document,
                template: 'minimal-violet',
                maxPages: profile.settings.maxPages,
            },
            signal,
        )
        this.logger.log(
            {
                version,
                pages: pdf.pages,
                fill: pdf.fill,
                bytes: pdf.length,
            },
            'master CV rendered',
        )
        return {
            ...pdf,
            fileName: cvFileName(document.name, document.headline),
        }
    }
}
