import type { ProfileDocument } from '../profile/profile.schemas.js'

/*
 * The skill rows of a tailored CV (02_ADAPTATION_WORKFLOW §11, Work Finder's
 * skills policy, D-118): the rows and labels of the profile, the model's
 * order, the vacancy's spelling, every skill the vacancy lists in the most
 * fitting row, nothing invented.
 */

type SkillRow = ProfileDocument['skills'][number]

/** Spellings of one technology: the vacancy's is kept, the profile's is not added twice. */
const ALIAS_GROUPS = [
    [
        'kubernetes',
        'k8s',
    ],
    [
        'postgresql',
        'postgres',
    ],
    [
        'javascript',
        'js',
    ],
    [
        'typescript',
        'ts',
    ],
    [
        'nodejs',
        'node',
    ],
    [
        'nextjs',
        'next',
    ],
    [
        'reactjs',
        'react',
    ],
    [
        'vuejs',
        'vue',
    ],
    [
        'nestjs',
        'nest',
    ],
    [
        'aws',
        'amazonwebservices',
    ],
    [
        'gcp',
        'googlecloud',
        'googlecloudplatform',
    ],
    [
        'rest',
        'restapi',
        'restapis',
        'restful',
        'restfulapis',
    ],
    [
        'githubactions',
        'ghactions',
    ],
    [
        'gitlabcicd',
        'gitlabci',
    ],
    [
        'microservices',
        'microservicearchitecture',
    ],
    [
        'llm',
        'llms',
    ],
    [
        'golang',
        'go',
    ],
]

