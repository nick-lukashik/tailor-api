import { describe, expect, it } from 'vitest'
import { matchingStack, missingSkills, normalizeVacancySkills, skillKey, tailorSkills } from './skills.js'

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
            vacancySkills: normalizeVacancySkills(vacancySkills, [], rows),
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
                ],
            ],
        ])
        // Communication is no technology: it goes nowhere.
        expect(missingSkills(result, vacancySkills)).toEqual([
            {
                name: 'Communication',
                required: false,
            },
        ])
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

    it('prints only English names: the vacancy spelling when English, the model reading, else nothing', () => {
        const vacancySkills = normalizeVacancySkills(
            [
                {
                    name: 'unit-тесты',
                    required: true,
                },
                {
                    name: 'Postgres',
                    required: true,
                },
                {
                    name: 'работа в команде',
                    required: false,
                },
                {
                    name: 'Teamwork',
                    required: false,
                },
                {
                    name: 'Git',
                    required: false,
                },
                {
                    name: 'облака',
                    required: false,
                },
            ],
            [
                {
                    name: 'unit-тесты',
                    english: 'Unit testing',
                    row: 'Testing and Quality',
                },
                {
                    name: 'Postgres',
                    english: 'PostgreSQL',
                    row: 'Backend',
                },
                {
                    name: 'работа в команде',
                    english: 'Teamwork',
                    row: '',
                },
                {
                    name: 'Teamwork',
                    english: 'Teamwork',
                    row: '',
                },
                {
                    name: 'Git',
                    english: 'Git',
                    row: '',
                },
            ],
            rows,
        )
        expect(vacancySkills).toEqual([
            {
                name: 'Unit testing',
                required: true,
                row: 'Testing and Quality',
            },
            {
                name: 'Postgres',
                required: true,
                row: 'Backend',
            },
            {
                name: 'Git',
                required: false,
            },
        ])
        const result = tailorSkills({
            rows,
            model: [
                {
                    label: 'Frontend',
                    items: [
                        'Реакт',
                        'React',
                    ],
                },
            ],
            vacancySkills,
            vacancyTechnologies: [
                'Вебсокеты',
            ],
        })
        const items = result.flatMap(row => row.items.map(item => item.name))
        expect(items.filter(item => /[^\x20-\x7E]/.test(item))).toEqual([])
        expect(items).toEqual(
            expect.arrayContaining([
                'Unit testing',
                'Postgres',
                'Git',
            ]),
        )
        expect(missingSkills(result, vacancySkills)).toEqual([])
    })

    it('treats a combined item as its parts, split when the vacancy lists them separately', () => {
        const backend = [
            {
                label: 'Backend',
                aiOnly: false,
                items: [
                    {
                        name: 'Node.js',
                        aliases: [],
                        core: true,
                    },
                    {
                        name: 'Python (FastAPI)',
                        aliases: [],
                        core: true,
                    },
                ],
            },
        ]
        const covered = tailorSkills({
            rows: backend,
            model: [
                {
                    label: 'Backend',
                    items: [
                        'Python',
                        'python (fastapi)',
                        'NODE.JS',
                    ],
                },
            ],
            vacancySkills: [
                {
                    name: 'Python',
                    required: true,
                },
            ],
            vacancyTechnologies: [],
        })
        expect(names(covered)).toEqual([
            [
                'Backend',
                [
                    'Python (FastAPI)',
                    'Node.js',
                ],
            ],
        ])
        expect(
            missingSkills(covered, [
                {
                    name: 'Python',
                    required: true,
                },
            ]),
        ).toEqual([])

        const split = tailorSkills({
            rows: backend,
            model: [
                {
                    label: 'Backend',
                    items: [
                        'Python (FastAPI)',
                        'FastAPI',
                    ],
                },
            ],
            vacancySkills: [
                {
                    name: 'Python',
                    required: true,
                },
                {
                    name: 'FastAPI',
                    required: true,
                },
            ],
            vacancyTechnologies: [],
        })
        expect(names(split)).toEqual([
            [
                'Backend',
                [
                    'Python',
                    'FastAPI',
                    'Node.js',
                ],
            ],
        ])
    })

    it('places an added vacancy skill in the row of its kind or the row the model gave it', () => {
        const owner = [
            ...rows.slice(0, 2),
            {
                label: 'Testing and Quality',
                aiOnly: false,
                items: [
                    {
                        name: 'Vitest',
                        aliases: [],
                        core: false,
                    },
                ],
            },
            {
                label: 'DevOps and Cloud',
                aiOnly: false,
                items: [
                    {
                        name: 'Docker',
                        aliases: [],
                        core: false,
                    },
                ],
            },
        ]
        const result = tailorSkills({
            rows: owner,
            model: [],
            vacancySkills: [
                {
                    name: 'asyncio',
                    required: true,
                },
                {
                    name: 'pytest',
                    required: true,
                },
                {
                    name: 'Terraform',
                    required: false,
                },
                {
                    name: 'Pandas',
                    required: false,
                    row: 'Backend',
                },
            ],
            vacancyTechnologies: [],
        })
        expect(names(result)).toEqual([
            [
                'Frontend',
                [
                    'React',
                    'Redux',
                ],
            ],
            [
                'Backend',
                [
                    'asyncio',
                    'Pandas',
                    'Node.js',
                ],
            ],
            [
                'Testing and Quality',
                [
                    'pytest',
                    'Vitest',
                ],
            ],
            [
                'DevOps and Cloud',
                [
                    'Terraform',
                    'Docker',
                ],
            ],
        ])
    })

    it("names the vacancy's stack a case lists, in the vacancy's spelling", () => {
        expect(
            matchingStack(
                [
                    'Python (FastAPI)',
                    'Postgres',
                ],
                [
                    'Python',
                    'FastAPI',
                    'PostgreSQL',
                    'Docker',
                ],
            ),
        ).toEqual([
            'Python',
            'FastAPI',
            'PostgreSQL',
        ])
    })
})
