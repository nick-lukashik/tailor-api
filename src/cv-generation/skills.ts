import type { ProfileDocument } from '../profile/profile.schemas.js'

/*
 * The skill rows of a tailored CV (02_ADAPTATION_WORKFLOW §11, Work Finder's
 * skills policy, D-118): the rows and labels of the profile, the model's
 * order, the vacancy's spelling when it is English, every skill the vacancy
 * lists in the most fitting row, each once, nothing invented.
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

/** Printable ASCII: an English CV prints no other script (`unit-тесты` is not a skill name). */
export const isAscii = (value: string) => /^[\x20-\x7E]+$/.test(value)

/** The technologies a combined item names: `Python (FastAPI)` → `Python`, `FastAPI`; a plain item has none. */
export function skillParts(name: string): string[] {
    const match = name.trim().match(/^([^()]+)\(([^()]+)\)$/)
    if (!match?.[1] || !match[2]) return []
    return [
        match[1],
        ...match[2].split(','),
    ]
        .map(part => part.trim())
        .filter(Boolean)
}

/** Every key an item stands for: its own and, for a combined one, its parts'. */
const coveredKeys = (name: string) =>
    [
        name,
        ...skillParts(name),
    ]
        .map(skillKey)
        .filter(Boolean)

export type VacancySkill = {
    name: string
    required: boolean
    /** The row label the model placed it in, when it did. */
    row?: string
}

/** The model's reading of one vacancy skill: its English name and row, an empty row when it is not a skill. */
export type ClassifiedSkill = {
    name: string
    english: string
    row: string
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
        /node|nest|express|java\b|kotlin|\bgo\b|golang|python|django|flask|fastapi|php|laravel|ruby|rails|rust|c#|\.net|spring|graphql|rest|grpc|api|microservice|webhook|oauth|jwt|\basync|aiohttp|celery|pydantic|sqlalchemy|alembic|uvicorn|gunicorn|\bhttp|websocket/i,
    ],
    [
        /data|database|storage|messag/i,
        /sql|postgres|mysql|mongo|redis|kafka|rabbit|elastic|clickhouse|dynamo|cassandra|queue|bigquery|snowflake|vector|database/i,
    ],
    [
        /cloud|devops|infra|ops|observ|platform/i,
        /aws|gcp|azure|docker|kubernetes|k8s|terraform|helm|\bci\b|\bcd\b|actions|gitlab|jenkins|linux|prometheus|grafana|sentry|datadog|cloudflare|serverless|lambda|observability|\bgit\b|github|nginx|bash/i,
    ],
    [
        /test|quality|\bqa\b/i,
        /test|jest|vitest|playwright|cypress|selenium|\bqa\b|tdd|\bunit\b|e2e|review/i,
    ],
]

/** A technology or engineering practice by its kind: a skill even when the model reads it as none. */
const looksTechnical = (name: string) => ROW_KINDS.some(([, item]) => item.test(name))

/** Phrases that are no technology or practice, when the model gives no reading of them. */
const NOT_A_SKILL =
    /^(team ?work|team player|communication( skills)?|soft skills|responsibility|proactiv\w*|problem[\s-]solving|attention to detail|self[\s-]motivat\w*|english|leadership)$/i

/** The row a skill fits best by its kind, else the backend row, else the last row. */
function guessRow(name: string, labels: string[]): number {
    for (const [label, item] of ROW_KINDS) {
        if (!item.test(name)) continue
        const index = labels.findIndex(value => label.test(value))
        if (index >= 0) return index
    }
    const backend = labels.findIndex(value => /back|server/i.test(value))
    return backend >= 0 ? backend : labels.length - 1
}

/**
 * The vacancy's skills as the CV prints them: in English (the vacancy's own
 * spelling when it is English already, else the model's English name, else
 * left out), with the row the model placed each in; a phrase that is no
 * technology or practice (the model's empty row, or teamwork without a
 * reading) is left out unless the profile has it or it reads as one.
 */