/** One key per technology: `React.js`, `react` and `ReactJS` are the same skill. */
export const skillKey = (value: string) => {
    const key = value.toLowerCase().replace(/[^a-z0-9+#]/g, '')
    return ALIAS_GROUPS.find(group => group.includes(key))?.[0] ?? key
}

export type VacancySkill = {
    name: string
    required: boolean
}

export type TailoredSkill = {
    name: string
    /** 100 required by the vacancy, 80 listed by it, 70 named in a requirement, 60 the core of the stack, 30 the rest. */
    priority: number
}

export type TailoredSkillRow = {
    label: string
    items: TailoredSkill[]
}

/** Below this an item may be left out when its row does not fit: never a vacancy skill or the core. */
export const DROPPABLE_BELOW = 60

const ITEMS_MAX = 40

/** Which items a row takes when nothing better says where a vacancy skill goes. */
const ROW_KINDS: [
    RegExp,
    RegExp,
][] = [
    [
        /\b(ai|llm|ml|machine)\b/i,
        /\b(ai|llms?|gpt|openai|anthropic|claude|rag|langchain|agents?|ml|machine learning|embeddings?|prompt|mcp|vector)\b/i,
    ],
    [
        /front/i,
        /react|vue|angular|svelte|css|html|next|nuxt|tailwind|redux|javascript|webpack|vite|\bui\b|frontend/i,
    ],
    [
        /back|server|api/i,
        /node|nest|express|java\b|kotlin|\bgo\b|golang|python|django|flask|fastapi|php|laravel|ruby|rails|rust|c#|\.net|spring|graphql|rest|grpc|api|microservice|webhook|oauth|jwt/i,
    ],
    [
        /data|database|storage|messag/i,
        /sql|postgres|mysql|mongo|redis|kafka|rabbit|elastic|clickhouse|dynamo|cassandra|queue|bigquery|snowflake|vector|database/i,
    ],
    [
        /cloud|devops|infra|ops|observ|platform/i,
        /aws|gcp|azure|docker|kubernetes|k8s|terraform|helm|\bci\b|\bcd\b|actions|gitlab|jenkins|linux|prometheus|grafana|sentry|datadog|cloudflare|serverless|lambda|observability/i,
    ],
    [
        /test|quality|\bqa\b/i,
        /test|jest|vitest|playwright|cypress|selenium|\bqa\b|tdd|review/i,
    ],
]

/** The row a skill fits best by its kind, else the last row. */
function guessRow(name: string, labels: string[]): number {
    for (const [label, item] of ROW_KINDS) {
        if (!item.test(name)) continue
        const index = labels.findIndex(value => label.test(value))
        if (index >= 0) return index
    }
    return labels.length - 1
}

/**
 * The CV's skill rows: the profile's rows (`rows`, already without the
 * AI-only ones outside an AI role) in their order with their labels; the
 * model's items for a row when it names a skill of the profile or one the
 * vacancy names, in the vacancy's spelling; then every profile item the
 * model left out; then every vacancy skill still missing, in the row of the
 * profile item it is a spelling of, else the row its kind fits (D-118).
 * Items are ordered by priority, the model's order within one priority.
 */
export function tailorSkills(input: {
    rows: SkillRow[]
    model: {
        label: string
        items: string[]
    }[]
    vacancySkills: VacancySkill[]
    /** Technologies the requirements name: allowed, not required. */
    vacancyTechnologies: string[]
}): TailoredSkillRow[] {
    const { rows } = input
    const profile = new Map<
        string,
        {
            row: number
            name: string
            core: boolean
        }
    >()
    rows.forEach((row, index) => {
        for (const item of row.items)
            for (const spelling of [
                item.name,
                ...item.aliases,
            ]) {
                const key = skillKey(spelling)
                if (key && !profile.has(key))
                    profile.set(key, {
                        row: index,
                        name: item.name,
                        core: item.core,
                    })
            }
    })
    const vacancy = new Map<string, VacancySkill>()
    for (const skill of input.vacancySkills) {
        const key = skillKey(skill.name)
        const before = vacancy.get(key)
        if (key && (!before || (skill.required && !before.required)))
            vacancy.set(key, {
                name: skill.name.trim().slice(0, 80),
                required: skill.required || (before?.required ?? false),
            })
    }
    const named = new Map(
        input.vacancyTechnologies.map(name => [
            skillKey(name),
            name.trim().slice(0, 80),
        ]),
    )

    const result: TailoredSkillRow[] = rows.map(row => ({
        label: row.label.slice(0, 60),
        items: [],
    }))
    const used = new Set<string>()
    const place = (row: number, key: string, fallback: string) => {
        const target = result[row]
        if (!key || used.has(key) || !target) return
        used.add(key)
        const fromVacancy = vacancy.get(key)
        const own = profile.get(key)
        target.items.push({
            name: fromVacancy?.name ?? own?.name ?? named.get(key) ?? fallback,
            priority: fromVacancy ? (fromVacancy.required ? 100 : 80) : named.has(key) ? 70 : own?.core ? 60 : 30,
        })
    }

    const labels = rows.map(row => row.label.trim().toLowerCase())
    for (const answer of input.model) {
        const row = labels.indexOf(answer.label.trim().toLowerCase())
        if (row < 0) continue
        for (const item of answer.items) {
            const key = skillKey(item)
            if (profile.has(key) || vacancy.has(key) || named.has(key)) place(row, key, item.trim().slice(0, 80))
        }
    }
    rows.forEach((row, index) => {
        for (const item of row.items) place(index, skillKey(item.name), item.name)
    })
    for (const [key, skill] of vacancy)
        if (!used.has(key))
            place(
                profile.get(key)?.row
                    ?? guessRow(
                        skill.name,
                        rows.map(row => row.label),
                    ),
                key,
                skill.name,
            )

    return result
        .map(row => ({
            label: row.label,
            items: row.items
                .map((item, index) => ({
                    item,
                    index,
                }))
                .sort((a, b) => b.item.priority - a.item.priority || a.index - b.index)
                .map(({ item }) => item)
                .slice(0, ITEMS_MAX),
        }))
        .filter(row => row.items.length)
}

/** Vacancy skills no row of `rows` has (by key): empty when D-118 holds. */
export const missingSkills = (rows: TailoredSkillRow[], vacancySkills: VacancySkill[]) => {
    const keys = new Set(rows.flatMap(row => row.items.map(item => skillKey(item.name))))
    return vacancySkills.filter(skill => skillKey(skill.name) && !keys.has(skillKey(skill.name)))
}
