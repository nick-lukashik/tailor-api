import { describe, expect, it } from 'vitest'
import { missingSkills, skillKey, tailorSkills } from './skills.js'

const rows = [
    {
        label: 'Frontend',
        aiOnly: false,
        items: [
            {
                name: 'React',
                aliases: [
                    'React.js',
                ],
                core: true,
            },
            {
                name: 'Redux',
                aliases: [],
                core: false,
            },
        ],
    },
    {
        label: 'Backend',
        aiOnly: false,
        items: [
            {
                name: 'Node.js',
                aliases: [],
                core: true,
            },
        ],
    },
    {
        label: 'Cloud & Observability',
        aiOnly: false,
        items: [
            {
                name: 'Kubernetes',
                aliases: [],
                core: false,
            },
        ],
    },
]

const names = (result: ReturnType<typeof tailorSkills>) =>
    result.map(row => [
        row.label,
        row.items.map(item => item.name),
    ])

describe('skill rows of a tailored CV', () => {
    it('reads spellings of one technology as one skill', () => {
        expect(skillKey('React.js')).toBe(skillKey('react'))
        expect(skillKey('K8s')).toBe(skillKey('Kubernetes'))
        expect(skillKey('Postgres')).toBe(skillKey('PostgreSQL'))
        expect(skillKey('C#')).not.toBe(skillKey('C'))
    })

    it('covers every vacancy skill in the most fitting row, in its spelling (D-118)', () => {
        const vacancySkills = [
            {
                name: 'ReactJS',
                required: true,
            },
            {
                name: 'K8s',
                required: true,
            },
            {
                name: 'GCP',
                required: false,
            },
            {
                name: 'Vue',
                required: false,
            },
            {
                name: 'Communication',
                required: false,
            },
        ]
        const result = tailorSkills({
            rows,
            model: [],
            vacancySkills,
            vacancyTechnologies: [],
        })
        expect(names(result)).toEqual([
            [
                'Frontend',
                [
                    'ReactJS',
                    'Vue',
                    'Redux',
                ],
            ],
            [
                'Backend',
                [
                    'Node.js',
                ],
            ],
            [
                'Cloud & Observability',
                [
                    'K8s',
                    'GCP',
                    'Communication',
                ],
            ],
        ])
        expect(missingSkills(result, vacancySkills)).toEqual([])
    })

    it("takes the model's order and placement, drops what neither side has, keeps every profile item", () => {
        const result = tailorSkills({
            rows,
            model: [
                {
                    label: 'backend',
                    items: [
                        'TypeScript',
                        'Node.js',
                        'Invented Framework',
                        'Redux',
                    ],
                },
                {
                    label: 'No such row',
                    items: [
                        'React',
                    ],
                },
            ],
            vacancySkills: [
                {
                    name: 'TypeScript',
                    required: true,
                },
            ],
            vacancyTechnologies: [],
        })
        expect(names(result)).toEqual([
            [
                'Frontend',
                [
                    'React',
                ],
            ],
            [
                'Backend',
                [
                    'TypeScript',
                    'Node.js',
                    'Redux',
                ],
            ],
            [
                'Cloud & Observability',
                [
                    'Kubernetes',
                ],
            ],
        ])
        expect(result[1]?.items.map(item => item.priority)).toEqual([
            100,
            60,
            30,
        ])
    })
})
