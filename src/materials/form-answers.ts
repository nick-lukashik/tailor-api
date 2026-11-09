import type { ProfileDocument } from '../profile/profile.schemas.js'
import type { ApplyField, ApplyForm } from '../vacancies/apply-form.js'

export type FormAnswer = {
    key: string
    label: string
    answer: string
}

const ANSWER_MAX = 4_000

const DECLINE = /decline|prefer not|don.?t wish|do not wish|not to (say|answer|disclose|self.?identify)|rather not/i

/** `cards[x][field0]`, `first_name`, `What is your LinkedIn URL?` → lowercase words. */
const words = (value: string) =>
    value
        .toLowerCase()
        .replace(/[_\-[\]().:?/]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()

const hasOptions = (field: ApplyField) =>
    field.type === 'select' || field.type === 'multiselect' || field.type === 'boolean'

/** The form's own wording of an answer among its options: exact, else the option that starts with it; else none. */
export function pickOption(options: string[], value: string): string | undefined {
    const wanted = value.trim().toLowerCase()
    if (!wanted) return undefined
    return (
        options.find(option => option.trim().toLowerCase() === wanted)
        ?? options.find(option => option.trim().toLowerCase().startsWith(wanted))
    )
}

const yesNo = (field: ApplyField, yes: boolean) => {
    const options = field.options ?? []
    if (options.length === 0) return yes ? 'Yes' : 'No'
    return pickOption(options, yes ? 'yes' : 'no') ?? ''
}

const nameOf = (profile: ProfileDocument) =>
    profile.person.names.find(name => name.locale === 'en') ?? profile.person.names[0]

const linkOf = (profile: ProfileDocument, ...kinds: string[]) =>
    profile.person.links.find(link => kinds.includes(link.kind))?.url ?? ''

function salaryOf(profile: ProfileDocument): string {
    const salary = profile.applicationFacts.salary[0]
    if (!salary) return ''
    const amount = `${salary.amount.toLocaleString('en-US')} ${salary.currency} per ${salary.period}`
    return [
        salary.basis ? `${amount}, ${salary.basis}` : amount,
        salary.contract ? `(${salary.contract})` : '',
    ]
        .filter(Boolean)
        .join(' ')
}

function noticeOf(profile: ProfileDocument): string {
    const weeks = profile.applicationFacts.noticePeriodWeeks
    if (weeks === undefined) return ''
    if (weeks === 0) return 'Available immediately'
    return `${weeks} ${weeks === 1 ? 'week' : 'weeks'}`
}

/**
 * The answer of a standard question straight from the profile (`person`,
 * `applicationFacts`): name, e-mail, phone, links, location, salary
 * expectation, notice period, sponsorship and the EEO ones (always declined).
 * Empty when the profile does not have it; undefined when the question is not
 * a standard one and the model answers it.
 */
export function standardAnswer(field: ApplyField, profile: ProfileDocument): string | undefined {
    const text = words(`${field.key} ${field.label}`)
    const label = words(field.label)
    const key = words(field.key)
    const { person, applicationFacts } = profile
    const name = nameOf(profile)

    if (/\b(gender|race|ethnicity|ethnic|veteran|disability|hispanic|latino|sexual orientation)\b/.test(text))
        return field.options?.find(option => DECLINE.test(option)) ?? (hasOptions(field) ? '' : 'Prefer not to say')
    if (/\b(first ?name|given name|fname)\b/.test(text)) return name?.firstName ?? ''
    if (/\b(last ?name|surname|family name|lname)\b/.test(text)) return name?.lastName ?? ''
    if (
        key === 'name'
        || [
            'name',
            'full name',
            'your name',
            'legal name',
            'full legal name',
        ].includes(label)
    )
        return name ? `${name.firstName} ${name.lastName}`.trim() : ''
    if (/\be ?mail\b/.test(text)) return person.email ?? ''
    if (/\b(phone|mobile|telephone)\b/.test(text)) return person.phone?.display ?? ''
    if (/linkedin/.test(text)) return linkOf(profile, 'linkedin')
    if (/github/.test(text)) return linkOf(profile, 'github')
    if (/telegram/.test(text)) return person.telegram ? `@${person.telegram}` : ''
    if (/\b(website|portfolio|personal site|homepage)\b/.test(text)) return linkOf(profile, 'website', 'portfolio')
    if (/\bsalary\b|\b(expected|desired) (pay|rate|compensation)\b|\bcompensation expectations?\b/.test(text))
        return hasOptions(field) ? undefined : salaryOf(profile)
    if (/\bnotice\b/.test(text)) return hasOptions(field) ? undefined : noticeOf(profile)
    if (/\bsponsor/.test(text)) {
        const needs = applicationFacts.workAuthorization.needsSponsorship
        return needs === undefined ? undefined : yesNo(field, needs)
    }
    if (hasOptions(field)) return undefined
    if (/\bcountry\b/.test(text) && !/\bauthori[sz]/.test(text))
        return /\bresiden/.test(text) ? (person.residence[0] ?? person.location.country) : person.location.country
    if (/^(current )?(location|city)\b|\bwhere are you (based|located)\b|\bcurrent location\b/.test(label))
        return [
            person.location.city,
            person.location.country,
        ]
            .filter(Boolean)
            .join(', ')
    return undefined
}

/** The questions the model answers: neither a file nor a standard one. */
export function freeQuestions(form: ApplyForm | null, profile: ProfileDocument): ApplyField[] {
    return (form?.fields ?? []).filter(field => field.type !== 'file' && standardAnswer(field, profile) === undefined)
}

/** A model's answer as stored: plain, clipped, and for a field with options only its options. */
function cleanAnswer(field: ApplyField, answer: string): string {
    const plain = answer
        .replace(/\s+[—–]\s+/g, ', ')
        .replace(/[—–]/g, '-')
        .trim()
        .slice(0, ANSWER_MAX)
    if (!hasOptions(field)) return plain
    const options =
        field.options
        ?? (field.type === 'boolean'
            ? [
                  'Yes',
                  'No',
              ]
            : [])
    if (field.type !== 'multiselect') return pickOption(options, plain) ?? ''
    return [
        ...new Set(
            plain
                .split(/[;\n]/)
                .map(part => pickOption(options, part))
                .filter(part => part !== undefined),
        ),
    ].join('; ')
}

/**
 * An answer for every field of the form but files, in its order: the
 * standard ones from the profile, the rest as the model wrote them (empty
 * when it gave none or one outside the field's options).
 */
export function formAnswers(
    form: ApplyForm | null,
    profile: ProfileDocument,
    written: {
        key: string
        answer: string
    }[],
): FormAnswer[] {
    const byKey = new Map(
        written.map(item => [
            item.key,
            item.answer,
        ]),
    )
    return (form?.fields ?? [])
        .filter(field => field.type !== 'file')
        .map(field => ({
            key: field.key,
            label: field.label,
            answer: standardAnswer(field, profile) ?? cleanAnswer(field, byKey.get(field.key) ?? ''),
        }))
}
