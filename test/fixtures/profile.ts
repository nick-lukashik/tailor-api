/** An invented person with every section filled: what a converted profile looks like. */
export const exampleProfile = () => ({
    person: {
        names: [
            {
                locale: 'en',
                firstName: 'Alex',
                lastName: 'Example',
            },
            {
                locale: 'ru',
                firstName: 'Алекс',
                lastName: 'Пример',
            },
        ],
        signatures: [
            {
                locale: 'en',
                text: 'Alex',
            },
        ],
        email: 'alex@example.com',
        phone: {
            display: '+1 555 010 0000',
            e164: '+15550100000',
        },
        telegram: 'alex_example',
        location: {
            city: 'Example City',
            country: 'Exampleland',
            timezone: 'UTC+4',
        },
        links: [
            {
                kind: 'github',
                url: 'https://github.example.com/alex',
                label: 'github.example.com/alex',
            },
        ],
        citizenship: [
            'Exampleland',
        ],
        residence: [],
    },
    career: {
        headline: 'Senior Full-Stack Engineer',
        targetRoles: [
            {
                role: 'fullstack',
                headline: 'Senior Full-Stack Engineer',
            },
        ],
        stackLine: 'TypeScript, React, Node.js, PostgreSQL',
        careerStartYear: 2018,
        seniority: 'senior',
    },
    employments: [
        {
            id: 'acme',
            kind: 'job',
            company: {
                name: 'Acme Example',
                website: 'https://acme.example.com',
                domain: 'acme.example.com',
                industry: 'E-commerce',
                size: '500+',
                description: 'An example marketplace.',
            },
            title: 'Senior Software Engineer',
            start: '2022-03',
            end: null,
            location: 'Remote',
            format: 'remote',
            order: 0,
            quota: {
                general: {
                    min: 3,
                    target: 5,
                },
                ai: {
                    min: 2,
                    target: 4,
                },
            },
            aiOnly: false,
            fixedBullets: [],
            projects: [
                {
                    id: 'acme-checkout',
                    name: 'Checkout',
                    description: 'The checkout of the marketplace.',
                },
            ],
        },
    ],
    cases: [
        {
            id: 'c1',
            employmentId: 'acme',
            projectId: 'acme-checkout',
            title: 'Faster checkout',
            primaryTheme: 'performance',
            secondaryThemes: [],
            achievementGroup: 'g1',
            technologies: [
                'React',
                'Node.js',
            ],
            capabilities: [
                {
                    id: 'c1:frontend_workflows',
                    name: 'frontend_workflows',
                },
            ],
            keyClaims: [
                {
                    id: 'c1:main',
                    text: 'Rebuilt the checkout so pages render on the server.',
                },
            ],
            metricClaims: [
                {
                    id: 'c1:metric_1',
                    text: '2x',
                },
            ],
            variants: {
                full: 'Rebuilt the checkout with server rendering, so it loads twice as fast.',
                compact: 'Made the checkout twice as fast.',
                minimal: 'Faster checkout.',
            },
            categoryRatings: {
                FE: 5,
                BE: 2,
                AR: 3,
                RE: 1,
                PF: 5,
                QA: 2,
                SE: 0,
                OW: 3,
                EE: 3,
                CO: 1,
                UX: 4,
                AI: 0,
            },
            whenVacancyMentions: [
                'performance',
            ],
            active: true,
        },
    ],
    skills: [
        {
            label: 'Frontend',
            items: [
                {
                    name: 'React',
                    aliases: [
                        'React.js',
                    ],
                    core: true,
                },
            ],
        },
    ],
    education: {
        degrees: [
            {
                institution: 'Example University',
                degree: 'BSc',
                field: 'Computer Science',
                start: '2012-09',
                end: '2016-06',
            },
        ],
        certificates: [],
    },
    languages: [
        {
            code: 'en',
            name: 'English',
            level: 'c1',
            note: 'C1, full professional proficiency',
        },
    ],
    summary: [
        {
            id: 'profile',
            full: 'An engineer who ships.',
            compact: 'Ships.',
        },
    ],
    story: {
        aboutMe: 'I like making things work.',
        careerPath: [
            'Started with websites for friends.',
        ],
        personal: [
            {
                id: 'hobby',
                text: 'Climbs on weekends.',
                tags: [
                    'hobby',
                ],
            },
        ],
        motivation: 'A product team that owns what it builds.',
    },
    applicationFacts: {
        workAuthorization: {
            needsSponsorship: false,
            byCountry: [],
        },
        relocation: {
            willing: false,
            destinations: [],
        },
        workFormats: [
            'remote',
        ],
        salary: [
            {
                amount: 5000,
                currency: 'USD',
                period: 'month',
                basis: 'gross',
                contract: 'b2b',
            },
        ],
        noticePeriodWeeks: 2,
        contract: 'B2B contractor',
        usTaxForm: 'W-8BEN',
        eeo: 'prefer_not_to_say',
    },
    answers: [
        {
            id: 'why-company',
            questionClass: 'motivation.company',
            locale: 'en',
            text: 'Because the product is useful.',
            short: 'Useful product.',
            tags: [],
        },
    ],
    voice: {
        rules: [
            'No long dashes.',
        ],
        stopPhrases: [
            'I am excited to apply',
        ],
        templates: [
            {
                id: 'telegram-en',
                channel: 'telegram',
                locale: 'en',
                subject: '',
                text: 'Hi {name}, about {role}: {cv_link}',
            },
        ],
        samples: [],
    },
    settings: {
        maxPages: 2,
        template: 'minimal-violet',
        font: 'plex',
        cvLocale: 'en',
        factsMode: 'strict',
        cvShowLocation: true,
        cvShowPhone: true,
    },
})
