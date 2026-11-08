import type { ErrorDetail } from '../common/http/app-error.js'
import type { ProfileDocument } from '../profile/profile.schemas.js'
import { type CvDocument, cvDocumentSchema } from '../tex/cv-document.js'

/*
 * The master CV: the profile as it is, without a vacancy and without a model
 * (notes tailor/02-cv, "Мастер-CV"). Ported from Atelier's assemble and
 * selection, only what needs no vacancy: the general template (no AI-only
 * employments), each employment's general quota, one bullet per achievement
 * group, the full variant of every case, the profile's own order.
 */

const MONTHS = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
]

/** `2024-03` → `Mar 2024`. */
export function cvMonth(value: string) {
    const [year, month] = value.split('-')
    return `${MONTHS[Number(month) - 1] ?? ''} ${year ?? ''}`.trim()
}

/** `Mar 2022 – Present`, `Feb 2019 – Feb 2022`. */
export const cvDates = (start: string, end: string | null) => `${cvMonth(start)} – ${end ? cvMonth(end) : 'Present'}`

function educationDates(start?: string, end?: string) {
    if (start && end) return `${cvMonth(start)} – ${cvMonth(end)}`
    if (end) return cvMonth(end)
    if (start) return `${cvMonth(start)} – Present`
    return ''
}

const LANGUAGE_LEVELS: Record<ProfileDocument['languages'][number]['level'], string> = {
    native: 'Native',
    c2: 'C2',
    c1: 'C1',
    b2: 'B2',
    b1: 'B1',
    a2: 'A2',
    a1: 'A1',
    none: '',
}

/** Bullet ids are the measured blocks of tailor-tex (`bullet:<id>`), at most 40 characters. */
const BULLET_ID_MAX = 40

/** The name in English (CVs are English only, D-99), else the first one given. */
export function cvName(profile: ProfileDocument) {
    const name = profile.person.names.find(item => item.locale === 'en') ?? profile.person.names[0]
    return name ? `${name.firstName} ${name.lastName}`.trim() : ''
}

/** The first target role's headline, else the profile's own. */
export const cvHeadline = (profile: ProfileDocument) =>
    profile.career.targetRoles[0]?.headline ?? profile.career.headline

/** `https://github.com/example/` → `github.com/example`. */
const linkText = (url: string) =>
    url
        .replace(/^(https?:\/\/(www\.)?|mailto:|tg:\/\/resolve\?domain=)/, '')
        .replace(/\/+$/, '')
        .slice(0, 120)

function links(profile: ProfileDocument): CvDocument['links'] {
    const { email, telegram } = profile.person
    const own = profile.person.links.map(link => ({
        url: link.url,
        text: link.label || linkText(link.url),
    }))
    const hasEmail = own.some(link => link.url.startsWith('mailto:'))
    const hasTelegram = profile.person.links.some(link => link.kind === 'telegram')
    return [
        ...(email && !hasEmail
            ? [
                  {
                      url: `mailto:${email}`,
                      text: email,
                  },
              ]
            : []),
        ...own,
        ...(telegram && !hasTelegram
            ? [
                  {
                      url: `https://t.me/${telegram}`,
                      text: `t.me/${telegram}`,
                  },
              ]
            : []),
    ].slice(0, 8)
}

/** Employments a general CV prints, by `order`, then by their place in the profile. */
export const cvEmployments = (profile: ProfileDocument) =>
    profile.employments
        .map((employment, index) => ({
            employment,
            index,
        }))
        .filter(({ employment }) => !employment.aiOnly)
        .sort((a, b) => a.employment.order - b.employment.order || a.index - b.index)

