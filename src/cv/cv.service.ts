import { Injectable } from '@nestjs/common'
import { ApplicationsService } from '../applications/applications.service.js'
import { cvFileName } from './cv-file-name.js'
import { buildDemoPdf } from './demo-pdf.js'

/** Whose CV it is. A constant until the owner's profile is stored. */
export const CV_OWNER = 'Nick Lukashik'

export type CvFile = {
    fileName: string
    content: Buffer
}

/**
 * The CV of an application, by its id: `cv.<domain>/<application id>/<file name>`.
 * Only the demo rows of 0001 (no person) have one for now, the demo PDF under
 * each one's own name; a real application is a 404 until its CV is built (stage 4).
 */
@Injectable()
export class CvService {
    private readonly demo = buildDemoPdf([
        'Tailor',
        'A demo CV: the real files arrive with the pipeline.',
    ])

    constructor(private readonly applications: ApplicationsService) {}

    /** An unknown or malformed id, or a real application, is a 404 (ApplicationsService.getDemoForCv). */
    async get(applicationId: string): Promise<CvFile> {
        const application = await this.applications.getDemoForCv(applicationId)
        return {
            fileName: cvFileName(CV_OWNER, application.role),
            content: this.demo,
        }
    }
}