export function normalizeVacancySkills(
    vacancySkills: VacancySkill[],
    classified: ClassifiedSkill[],
    rows: SkillRow[],
): VacancySkill[] {
    const readings = new Map(
        classified.map(entry => [
            entry.name.trim().toLowerCase(),
            entry,
        ]),
    )
    const profileKeys = new Set(
        rows.flatMap(row =>
            row.items.flatMap(item => [
                ...coveredKeys(item.name),
                ...item.aliases.map(skillKey),
            ]),
        ),
    )
    const result: VacancySkill[] = []
    for (const skill of vacancySkills) {
        const original = skill.name.trim()
        const reading = readings.get(original.toLowerCase())
        const english = reading?.english.trim() ?? ''
        const name = isAscii(original) ? original : isAscii(english) ? english : ''
        if (!name || !skillKey(name)) continue
        const notASkill = reading ? !reading.row.trim() : NOT_A_SKILL.test(name)
        if (notASkill && !looksTechnical(name) && !coveredKeys(name).some(key => profileKeys.has(key))) continue
        result.push({
            name: name.slice(0, 80),
            required: skill.required,
            ...(reading?.row.trim()
                ? {
                      row: reading.row.trim(),
                  }
                : {}),
        })
    }
    return result
}

type Entity = {
    /** The profile row it belongs to, -1 for a skill only the vacancy has. */
    row: number
    name: string
    core: boolean
    keys: string[]
}

/**
 * The CV's skill rows: the profile's rows (`rows`, already without the
 * AI-only ones outside an AI role) in their order with their labels; the
 * model's items for a row when it names a skill of the profile or one the
 * vacancy names, in the vacancy's spelling; then every profile item the
 * model left out; then every vacancy skill still missing, in the row of the
 * profile item it is a spelling of, else the row the model placed it in,
 * else the row its kind fits (D-118). Only ASCII names; one item per skill,
 * case and spelling aside: `Python (FastAPI)` covers Python and FastAPI,
 * split into both when the vacancy lists them separately. Items are ordered
 * by priority, the model's order within one priority.
 */
