import { z } from 'zod'

/**
 * The profile of a person (notes: tailor/02-cv/profile.md): every section the CV,
 * the texts and the form answers are built from. One strict document, edited and
 * saved whole (D-98); stored by section, so a pipeline step can read only its own
 * slice (D-93). Every field has a default, so `{}` is a valid, empty profile.
 */

const SHORT = 200
const LINE = 1_000
const PARAGRAPH = 5_000
const LONG = 20_000

const text = (max: number) => z.string().max(max).default('')
const list = <T extends z.ZodType>(item: T, max: number) => z.array(item).max(max).default([])

/** An id a person types and other fields refer to: `acme`, `c12`, `ai_tools`. */
export const slugSchema = z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/, {
        error: 'letters, digits and _ . : - only, starting with a letter or digit',
    })

export const locales = [
    'en',
    'ru',
] as const
const locale = z.enum(locales)

/** `2024-03`: a month is as precise as a CV gets. */
const yearMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, {
    error: 'a month as YYYY-MM',
})

// person

const personName = z.strictObject({
    locale,
    firstName: z.string().min(1).max(SHORT),
    lastName: z.string().max(SHORT).default(''),
})

const signature = z.strictObject({
    locale,
    text: z.string().min(1).max(LINE),
})

export const linkKinds = [
    'linkedin',
    'github',
    'website',
    'portfolio',
    'telegram',
    'email',
    'other',
] as const

const link = z.strictObject({
    kind: z.enum(linkKinds),
    url: z.url({
        protocol: /^(https?|mailto|tg)$/,
    }),
    /** As shown on the CV, e.g. `github.com/example`. */
    label: text(SHORT),
})

export const personSchema = z
    .strictObject({
        /** The name in each language the person writes in. */
        names: list(personName, 5),
        /** How letters and messages are signed, per language. */
        signatures: list(signature, 5),
        email: z.email().optional(),
        phone: z
            .strictObject({
                /** As printed: `+1 555 010 0000`. */
                display: z.string().min(1).max(40),
                /** Digits with the country code, for links and forms: `+15550100000`. */
                e164: z.string().regex(/^\+[1-9]\d{6,14}$/, {
                    error: 'E.164: + and 7 to 15 digits',
                }),
            })
            .optional(),
        telegram: z
            .string()
            .regex(/^[A-Za-z0-9_]{5,32}$/, {
                error: 'a Telegram username without @',
            })
            .optional(),
        location: z
            .strictObject({
                city: text(SHORT),
                country: text(SHORT),
                /** `UTC+4` or an IANA name. */
                timezone: text(64),
            })
            .prefault({}),
        links: list(link, 20),
        citizenship: list(z.string().min(1).max(SHORT), 5),
        residence: list(z.string().min(1).max(SHORT), 5),
    })
    .meta({
        id: 'ProfilePerson',
    })

// career

/** The roles a person looks for; each has its own CV headline. A closed list, extended here. */
export const targetRoles = [
    'fullstack',
    'frontend',
    'backend',
    'ai_engineer',
    'platform',
    'devops',
    'mobile',
    'data',
    'qa',
    'engineering_manager',
] as const

export const seniorities = [
    'junior',
    'middle',
    'senior',
    'staff',
    'principal',
    'lead',
] as const

export const careerSchema = z
    .strictObject({
        /** The headline when no target role fits better. */
        headline: text(SHORT),
        targetRoles: list(
            z.strictObject({
                role: z.enum(targetRoles),
                headline: z.string().min(1).max(SHORT),
            }),
            targetRoles.length,
        ),
        /** The stack line under the headline. */
        stackLine: text(LINE),
        /** Experience counts from this year (the code writes "6+ years"). */
        careerStartYear: z.number().int().min(1950).max(2100).optional(),
        seniority: z.enum(seniorities).optional(),
    })
    .meta({
        id: 'ProfileCareer',
    })

// employments

export const workFormats = [
    'remote',
    'hybrid',
    'office',
] as const

const quota = z.strictObject({
    min: z.number().int().min(0).max(20),
    target: z.number().int().min(0).max(20),
})

const project = z.strictObject({
    id: slugSchema,
    name: z.string().min(1).max(SHORT),
    /** One line about the product. */
    description: text(LINE),
})

