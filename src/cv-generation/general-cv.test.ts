import { describe, expect, it } from 'vitest'
import { aiProfile, exampleCase } from '../../test/fixtures/cv-profile.js'
import { buildMasterCv } from '../master-cv/master-cv.js'
import type { CvMeasurement } from '../tex/cv-document.js'
import { fitCv } from './fitting.js'
import { buildGeneralCv, generalContent } from './general-cv.js'
import { bulletId, initialFitState } from './tailored-cv.js'

const LONG_ID = 'a-case-with-an-id-longer-than-forty-characters'

/** The AI-only parts, a fixed bullet and a case with a long id: everything the master CV decides on. */
function profile() {
    const document = aiProfile()
    document.cases.push(exampleCase(LONG_ID, 'acme'))
    for (const employment of document.employments)
        if (employment.id === 'acme')
            employment.fixedBullets = [
                'Kept the marketplace running.',
            ]
    return document
}

const measurement = (pages: number): CvMeasurement => ({
    pages,
    fill: Array.from(
        {
            length: pages,
        },
        () => 0.5,
    ),
    sizeBytes: 1,
    fits: pages === 1,
    overfullPt: 0,
    fontsOk: true,
    blocks: [],
    warnings: [],
})

describe('the CV of a general vacancy', () => {
    it('is exactly the master CV before the fit', () => {
        const document = profile()
        expect(buildGeneralCv(document, generalContent(document), initialFitState())).toEqual(buildMasterCv(document))
    })

    it('shortens the master CV only as the fit says', () => {
        const document = profile()
        const content = generalContent(document)
        const master = buildMasterCv(document)
        const caseIndex = document.cases.findIndex(item => item.id === LONG_ID)
        const fitted = buildGeneralCv(document, content, {
            ...initialFitState(),
            summaryCompact: true,
            variants: {
                [LONG_ID]: 'minimal',
            },
            removed: [
                'c2',
            ],
        })
        expect(fitted.summary).toEqual(document.summary.filter(item => !item.aiOnly).map(item => item.compact))
        expect(fitted.jobs[0]?.bullets).toEqual([
            {
                id: 'fixed-1-0',
                text: 'Kept the marketplace running.',
            },
            {
                id: 'c1',
                text: master.jobs[0]?.bullets[1]?.text,
            },
            {
                id: bulletId(LONG_ID, caseIndex),
                text: `Built ${LONG_ID}.`,
            },
        ])
        expect({
            ...fitted,
            summary: master.summary,
            jobs: master.jobs,
        }).toEqual(master)
    })

    it('keeps the skills whole and cuts a bullet only within the minimum', async () => {
        const document = profile()
        const content = generalContent(document)
        expect(content.skills.flatMap(row => row.items).every(item => item.priority >= 60)).toBe(true)
        // The quota's minimum of 3 against the three cases printed: none may go.
        expect(content.jobs[0]?.minBullets).toBe(3)
        const result = await fitCv(
            {
                content,
                maxPages: 1,
                build: state => buildGeneralCv(document, content, state),
                bulletIds: new Map(),
            },
            async () => measurement(2),
            initialFitState(),
        )
        expect(result).toMatchObject({
            fitted: false,
            code: 'cv_does_not_fit',
        })
    })
})