export function tailorSkills(input: {
    rows: SkillRow[]
    model: {
        label: string
        items: string[]
    }[]
    /** The vacancy's skills, normalized (`normalizeVacancySkills`). */
    vacancySkills: VacancySkill[]
    /** Technologies the requirements name: allowed, not required. */
    vacancyTechnologies: string[]
}): TailoredSkillRow[] {
    const { rows } = input
    const vacancy = new Map<string, VacancySkill>()
    for (const skill of input.vacancySkills) {
        const name = skill.name.trim().slice(0, 80)
        const key = skillKey(name)
        const before = vacancy.get(key)
        if (key && isAscii(name) && (!before || (skill.required && !before.required)))
            vacancy.set(key, {
                ...(before ?? skill),
                name: before?.name ?? name,
                required: skill.required || (before?.required ?? false),
            })
    }
    const named = new Map(
        input.vacancyTechnologies
            .map(name => name.trim().slice(0, 80))
            .filter(name => name && isAscii(name))
            .map(name => [
                skillKey(name),
                name,
            ]),
    )

    const entities: Entity[] = []
    const byKey = new Map<string, number>()
    const add = (entity: Entity) => {
        const keys = entity.keys.filter(Boolean)
        const known = keys.map(key => byKey.get(key))
        if (keys.length && known.every(id => id !== undefined)) return known[0] as number
        const id = entities.push(entity) - 1
        for (const key of keys) if (!byKey.has(key)) byKey.set(key, id)
        return id
    }
    const profileIds: number[] = []
    rows.forEach((row, index) => {
        for (const item of row.items) {
            if (!isAscii(item.name)) continue
            const parts = skillParts(item.name)
            const split = parts.filter(part => vacancy.has(skillKey(part))).length >= 2
            const own = split
                ? parts.map(part => ({
                      row: index,
                      name: part,
                      core: item.core,
                      keys: [
                          skillKey(part),
                      ],
                  }))
                : [
                      {
                          row: index,
                          name: item.name,
                          core: item.core,
                          keys: [
                              ...coveredKeys(item.name),
                              ...item.aliases.map(skillKey),
                          ],
                      },
                  ]
            for (const entity of own) {
                const id = add(entity)
                if (!profileIds.includes(id)) profileIds.push(id)
            }
        }
    })
    /** The entity of a key: the profile's, else a new one for a skill only the vacancy names. */
    const resolve = (key: string) => {
        const known = byKey.get(key)
        if (known !== undefined) return known
        const name = vacancy.get(key)?.name ?? named.get(key)
        if (!key || !name) return undefined
        return add({
            row: -1,
            name,
            core: false,
            keys: [
                key,
            ],
        })
    }
    const display = (entity: Entity) => {
        if (skillParts(entity.name).length) return entity.name
        const spelled = entity.keys.find(key => vacancy.has(key))
        return (spelled && vacancy.get(spelled)?.name) || entity.name
    }
    const priority = (entity: Entity) => {
        const listed = entity.keys.map(key => vacancy.get(key)).filter(skill => skill !== undefined)
        if (listed.some(skill => skill.required)) return 100
        if (listed.length) return 80
        if (entity.keys.some(key => named.has(key))) return 70
        return entity.core ? 60 : 30
    }

    const result: TailoredSkillRow[] = rows.map(row => ({
        label: row.label.slice(0, 60),
        items: [],
    }))
    const used = new Set<number>()
    const place = (row: number, id: number | undefined) => {
        const target = result[row]
        const entity = id === undefined ? undefined : entities[id]
        if (id === undefined || !entity || used.has(id) || !target) return
        used.add(id)
        target.items.push({
            name: display(entity).slice(0, 80),
            priority: priority(entity),
        })
    }

    const labels = rows.map(row => row.label.trim().toLowerCase())
    for (const answer of input.model) {
        const row = labels.indexOf(answer.label.trim().toLowerCase())
        if (row < 0) continue
        for (const item of answer.items) {
            const name = item.trim()
            if (!name || !isAscii(name)) continue
            const key = skillKey(name)
            if (byKey.has(key) || vacancy.has(key) || named.has(key)) place(row, resolve(key))
            else for (const part of skillParts(name)) place(row, byKey.get(skillKey(part)))
        }
    }
    for (const id of profileIds) place(entities[id]?.row ?? -1, id)
    for (const [key, skill] of vacancy) {
        const id = resolve(key)
        if (id === undefined || used.has(id)) continue
        const parts = skillParts(skill.name).map(part => byKey.get(skillKey(part)))
        if (parts.length && parts.every(part => part !== undefined && used.has(part))) continue
        const hinted = skill.row ? labels.indexOf(skill.row.trim().toLowerCase()) : -1
        const own = entities[id]?.row ?? -1
        place(own >= 0 ? own : hinted >= 0 ? hinted : guessRow(skill.name, labels), id)
    }

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

/** Vacancy skills no row of `rows` covers (by key, a combined item covering its parts): empty when D-118 holds. */
export const missingSkills = (rows: TailoredSkillRow[], vacancySkills: VacancySkill[]) => {
    const keys = new Set(rows.flatMap(row => row.items.flatMap(item => coveredKeys(item.name))))
    return vacancySkills.filter(skill => {
        const key = skillKey(skill.name)
        if (!key || keys.has(key)) return false
        const parts = skillParts(skill.name).map(skillKey)
        return !(parts.length && parts.every(part => keys.has(part)))
    })
}

/** The keys of the technologies a text names: single words and pairs (`Google Cloud`). */
export function textSkillKeys(text: string): Set<string> {
    const words = text
        .replace(/\*\*/g, '')
        .split(/[\s,;:()/]+/)
        .map(word => word.replace(/[.!?]+$/, ''))
        .filter(Boolean)
    return new Set(
        words
            .flatMap((word, index) => [
                word,
                index + 1 < words.length ? `${word} ${words[index + 1]}` : '',
            ])
            .map(skillKey)
            .filter(Boolean),
    )
}

/** The vacancy's stack a case lists among its technologies, in the vacancy's spelling. */
export function matchingStack(technologies: string[], stack: string[]): string[] {
    const own = new Set(technologies.flatMap(coveredKeys))
    const seen = new Set<string>()
    return stack.filter(name => {
        const key = skillKey(name)
        if (!key || seen.has(key) || !own.has(key)) return false
        seen.add(key)
        return true
    })
}