const employment = z.strictObject({
    id: slugSchema,
    /** `side_projects`: the container of independent work, shown as one entry. */
    kind: z
        .enum([
            'job',
            'side_projects',
        ])
        .default('job'),
    company: z.strictObject({
        name: z.string().min(1).max(SHORT),
        website: z.url().optional(),
        domain: text(SHORT),
        industry: text(SHORT),
        size: text(SHORT),
        /** One line, under the company name. */
        description: text(LINE),
    }),
    /** The title as the CV prints it. */
    title: z.string().min(1).max(SHORT),
    start: yearMonth,
    /** null: until now. */
    end: yearMonth.nullable().default(null),
    location: text(SHORT),
    format: z.enum(workFormats).optional(),
    /** Position on the CV, smaller first. */
    order: z.number().int().min(0).max(1_000).default(0),
    /** How many bullets: for AI vacancies and for the rest. */
    quota: z
        .strictObject({
            general: quota,
            ai: quota,
        })
        .optional(),
    /** Shown only for AI vacancies. */
    aiOnly: z.boolean().default(false),
    /** Bullets printed as written, whatever the vacancy. */
    fixedBullets: list(z.string().min(1).max(LINE), 20),
    projects: list(project, 100),
})

export const employmentsSchema = list(employment, 50).meta({
    id: 'ProfileEmployments',
})

// cases

/** The 12 categories a case is rated on, 0 to 5. */
export const caseCategories = [
    'FE',
    'BE',
    'AR',
    'RE',
    'PF',
    'QA',
    'SE',
    'OW',
    'EE',
    'CO',
    'UX',
    'AI',
] as const

const rating = z.number().int().min(0).max(5).default(0)
const claim = z.strictObject({
    id: slugSchema,
    text: z.string().min(1).max(LINE),
})

const profileCase = z.strictObject({
    id: slugSchema,
    employmentId: slugSchema,
    /** A project of that employment, or none. */
    projectId: slugSchema.nullable().default(null),
    title: z.string().min(1).max(SHORT),
    primaryTheme: text(100),
    secondaryThemes: list(z.string().min(1).max(100), 20),
    /** Cases of one group make one bullet at most. */
    achievementGroup: text(64),
    technologies: list(z.string().min(1).max(100), 100),
    capabilities: list(
        z.strictObject({
            id: slugSchema,
            name: z.string().min(1).max(SHORT),
        }),
        50,
    ),
    /** What the case must not lose when shortened. */
    keyClaims: list(claim, 20),
    /** The only figures a CV may print. */
    metricClaims: list(claim, 20),
    /** The case at three lengths. */
    variants: z.strictObject({
        full: z.string().min(1).max(PARAGRAPH),
        compact: z.string().min(1).max(PARAGRAPH),
        minimal: z.string().min(1).max(PARAGRAPH),
    }),
    categoryRatings: z
        .strictObject(
            Object.fromEntries(
                caseCategories.map(category => [
                    category,
                    rating,
                ]),
            ) as Record<(typeof caseCategories)[number], typeof rating>,
        )
        .prefault({}),
    /** Words in a vacancy that make this case a candidate. */
    whenVacancyMentions: list(z.string().min(1).max(100), 50),
    /** Taken into matching. */
    active: z.boolean().default(true),
})

export const casesSchema = list(profileCase, 500).meta({
    id: 'ProfileCases',
})

// skills

export const skillsSchema = list(
    z.strictObject({
        /** `Frontend`, `AI and LLM`. */
        label: z.string().min(1).max(100),
        /** Only in AI CVs (D-121): the base CV leaves the row out. */
        aiOnly: z.boolean().default(false),
        items: list(
            z.strictObject({
                name: z.string().min(1).max(100),
                /** Other spellings (`React.js`); the CV uses the vacancy's. */
                aliases: list(z.string().min(1).max(100), 10),
                /** The core of the stack never drops off the CV. */
                core: z.boolean().default(false),
            }),
            100,
        ),
    }),
    50,
).meta({
    id: 'ProfileSkills',
})

// education and languages

export const educationSchema = z
    .strictObject({
        degrees: list(
            z.strictObject({
                institution: z.string().min(1).max(SHORT),
                degree: text(SHORT),
                field: text(SHORT),
                start: yearMonth.optional(),
                end: yearMonth.optional(),
            }),
            20,
        ),
        certificates: list(
            z.strictObject({
                name: z.string().min(1).max(SHORT),
                issuer: text(SHORT),
                year: z.number().int().min(1950).max(2100).optional(),
                url: z.url().optional(),
            }),
            50,
        ),
    })
    .meta({
        id: 'ProfileEducation',
    })

export const languageLevels = [
    'native',
    'c2',
    'c1',
    'b2',
    'b1',
    'a2',
    'a1',
    'none',
] as const

export const languagesSchema = list(
    z.strictObject({
        /** ISO 639-1: `en`, `ru`. */
        code: z.string().regex(/^[a-z]{2,3}$/, {
            error: 'an ISO 639 code: en, ru',
        }),
        name: z.string().min(1).max(100),
        /** `none`: the person does not speak it, for forms that ask. */
        level: z.enum(languageLevels),
        /** As printed: `C1, full professional proficiency`. */
        note: text(SHORT),
    }),
    30,
).meta({
    id: 'ProfileLanguages',
})

// summary

