import { Readable } from 'node:stream'
import { Injectable, Logger } from '@nestjs/common'
import { z } from 'zod'
import { ApplicationsService } from '../applications/applications.service.js'
import { AppError, notFound } from '../common/http/app-error.js'
import { CvsRepository } from '../cv-generation/cvs.repository.js'
import { ObjectStorage, StorageError } from '../storage/object-storage.js'
import { cvFileName } from './cv-file-name.js'
import { buildDemoPdf } from './demo-pdf.js'

/** Whose CV the demo rows have. */
export const CV_OWNER = 'Nick Lukashik'

export type CvContent = {
    body: Readable
    length: number
}

export type CvFile = {
    fileName: string
    /** The PDF, opened only when it is served (a redirect needs only the name). */
    open: () => Promise<CvContent>
}

const uuid = z.uuid()

/**
 * The CV of an application, by its id: `cv.<domain>/<application id>/<file name>`.
 * The demo rows of 0001 (no person) have the demo PDF under each one's own
 * name; a real application has its newest ready version, streamed from R2.
 * Anything else is a 404.
 */
@Injectable()
export class CvService {
    private readonly logger = new Logger(CvService.name)
    private readonly demo = buildDemoPdf([
        'Tailor',
        'A demo CV: the real files arrive with the pipeline.',
    ])

    constructor(
        private readonly applications: ApplicationsService,
        private readonly cvs: CvsRepository,
        private readonly storage: ObjectStorage,
    ) {}

    /** An unknown or malformed id, or an application without a ready CV, is a 404. */
    async get(applicationId: string): Promise<CvFile> {
        if (!uuid.safeParse(applicationId).success) throw notFound('CV')
        const demo = await this.applications.findDemoForCv(applicationId)
        if (demo)
            return {
                fileName: cvFileName(CV_OWNER, demo.role),
                open: async () => ({
                    body: Readable.from([
                        this.demo,
                    ]),
                    length: this.demo.length,
                }),
            }
        const ready = await this.cvs.latestReady(applicationId)
        if (!ready?.fileKey || !ready.fileName) throw notFound('CV')
        const { fileKey } = ready
        return {
            fileName: ready.fileName,
            open: () => this.open(ready.id, fileKey),
        }
    }

    private async open(cvId: string, key: string): Promise<CvContent> {
        let object: Awaited<ReturnType<ObjectStorage['get']>>
        try {
            object = await this.storage.get(key)
        } catch (error) {
            if (error instanceof StorageError) throw new AppError('UNAVAILABLE', 'The CV is unavailable, retry later')
            throw error
        }
        if (!object) {
            this.logger.warn(
                {
                    cvId,
                },
                'Ready CV missing from storage',
            )
            throw notFound('CV')
        }
        return {
            body: object.body,
            length: object.size,
        }
    }
}
