import { lookup as dnsLookup } from 'node:dns/promises'
import { request as httpRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { BlockList, isIP, type LookupFunction } from 'node:net'
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib'

/** A page or an API answer could not be read; `code` is short and safe to store and log. */
export class FetchError extends Error {
    constructor(
        readonly code: string,
        readonly retryable: boolean,
    ) {
        super(code)
        this.name = 'FetchError'
    }
}

export const FETCH_TIMEOUT_MS = 15_000
export const FETCH_MAX_BYTES = 5 * 1024 * 1024
export const FETCH_MAX_REDIRECTS = 5

const BROWSER_HEADERS = {
    'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    'accept-language': 'en-US,en;q=0.9',
    'accept-encoding': 'gzip, deflate, br',
}

const ACCEPT = {
    html: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    json: 'application/json',
}

/** Addresses a fetch never connects to: loopback, private, link-local, CGNAT, multicast, reserved. */
const blocked = new BlockList()
for (const [network, prefix] of [
    [
        '0.0.0.0',
        8,
    ],
    [
        '10.0.0.0',
        8,
    ],
    [
        '100.64.0.0',
        10,
    ],
    [
        '127.0.0.0',
        8,
    ],
    [
        '169.254.0.0',
        16,
    ],
    [
        '172.16.0.0',
        12,
    ],
    [
        '192.0.0.0',
        24,
    ],
    [
        '192.0.2.0',
        24,
    ],
    [
        '192.168.0.0',
        16,
    ],
    [
        '198.18.0.0',
        15,
    ],
    [
        '198.51.100.0',
        24,
    ],
    [
        '203.0.113.0',
        24,
    ],
    [
        '224.0.0.0',
        4,
    ],
    [
        '240.0.0.0',
        4,
    ],
] as const)
    blocked.addSubnet(network, prefix, 'ipv4')
for (const [network, prefix] of [
    [
        '::',
        128,
    ],
    [
        '::1',
        128,
    ],
    [
        '64:ff9b::',
        96,
    ],
    [
        '100::',
        64,
    ],
    [
        '2001:db8::',
        32,
    ],
    [
        'fc00::',
        7,
    ],
    [
        'fe80::',
        10,
    ],
    [
        'fec0::',
        10,
    ],
    [
        'ff00::',
        8,
    ],
] as const)
    blocked.addSubnet(network, prefix, 'ipv6')

/** Whether an IP address is on the public internet (an IPv4-mapped IPv6 one is judged as IPv4). */
export function isPublicAddress(address: string): boolean {
    const bare = address.replace(/^\[|\]$/g, '').replace(/%.*$/, '')
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(bare)?.[1]
    const ip = mapped ?? bare
    const family = isIP(ip)
    if (family === 0) return false
    return !blocked.check(ip, family === 4 ? 'ipv4' : 'ipv6')
}

export type ResolvedAddress = {
    address: string
    family: number
}

export type FetchGuard = {
    /** May the fetch connect to this address? Default: public addresses only. */
    isAllowed: (address: string) => boolean
    /** DNS; every address of a host must be allowed. */
    resolve: (hostname: string) => Promise<ResolvedAddress[]>
}

export const publicOnly: FetchGuard = {
    isAllowed: isPublicAddress,
    resolve: hostname =>
        dnsLookup(hostname, {
            all: true,
            verbatim: true,
        }),
}

export type FetchRequest = {
    accept: keyof typeof ACCEPT
    signal?: AbortSignal
    timeoutMs?: number
    maxBytes?: number
    maxRedirects?: number
}

export type FetchedResponse = {
    /** The URL after redirects. */
    url: string
    status: number
    contentType: string
    body: string
}

/** A lookup for `http.request` that resolves once and refuses a host with any address not allowed. */
function guardedLookup(guard: FetchGuard): LookupFunction {
    return (hostname, options, callback) => {
        guard.resolve(hostname).then(
            addresses => {
                if (addresses.length === 0 || addresses.some(item => !guard.isAllowed(item.address))) {
                    callback(new FetchError('blocked_address', false), '', 0)
                    return
                }
                const family = options.family === 6 || options.family === 4 ? options.family : undefined
                const usable = family ? addresses.filter(item => item.family === family) : addresses
                if (options.all) {
                    callback(null, usable)
                    return
                }
                const first = usable[0]
                if (!first) callback(new FetchError('dns_failed', false), '', 0)
                else callback(null, first.address, first.family)
            },
            (error: NodeJS.ErrnoException) =>
                callback(
                    new FetchError(
                        error.code === 'EAI_AGAIN' ? 'dns_failed' : 'dns_not_found',
                        error.code === 'EAI_AGAIN',
                    ),
                    '',
                    0,
                ),
        )
    }
}

const charsetOf = (contentType: string) => /charset\s*=\s*"?([\w.:-]+)"?/i.exec(contentType)?.[1]?.toLowerCase()

function decode(buffer: Buffer, contentType: string): string {
    const charset = charsetOf(contentType) ?? 'utf-8'
    try {
        return new TextDecoder(charset).decode(buffer)
    } catch {
        return new TextDecoder('utf-8').decode(buffer)
    }
}

const networkError = (error: unknown): FetchError => {
    if (error instanceof FetchError) return error
    const code = (error as NodeJS.ErrnoException | undefined)?.code ?? ''
    if (code.startsWith('ERR_TLS') || code.includes('CERT') || code === 'DEPTH_ZERO_SELF_SIGNED_CERT')
        return new FetchError('tls_failed', false)
    return new FetchError('network', true)
}

/** One hop: the status, headers and (for a 2xx) the body, within the byte limit. */
function hop(
    url: URL,
    request: Required<Omit<FetchRequest, 'signal' | 'maxRedirects' | 'timeoutMs'>>,
    signal: AbortSignal,
    guard: FetchGuard,
): Promise<{
    status: number
    location: string | undefined
    contentType: string
    body: Buffer
}> {
    return new Promise((resolve, reject) => {
        const send = url.protocol === 'https:' ? httpsRequest : httpRequest
        const req = send(
            url,
            {
                method: 'GET',
                headers: {
                    ...BROWSER_HEADERS,
                    accept: ACCEPT[request.accept],
                },
                lookup: guardedLookup(guard),
                signal,
            },
            (res: IncomingMessage) => {
                const status = res.statusCode ?? 0
                const location = res.headers.location
                const contentType = res.headers['content-type'] ?? ''
                if (status < 200 || status >= 300) {
                    res.resume()
                    resolve({
                        status,
                        location,
                        contentType,
                        body: Buffer.alloc(0),
                    })
                    return
                }
                const declared = Number(res.headers['content-length'])
                if (Number.isFinite(declared) && declared > request.maxBytes) {
                    res.destroy()
                    reject(new FetchError('too_large', false))
                    return
                }
                const encoding = (res.headers['content-encoding'] ?? '').toLowerCase().trim()
                const stream =
                    encoding === 'gzip' || encoding === 'x-gzip'
                        ? res.pipe(createGunzip())
                        : encoding === 'deflate'
                          ? res.pipe(createInflate())
                          : encoding === 'br'
                            ? res.pipe(createBrotliDecompress())
                            : res
                const chunks: Buffer[] = []
                let size = 0
                stream.on('data', (chunk: Buffer) => {
                    size += chunk.length
                    if (size > request.maxBytes) {
                        res.destroy()
                        stream.destroy()
                        reject(new FetchError('too_large', false))
                        return
                    }
                    chunks.push(chunk)
                })
                stream.on('end', () =>
                    resolve({
                        status,
                        location,
                        contentType,
                        body: Buffer.concat(chunks),
                    }),
                )
                stream.on('error', error =>
                    reject(signal.aborted ? new FetchError('timeout', true) : networkError(error)),
                )
                res.on('error', error => reject(signal.aborted ? new FetchError('timeout', true) : networkError(error)))
            },
        )
        req.on('error', error => reject(signal.aborted ? new FetchError('timeout', true) : networkError(error)))
        req.end()
    })
}

const isHttp = (url: URL) => url.protocol === 'http:' || url.protocol === 'https:'

/** A host given as an IP literal is checked here: `http.request` does not look it up. */
function checkLiteralHost(url: URL, guard: FetchGuard) {
    const host = url.hostname.replace(/^\[|\]$/g, '')
    if (isIP(host) !== 0 && !guard.isAllowed(host)) throw new FetchError('blocked_address', false)
}

/**
 * GET of a URL from the internet, safe against SSRF: http and https only,
 * every host resolved once and refused when any of its addresses is not
 * public (the connection goes to the checked address), at most 5 redirects
 * (each checked the same way), 15 s for all of it, at most 5 MB of body.
 * A non-2xx status is `http_<status>`; 429 and 5xx are retryable.
 */
export async function safeFetch(
    input: string,
    request: FetchRequest,
    guard: FetchGuard = publicOnly,
): Promise<FetchedResponse> {
    let url: URL
    try {
        url = new URL(input)
    } catch {
        throw new FetchError('bad_url', false)
    }
    const deadline = AbortSignal.timeout(request.timeoutMs ?? FETCH_TIMEOUT_MS)
    const signal = request.signal
        ? AbortSignal.any([
              request.signal,
              deadline,
          ])
        : deadline
    const options = {
        accept: request.accept,
        maxBytes: request.maxBytes ?? FETCH_MAX_BYTES,
    }
    const maxRedirects = request.maxRedirects ?? FETCH_MAX_REDIRECTS
    for (let redirects = 0; ; redirects++) {
        if (!isHttp(url) || url.username || url.password) throw new FetchError('bad_url', false)
        checkLiteralHost(url, guard)
        if (signal.aborted) throw new FetchError('timeout', true)
        const response = await hop(url, options, signal, guard)
        if (
            [
                301,
                302,
                303,
                307,
                308,
            ].includes(response.status)
            && response.location
        ) {
            if (redirects >= maxRedirects) throw new FetchError('too_many_redirects', false)
            try {
                url = new URL(response.location, url)
            } catch {
                throw new FetchError('bad_redirect', false)
            }
            continue
        }
        if (response.status < 200 || response.status >= 300)
            throw new FetchError(`http_${response.status}`, response.status === 429 || response.status >= 500)
        return {
            url: url.toString(),
            status: response.status,
            contentType: response.contentType.toLowerCase(),
            body: decode(response.body, response.contentType),
        }
    }
}

/** The JSON of an API answer, or `bad_response`. */
export function jsonOf(response: FetchedResponse): unknown {
    try {
        return JSON.parse(response.body)
    } catch {
        throw new FetchError('bad_response', false)
    }
}
