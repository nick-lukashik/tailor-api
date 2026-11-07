/**
 * The file name of a CV: `Nick-Lukashik-Senior-Full-Stack-Engineer-CV.pdf`.
 * Words of the owner's name and the role, each capitalized, joined by dashes;
 * anything but ASCII letters and digits separates words.
 */
export function cvFileName(owner: string, role: string): string {
    const words = `${owner} ${role}`
        .split(/[^A-Za-z0-9]+/)
        .filter(Boolean)
        .map(word => word[0]?.toUpperCase() + word.slice(1))
    return `${[
        ...words,
        'CV',
    ].join('-')}.pdf`
}
