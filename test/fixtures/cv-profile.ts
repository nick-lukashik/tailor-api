import { type ProfileDocument, profileDocumentSchema } from '../../src/profile/profile.schemas.js'
import { exampleProfile } from './profile.js'

/** A case of the example profile's shape: `id` at `employmentId`, its texts derived from `title`. */
export const exampleCase = (
    id: string,
    employmentId: string,
    extra: Partial<ProfileDocument['cases'][number]> = {},
): ProfileDocument['cases'][number] => ({
    id,
    employmentId,
    projectId: null,
    title: `Case ${id}`,
    primaryTheme: '',
    secondaryThemes: [],
    achievementGroup: id,
    technologies: [],
    capabilities: [],
    keyClaims: [],
    metricClaims: [],
    variants: {
        full: `Built the ${id} service end to end with a long description of what was done and why it mattered.`,
        compact: `Built the ${id} service end to end.`,
        minimal: `Built ${id}.`,
    },
    categoryRatings: {
        FE: 0,
        BE: 0,
        AR: 0,
        RE: 0,
        PF: 0,
        QA: 0,
        SE: 0,
        OW: 0,
        EE: 0,
        CO: 0,
        UX: 0,
        AI: 0,
    },
    whenVacancyMentions: [],
    active: true,
    ...extra,
})

/**
 * The example profile with an AI-only employment (`toggle`), a second case
 * at Acme, an AI-only skill row and summary paragraph: the parts D-115 decides on.
 */
export function aiProfile(): ProfileDocument {
    const base = profileDocumentSchema.parse(exampleProfile())
    const acme = base.employments[0]
    if (!acme) throw new Error('no employment')
    return profileDocumentSchema.parse({
        ...base,
        employments: [
            {
                ...acme,
                id: 'toggle',
                company: {
                    ...acme.company,
                    name: 'Toggle Example',
                },
                order: 1,
                aiOnly: true,
                projects: [],
            },
            acme,
        ],
        cases: [
            ...base.cases,
            exampleCase('c2', 'acme', {
                technologies: [
                    'PostgreSQL',
                ],
                categoryRatings: {
                    ...exampleCase('x', 'acme').categoryRatings,
                    BE: 5,
                },
            }),
            exampleCase('t1', 'toggle', {
                categoryRatings: {
                    ...exampleCase('x', 'acme').categoryRatings,
                    AI: 5,
                },
            }),
        ],
        skills: [
            ...base.skills,
            {
                label: 'AI and LLM',
                aiOnly: true,
                items: [
                    {
                        name: 'RAG',
                        aliases: [],
                        core: false,
                    },
                ],
            },
        ],
        summary: [
            ...base.summary,
            {
                id: 'ai_tools',
                full: 'Builds LLM features with evaluation.',
                compact: 'LLM features.',
                aiOnly: true,
            },
        ],
    })
}
