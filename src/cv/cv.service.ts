import { Injectable } from '@nestjs/common'
import { notFound } from '../common/http/app-error.js'
import { buildDemoPdf } from './demo-pdf.js'

/** The mock code: `cv.<domain>/demo`. Real codes and files come with the pipeline. */
export const DEMO_CODE = 'demo'

export type CvFile = {
    fileName: string
    content: Buffer
}

/** CV files by their public code. A mock for now: one demo file, nothing stored. */
@Injectable()
export class CvService {
    private readonly demo: CvFile = {
        fileName: 'cv.pdf',
        content: buildDemoPdf([
            'Tailor',
            'A demo CV: the real files arrive with the pipeline.',
        ]),
    }

    /** An unknown or malformed code is the same 404. */
    get(code: string): CvFile {
        if (code !== DEMO_CODE) throw notFound('CV')
        return this.demo
    }
}