export const summarySchema = list(
    z.strictObject({
        /** `profile`, `ai_tools`. */
        id: slugSchema,
        full: text(PARAGRAPH),
        compact: text(PARAGRAPH),
        /** Only in AI CVs (D-121): the base CV leaves the paragraph out. */
        aiOnly: z.boolean().default(false),
    }),
    20,
).meta({
    id: 'ProfileSummary',
})

// story

export const storySchema = z
    .strictObject({
        /** About me, the personal part near the end. */
        aboutMe: text(LONG),
        /** The way into IT step by step: why each move. */
        careerPath: list(z.string().min(1).max(PARAGRAPH), 50),
        /** One fact per entry, tagged, so a text takes only what it needs. */
        personal: list(
            z.strictObject({
                id: slugSchema,
                text: z.string().min(1).max(PARAGRAPH),
                tags: list(z.string().min(1).max(50), 20),
            }),
            200,
        ),
        /** What the next job should be. */
        motivation: text(PARAGRAPH),
    })
    .meta({
        id: 'ProfileStory',
    })

// application facts

export const salaryPeriods = [
    'hour',
    'month',
    'year',
] as const

export const applicationFactsSchema = z
    .strictObject({
        workAuthorization: z
            .strictObject({
                /** Needs a visa sponsor, in general. */
                needsSponsorship: z.boolean().optional(),
                byCountry: list(
                    z.strictObject({
                        /** ISO 3166-1 alpha-2: `US`, `DE`. */
                        country: z.string().regex(/^[A-Z]{2}$/, {
                            error: 'an ISO 3166 code: US, DE',
                        }),
                        authorized: z.boolean(),
                        needsVisa: z.boolean().default(false),
                    }),
                    100,
                ),
            })
            .prefault({}),
        relocation: z
            .strictObject({
                willing: z.boolean().optional(),
                destinations: list(z.string().min(1).max(SHORT), 50),
            })
            .prefault({}),
        workFormats: list(z.enum(workFormats), workFormats.length),
        salary: list(
            z.strictObject({
                amount: z.number().int().min(0).max(100_000_000),
                /** ISO 4217: `USD`. */
                currency: z.string().regex(/^[A-Z]{3}$/, {
                    error: 'an ISO 4217 code: USD, EUR',
                }),
                period: z.enum(salaryPeriods),
                basis: z
                    .enum([
                        'gross',
                        'net',
                    ])
                    .optional(),
                /** For which contract this holds: `b2b`, `employment`; empty for any. */
                contract: text(100),
            }),
            20,
        ),
        noticePeriodWeeks: z.number().int().min(0).max(52).optional(),
        /** How the person can be contracted, as forms want it written. */
        contract: text(LINE),
        /** The US tax form for a foreign contractor, e.g. W-8BEN. */
        usTaxForm: text(50),
        availableFrom: z.iso.date().optional(),
        /** EEO questions are always declined. */
        eeo: z.literal('prefer_not_to_say').default('prefer_not_to_say'),
    })
    .meta({
        id: 'ProfileApplicationFacts',
    })

// answers

export const answersSchema = list(
    z.strictObject({
        id: slugSchema,
        /** `motivation.company`, `experience.leadership`, `conflict`. */
        questionClass: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/, {
            error: 'dotted lowercase words: motivation.company',
        }),
        locale,
        text: z.string().min(1).max(LONG),
        short: text(PARAGRAPH),
        tags: list(z.string().min(1).max(50), 20),
    }),
    500,
).meta({
    id: 'ProfileAnswers',
})

// voice

export const voiceChannels = [
    'telegram',
    'email',
    'linkedin',
] as const

export const voiceSchema = z
    .strictObject({
        /** Rules every text follows. */
        rules: list(z.string().min(1).max(LINE), 100),
        stopPhrases: list(z.string().min(1).max(SHORT), 200),
        /** Templates of a channel, with `{slots}`. */
        templates: list(
            z.strictObject({
                id: slugSchema,
                channel: z.enum(voiceChannels),
                locale,
                subject: text(SHORT),
                text: z.string().min(1).max(LONG),
            }),
            50,
        ),
        /** A letter or two of the person's own, for the tone. */
        samples: list(
            z.strictObject({
                locale,
                text: z.string().min(1).max(LONG),
            }),
            10,
        ),
    })
    .meta({
        id: 'ProfileVoice',
    })

// settings