function jobs(profile: ProfileDocument): CvDocument['jobs'] {
    const caseIndex = new Map(
        profile.cases.map((item, index) => [
            item.id,
            index,
        ]),
    )
    const usedGroups = new Set<string>()
    return cvEmployments(profile).map(({ employment, index }) => {
        const quota = employment.quota ? employment.quota.general.target : Number.POSITIVE_INFINITY
        const picked: ProfileDocument['cases'] = []
        for (const item of profile.cases) {
            if (picked.length >= quota) break
            if (item.employmentId !== employment.id || !item.active) continue
            if (item.achievementGroup && usedGroups.has(item.achievementGroup)) continue
            if (item.achievementGroup) usedGroups.add(item.achievementGroup)
            picked.push(item)
        }
        const bullets = [
            ...employment.fixedBullets.map((text, position) => ({
                id: `fixed-${index}-${position}`,
                text,
            })),
            ...picked.map(item => ({
                id: item.id.length <= BULLET_ID_MAX ? item.id : `case-${caseIndex.get(item.id) ?? 0}`,
                text: item.variants.full,
            })),
        ]
        return {
            title: employment.title,
            company: employment.company.name,
            dates: cvDates(employment.start, employment.end),
            location: employment.location,
            description: employment.company.description,
            bullets: bullets.slice(0, 20),
        }
    })
}

const unique = (values: string[]) => [
    ...new Set(values),
]

/**
 * The master CV document for tailor-tex. Pure and deterministic; texts are
 * the profile's own, as written. Counts are cut to the template's limits;
 * a missing or too long value is left for `masterCvIssues` to report.
 */
export function buildMasterCv(profile: ProfileDocument): CvDocument {
    const name = cvName(profile)
    const headline = cvHeadline(profile)
    const { city, country } = profile.person.location
    return {
        name,
        location: [
            city,
            country,
        ]
            .filter(Boolean)
            .join(', '),
        phoneDisplay: profile.person.phone?.display ?? '',
        phoneDigits: profile.person.phone?.e164 ?? '',
        headline,
        stack: profile.career.stackLine,
        links: links(profile),
        summary: profile.summary
            .map(item => item.full || item.compact)
            .filter(Boolean)
            .slice(0, 2),
        skills: profile.skills
            .map(row => ({
                label: row.label,
                items: row.items.map(item => item.name).slice(0, 40),
            }))
            .filter(row => row.items.length)
            .slice(0, 14),
        jobs: jobs(profile).slice(0, 10),
        education: profile.education.degrees.slice(0, 4).map(degree => ({
            degree: [
                degree.degree,
                degree.field,
            ]
                .filter(Boolean)
                .join(' in '),
            school: degree.institution,
            dates: educationDates(degree.start, degree.end),
        })),
        languages: profile.languages
            .filter(language => language.level !== 'none')
            .slice(0, 6)
            .map(language => ({
                name: language.name,
                level: language.note || LANGUAGE_LEVELS[language.level],
            })),
        pdf: {
            title: '',
            subject: headline ? `${headline} CV` : '',
            keywords: unique(
                profile.skills.flatMap(row => row.items.filter(item => item.core).map(item => item.name)),
            ).slice(0, 200),
        },
    }
}

/** Where in the profile each field of the CV comes from, for messages a person can act on. */
const PROFILE_SOURCE: Record<keyof CvDocument, string> = {
    name: 'person.names',
    location: 'person.location',
    phoneDisplay: 'person.phone',
    phoneDigits: 'person.phone',
    headline: 'career',
    stack: 'career.stackLine',
    links: 'person.links',
    summary: 'summary',
    skills: 'skills',
    jobs: 'employments',
    education: 'education.degrees',
    languages: 'languages',
    pdf: 'career',
}

/**
 * What keeps a document from tailor-tex (its schema): each issue at the
 * profile section it comes from, with the CV field in the message. Empty when
 * the document can be sent.
 */
export function masterCvIssues(document: CvDocument): ErrorDetail[] {
    const parsed = cvDocumentSchema.safeParse(document)
    if (parsed.success) return []
    return parsed.error.issues.map(issue => {
        const field = String(issue.path[0] ?? '') as keyof CvDocument
        const cvPath = issue.path.join('.')
        return {
            path: PROFILE_SOURCE[field] ?? '',
            message: `CV ${cvPath || 'document'}: ${issue.message}`,
        }
    })
}
