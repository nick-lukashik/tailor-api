import type { ParsedVacancy } from '../vacancies/parse.schemas.js'
import type { FormAnswer } from './form-answers.js'
import type { MaterialsAnswer, MaterialsContent, MaterialsLanguage } from './materials.schemas.js'

/** Where the model puts the CV link; the code writes the real one in. */
export const CV_LINK_PLACEHOLDER = '{cvUrl}'

export const TELEGRAM_MAX = 600
export const LINKEDIN_MAX = 300
const SUBJECT_MAX = 150
const WHY_ME_COUNT = 3

/**
 * Russian when the vacancy is: its parsed language, or, when the parse gave
 * none, a text written mostly in Cyrillic. Everything else is English.
 */
export function materialsLanguage(parsed: Pick<ParsedVacancy, 'language'>, rawText: string): MaterialsLanguage {
    const language = parsed.language?.trim().toLowerCase()
    if (language) return language.startsWith('ru') ? 'ru' : 'en'
    const letters = rawText.match(/\p{L}/gu) ?? []
    if (letters.length === 0) return 'en'
    const cyrillic = letters.filter(letter => /\p{Script=Cyrillic}/u.test(letter)).length
    return cyrillic / letters.length > 0.5 ? 'ru' : 'en'
}

/** No long dash in any text: a spaced one becomes a comma, a bare one a hyphen. */
const plain = (value: string) =>
    value
        .replace(/\s+[—–]\s+/g, ', ')
        .replace(/[—–]/g, '-')
        .trim()

const withLink = (value: string, url: string) => value.split(CV_LINK_PLACEHOLDER).join(url)

/** At most `max` characters: the last whole sentence that keeps half of them, else the last whole word and `…`. */
export function clip(value: string, max: number): string {
    if (value.length <= max) return value
    const cut = value.slice(0, max)
    const sentenceEnd = Math.max(
        ...[
            ...cut.matchAll(/[.!?)](?=\s|$)/g),
        ].map(match => match.index + 1),
        -1,
    )
    if (sentenceEnd >= max / 2) return cut.slice(0, sentenceEnd).trimEnd()
    const word = value.slice(0, max - 1).replace(/\s+\S*$/, '')
    return `${word.trimEnd()}…`
}

/**
 * The text with the link in it, at most `max` characters. When it is longer,
 * the text without the link is clipped and the link goes on its own line at
 * the end, so it is never cut. `required`: the link is added when the model left it out.
 */
export function fitWithLink(template: string, url: string, max: number, required: boolean): string {
    const source =
        required && !template.includes(CV_LINK_PLACEHOLDER) ? `${template}\n\n${CV_LINK_PLACEHOLDER}` : template
    const full = withLink(source, url)
    if (full.length <= max) return full
    if (!source.includes(CV_LINK_PLACEHOLDER)) return clip(full, max)
    const rest = source
        .split(CV_LINK_PLACEHOLDER)
        .join('')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    return `${clip(rest, Math.max(0, max - url.length - 2))}\n\n${url}`
}

/** The model's answer as stored: plain text, the CV link in, the limits kept, three points of why me. */
export function finishMaterials(
    answer: MaterialsAnswer,
    context: {
        cvUrl: string
        language: MaterialsLanguage
        /** The answers to the apply form, already finished (`formAnswers`). */
        answers?: FormAnswer[]
    },
): MaterialsContent {
    const { cvUrl } = context
    return {
        language: context.language,
        coverLetter: withLink(plain(answer.coverLetter), cvUrl),
        emailSubject: clip(plain(answer.emailSubject).replace(/\s+/g, ' '), SUBJECT_MAX),
        emailBody: fitWithLink(plain(answer.emailBody), cvUrl, Number.POSITIVE_INFINITY, true),
        telegramMessage: fitWithLink(plain(answer.telegramMessage), cvUrl, TELEGRAM_MAX, true),
        linkedinNote: fitWithLink(plain(answer.linkedinNote), cvUrl, LINKEDIN_MAX, false),
        whyMe: answer.whyMe
            .map(point => withLink(plain(point).replace(/^[-•*]\s*/, ''), cvUrl))
            .filter(Boolean)
            .slice(0, WHY_ME_COUNT),
        answers: context.answers ?? [],
    }
}