export const settingsSchema = z
    .strictObject({
        maxPages: z.number().int().min(1).max(3).default(2),
        /** The CV template (D-100). */
        template: slugSchema.default('minimal-violet'),
        font: text(64),
        /** CVs are in English only (D-99). */
        cvLocale: z.literal('en').default('en'),
        /** `strict`: only facts from the profile; `free`: the owner's mode. */
        factsMode: z
            .enum([
                'strict',
                'free',
            ])
            .default('strict'),
        /** The CV header shows the location and time zone (D-120). */
        cvShowLocation: z.boolean().default(true),
        /** The CV header shows the phone (D-120). */
        cvShowPhone: z.boolean().default(true),
        /**
         * The person's own instructions appended to the prompts, so generation
         * can be tuned without a release. `cv`: the CV prompts (analysis and composition);
         * `letters`: the materials (cover letter, e-mail, messages).
         */
        promptAdditions: z
            .strictObject({
                cv: text(4_000),
                letters: text(4_000),
            })
            .prefault({}),
    })
    .meta({
        id: 'ProfileSettings',
    })

// the document

/** The sections in the order of the document and of the `profiles` columns. */
export const profileSections = [
    'person',
    'career',
    'employments',
    'cases',
    'skills',
    'education',
    'languages',
    'summary',
    'story',
    'applicationFacts',
    'answers',
    'voice',
    'settings',
] as const
export type ProfileSection = (typeof profileSections)[number]

type Issue = {
    path: (string | number)[]
    message: string
}

/** Every repeated `id` of `items`, as an issue at `<path>.<index>.id`. */
function duplicateIds(
    items: readonly {
        id: string
    }[],
    path: (string | number)[],
): Issue[] {
    const seen = new Set<string>()
    const issues: Issue[] = []
    items.forEach((item, index) => {
        if (seen.has(item.id))
            issues.push({
                path: [
                    ...path,
                    index,
                    'id',
                ],
                message: `duplicate id "${item.id}"`,
            })
        seen.add(item.id)
    })
    return issues
}

/** What one section cannot see: unique ids, and cases pointing at an employment and its project. */
function crossChecks(document: ProfileDocument): Issue[] {
    const issues: Issue[] = [
        ...duplicateIds(document.employments, [
            'employments',
        ]),
        ...document.employments.flatMap((employment, index) =>
            duplicateIds(employment.projects, [
                'employments',
                index,
                'projects',
            ]),
        ),
        ...duplicateIds(document.cases, [
            'cases',
        ]),
        ...duplicateIds(document.summary, [
            'summary',
        ]),
        ...duplicateIds(document.story.personal, [
            'story',
            'personal',
        ]),
        ...duplicateIds(document.answers, [
            'answers',
        ]),
        ...duplicateIds(document.voice.templates, [
            'voice',
            'templates',
        ]),
    ]
    const employments = new Map(
        document.employments.map(employment => [
            employment.id,
            employment,
        ]),
    )
    document.cases.forEach((profileCase, index) => {
        const employment = employments.get(profileCase.employmentId)
        if (!employment) {
            issues.push({
                path: [
                    'cases',
                    index,
                    'employmentId',
                ],
                message: `no employment "${profileCase.employmentId}"`,
            })
            return
        }
        if (profileCase.projectId && !employment.projects.some(project => project.id === profileCase.projectId))
            issues.push({
                path: [
                    'cases',
                    index,
                    'projectId',
                ],
                message: `no project "${profileCase.projectId}" in employment "${employment.id}"`,
            })
    })
    return issues
}

const documentShape = z.strictObject({
    person: personSchema.prefault({}),
    career: careerSchema.prefault({}),
    employments: employmentsSchema,
    cases: casesSchema,
    skills: skillsSchema,
    education: educationSchema.prefault({}),
    languages: languagesSchema,
    summary: summarySchema,
    story: storySchema.prefault({}),
    applicationFacts: applicationFactsSchema.prefault({}),
    answers: answersSchema,
    voice: voiceSchema.prefault({}),
    settings: settingsSchema.prefault({}),
})

export const profileDocumentSchema = documentShape
    .superRefine((document, context) => {
        for (const issue of crossChecks(document))
            context.addIssue({
                code: 'custom',
                path: issue.path,
                message: issue.message,
            })
    })
    .meta({
        id: 'ProfileDocument',
    })
export type ProfileDocument = z.output<typeof documentShape>

export const profileSchema = z
    .object({
        /** Bumped by every save; snapshot `version` holds that document. */
        version: z.number().int().min(1),
        updatedAt: z.iso.datetime(),
        document: profileDocumentSchema,
    })
    .meta({
        id: 'Profile',
    })
export type Profile = z.infer<typeof profileSchema>

export const savedProfileSchema = z
    .object({
        version: z.number().int().min(1),
        /** SHA-256 of the saved document as canonical JSON (sorted keys). */
        sha256: z.string().regex(/^[0-9a-f]{64}$/),
        updatedAt: z.iso.datetime(),
    })
    .meta({
        id: 'SavedProfile',
    })
export type SavedProfile = z.infer<typeof savedProfileSchema>

/** The JSON Schema of what PUT accepts, for the editor. */
export const profileJsonSchema = () =>
    z.toJSONSchema(documentShape, {
        io: 'input',
        target: 'draft-2020-12',
    })
