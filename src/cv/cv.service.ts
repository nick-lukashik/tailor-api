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
 * A mock for now: every application gets the same demo PDF under its own name;
 * the real files (R2) come with the pipeline.
 */
@Injectable()
export class CvService {
    private readonly demo = buildDemoPdf([
        'Tailor',
        'A demo CV: the real files arrive with the pipeline.',
    ])

    constructor(private readonly applications: ApplicationsService) {}

    /** An unknown or malformed id is a 404 (ApplicationsService.get). */
    async get(applicationId: string): Promise<CvFile> {
        const application = await this.applications.get(applicationId)
        return {
            fileName: cvFileName(CV_OWNER, application.role),
            content: this.demo,
        }
    }
}
