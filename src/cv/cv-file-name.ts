/** The longest file name a CV gets (`cvs.file_name`). */
export const CV_FILE_NAME_MAX = 120

const SUFFIX = '-CV.pdf'

/** ASCII words: accents dropped (`Développeur` → `Developpeur`), anything but letters and digits separates. */
const words = (value: string) =>
    value
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .split(/[^A-Za-z0-9]+/)
        .filter(Boolean)
        .map(word => word[0]?.toUpperCase() + word.slice(1))

/**
 * The file name of a CV: `Nick-Lukashik-Senior-Full-Stack-Engineer-CV.pdf`.
 * Words of the owner's name and the role, each capitalized, joined by dashes;
 * ASCII only, at most 120 characters: the role loses its last words first.
 */
export function cvFileName(owner: string, role: string): string {
    const name: string[] = []
    for (const word of [
        ...words(owner),
        ...words(role),
    ]) {
        if (
            [
                ...name,
                word,
            ].join('-').length
                + SUFFIX.length
            > CV_FILE_NAME_MAX
        )
            break
        name.push(word)
    }
    return `${name.length ? name.join('-') : 'Resume'}${SUFFIX}`
}
