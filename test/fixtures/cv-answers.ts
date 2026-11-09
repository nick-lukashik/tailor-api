import type { AnalysisAnswer, CompositionAnswer } from '../../src/cv-generation/cv-generation.schemas.js'
import type { ParsedVacancy } from '../../src/vacancies/parse.schemas.js'
import { completionOf, errorOf, type GatewayCall, type GatewayReply } from '../llm-gateway.js'

/** The model answers of a CV for the invented profile (`profile.ts`): the parse, the analysis and the composition. */
export const parsed: ParsedVacancy = {
    title: 'Senior Backend Engineer',
    company: 'Example Labs',
    companyDescription: null,
    seniority: 'senior',
    location: 'Remote',
    remote: 'remote',
    regions: [],
    employmentType: null,
    salary: null,
    language: 'en',
    skills: [
        {
            name: 'Node.js',
            required: true,
        },
        {
            name: 'K8s',
            required: false,
        },
    ],
    requirements: [
        'Node.js in production',
    ],
    responsibilities: [
        'Keep the checkout fast',
    ],
    niceToHave: [
        'K8s',
    ],
    applyChannels: [],
    summary: 'Example Labs hires a senior backend engineer.',
    warnings: [],
}

export const analysis: AnalysisAnswer = {
    aiRole: false,
    aiRoleReason: 'A backend role.',
    requirements: [
        {
            id: 'R1',
            text: 'Node.js in production',
            importance: 'must',
            categories: [
                'BE',
            ],
            technologies: [
                'Node.js',
            ],
        },
        {
            id: 'R2',
            text: 'Web performance of the checkout',
            importance: 'responsibility',
            categories: [
                'PF',
            ],
            technologies: [],
        },
    ],
    matches: [
        {
            requirementId: 'R2',
            caseId: 'c1',
            match: 1,
            claimIds: [
                'c1:metric_1',
            ],
        },
    ],
}

export const composition: CompositionAnswer = {
    title: 'Senior Backend Engineer',
    summary: [
        {
            id: 'profile',
            full: 'A backend engineer who ships fast services.',
            compact: 'Ships fast services.',
        },
    ],
    employments: [
        {
            employmentId: 'acme',
            bullets: [
                {
                    caseId: 'c1',
                    full: 'Rebuilt the checkout on Node.js with server rendering, so it loads 2x as fast.',
                    compact: 'Made the checkout 2x as fast on Node.js.',
                    minimal: 'Made the checkout 2x faster.',
                },
            ],
        },
    ],
    skills: [
        {
            label: 'Frontend',
            items: [
                'React',
            ],
        },
    ],
    vacancySkills: [
        {
            name: 'Node.js',
            english: 'Node.js',
            row: 'Frontend',
        },
        {
            name: 'K8s',
            english: 'Kubernetes',
            row: 'Frontend',
        },
    ],
}

export type Script = Partial<Record<string, (call: GatewayCall) => GatewayReply>>

/** The gateway answers by the schema each call asks for. */
export const scripted =
    (script: Script = {}) =>
    (call: GatewayCall): GatewayReply => {
        const name = call.body.response_format.json_schema.name
        const own = script[name]
        if (own) return own(call)
        if (name === 'parsed_vacancy') return completionOf(parsed)
        if (name === 'cv_analysis') return completionOf(analysis)
        if (name === 'cv_composition') return completionOf(composition)
        return errorOf(400, 'bad_request')
    }
