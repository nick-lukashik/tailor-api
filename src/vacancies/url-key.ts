/** Query params that only say where a click came from, never which vacancy. */
const trackingParams = new Set([
    'gclid',
    'fbclid',
    'ref',
    'source',
    'src',
    'trk',
])

const isTracking = (name: string) => {
    const lower = name.toLowerCase()
    return lower.startsWith('utm_') || trackingParams.has(lower)
}

/**
 * The key a vacancy link is found again by: scheme and host lowercased, no
 * `www.`, no fragment, no credentials, no tracking params, the rest sorted, no
 * trailing slash. Only http and https; anything else throws.
 */
export function vacancyUrlKey(input: string): string {
    const url = new URL(input)
    const scheme = url.protocol.toLowerCase()
    if (scheme !== 'http:' && scheme !== 'https:') throw new Error(`not an http(s) link: ${scheme}`)
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    const port = url.port ? `:${url.port}` : ''
    const path = url.pathname.replace(/\/+$/, '')
    const params = [
        ...url.searchParams,
    ]
        .filter(([name]) => !isTracking(name))
        .sort(([a, x], [b, y]) => (a === b ? compare(x, y) : compare(a, b)))
    const query = new URLSearchParams(params).toString()
    return `${scheme}//${host}${port}${path}${query ? `?${query}` : ''}`
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
