/*
 * The title of a tailored CV (its headline and file name): the model's
 * English role name for the vacancy where it holds, else the vacancy's own
 * title where it already is one, else the profile's headline. The candidate
 * is senior, so a title never carries an entry-level word.
 */

export const CV_TITLE_MAX = 60

/** Entry-level wording, English and Russian (`начинающий`, `джуниор`, `стажёр`). */
const ENTRY_LEVEL = /\b(junior|entry|beginners?|trainees?|interns?)\b|начинающ|джун|стаж[её]р/i

const PRINTABLE_ASCII = /^[\x20-\x7E]+$/

const clean = (value: string) =>
    value
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^["'`]+|["'`]+$/g, '')
        .trim()

/** The title when it holds: printable ASCII with a letter, at most 60 characters, no entry-level word. */
export function validCvTitle(value: string | null | undefined): string | undefined {
    const title = clean(value ?? '')
    if (!title || title.length > CV_TITLE_MAX || !PRINTABLE_ASCII.test(title) || !/[A-Za-z]/.test(title))
        return undefined
    if (ENTRY_LEVEL.test(title)) return undefined
    return title
}

/** A vacancy title in plain ASCII when it is English already: accents, typographic dashes and quotes made plain. */
export const normalizedVacancyTitle = (value: string | null | undefined) =>
    clean(
        (value ?? '')
            .normalize('NFKD')
            .replace(/[̀-ͯ]/g, '')
            .replace(/[‐-―]/g, '-')
            .replace(/[‘’]/g, "'")
            .replace(/[“”]/g, '"'),
    )

/** The CV's title: the model's proposal, else the vacancy's title in English, else the profile's headline. */
export const cvTitle = (input: { proposed: string; vacancyTitle: string | null | undefined; headline: string }) =>
    validCvTitle(input.proposed)
    ?? validCvTitle(normalizedVacancyTitle(input.vacancyTitle))
    ?? clean(input.headline).slice(0, 120).trim()
