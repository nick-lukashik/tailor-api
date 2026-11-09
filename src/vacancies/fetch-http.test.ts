import { createServer, type Server } from 'node:http'
import { gzipSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type FetchGuard, isPublicAddress, publicOnly, safeFetch } from './fetch-http.js'

describe('public addresses', () => {
    it.each([
        '127.0.0.1',
        '10.1.2.3',
        '172.16.0.1',
        '172.31.255.255',
        '192.168.1.1',
        '169.254.169.254',
        '100.64.0.1',
        '0.0.0.0',
        '224.0.0.1',
        '255.255.255.255',
        '::1',
        '::',
        'fe80::1',
        'fd00::1',
        'fc00::abcd',
        '::ffff:127.0.0.1',
        '::ffff:10.0.0.1',
        '[::1]',
        'not-an-ip',
    ])('refuses %s', address => {
        expect(isPublicAddress(address)).toBe(false)
    })

    it.each([
        '93.184.215.14',
        '8.8.8.8',
        '172.32.0.1',
        '2606:4700::6810:84e5',
        '::ffff:8.8.8.8',
    ])('allows %s', address => {
        expect(isPublicAddress(address)).toBe(true)
    })
})

/**
 * A loopback stand-in for the internet: names under `.example.test` resolve to
 * it and count as public, every other address is judged by `isPublicAddress`.
 */
describe('safe fetch', () => {
    let server: Server
    let port = 0
    const guard: FetchGuard = {
        resolve: async hostname => {
            if (hostname.endsWith('.example.test'))
                return [
                    {
                        address: '127.0.0.1',
                        family: 4,
                    },
                ]
            if (hostname === 'internal.example.org')
                return [
                    {
                        address: '10.0.0.7',
                        family: 4,
                    },
                ]
            if (hostname === 'mixed.example.org')
                return [
                    {
                        address: '93.184.215.14',
                        family: 4,
                    },
                    {
                        address: '192.168.0.10',
                        family: 4,
                    },
                ]
            throw Object.assign(new Error('not found'), {
                code: 'ENOTFOUND',
            })
        },
        isAllowed: address => address === '127.0.0.1' || isPublicAddress(address),
    }
    const site = (path: string) => `http://jobs.example.test:${port}${path}`

    beforeAll(async () => {
        server = createServer((req, res) => {
            const url = req.url ?? '/'
            if (url === '/page') {
                res.setHeader('content-type', 'text/html; charset=utf-8')
                res.end('<p>Hello</p>')
            } else if (url === '/gzip') {
                res.setHeader('content-type', 'text/html')
                res.setHeader('content-encoding', 'gzip')
                res.end(gzipSync('<p>Packed</p>'))
            } else if (url === '/to-private') {
                res.statusCode = 302
                res.setHeader('location', 'http://internal.example.org/admin')
                res.end()
            } else if (url === '/to-metadata') {
                res.statusCode = 301
                res.setHeader('location', 'http://169.254.169.254/latest/meta-data/')
                res.end()
            } else if (url === '/to-ftp') {
                res.statusCode = 302
                res.setHeader('location', 'ftp://jobs.example.test/file')
                res.end()
            } else if (url.startsWith('/loop/')) {
                const step = Number(url.slice('/loop/'.length))
                res.statusCode = 302
                res.setHeader('location', `/loop/${step + 1}`)
                res.end()
            } else if (url === '/redirect-once') {
                res.statusCode = 307
                res.setHeader('location', '/page')
                res.end()
            } else if (url === '/big') {
                res.setHeader('content-type', 'text/html')
                res.end('x'.repeat(2_000))
            } else if (url === '/slow') {
                res.setHeader('content-type', 'text/html')
                res.write('<p>')
            } else if (url === '/busy') {
                res.statusCode = 503
                res.end()
            } else {
                res.statusCode = 404
                res.end()
            }
        })
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
        const address = server.address()
        if (!address || typeof address === 'string') throw new Error('no address')
        port = address.port
    })
    afterAll(async () => {
        server.closeAllConnections()
        await new Promise<void>(resolve => server.close(() => resolve()))
    })

    const failure = (url: string, options: Partial<Parameters<typeof safeFetch>[1]> = {}, fetchGuard = guard) =>
        safeFetch(
            url,
            {
                accept: 'html',
                ...options,
            },
            fetchGuard,
        ).then(
            () => 'ok',
            (error: { code?: string; retryable?: boolean }) => `${error.code}${error.retryable ? ' retryable' : ''}`,
        )

    it('reads a page, its redirects followed and its body decompressed', async () => {
        await expect(
            safeFetch(
                site('/redirect-once'),
                {
                    accept: 'html',
                },
                guard,
            ),
        ).resolves.toMatchObject({
            url: site('/page'),
            status: 200,
            contentType: 'text/html; charset=utf-8',
            body: '<p>Hello</p>',
        })
        await expect(
            safeFetch(
                site('/gzip'),
                {
                    accept: 'html',
                },
                guard,
            ),
        ).resolves.toMatchObject({
            body: '<p>Packed</p>',
        })
    })

    it('refuses private and loopback addresses by default, literal or resolved', async () => {
        expect(await failure(`http://127.0.0.1:${port}/page`, {}, publicOnly)).toBe('blocked_address')
        expect(await failure(`http://[::1]:${port}/page`, {}, publicOnly)).toBe('blocked_address')
        expect(await failure('http://169.254.169.254/latest/meta-data/')).toBe('blocked_address')
        expect(await failure('http://internal.example.org/')).toBe('blocked_address')
        expect(await failure('http://mixed.example.org/')).toBe('blocked_address')
    })

    it('refuses a redirect to a private address or another scheme', async () => {
        expect(await failure(site('/to-private'))).toBe('blocked_address')
        expect(await failure(site('/to-metadata'))).toBe('blocked_address')
        expect(await failure(site('/to-ftp'))).toBe('bad_url')
    })

    it('stops after five redirects', async () => {
        expect(await failure(site('/loop/0'))).toBe('too_many_redirects')
    })

    it('refuses other schemes, credentials and bad links before connecting', async () => {
        expect(await failure('file:///etc/passwd')).toBe('bad_url')
        expect(await failure('ftp://jobs.example.test/')).toBe('bad_url')
        expect(await failure(`http://user:secret@jobs.example.test:${port}/page`)).toBe('bad_url')
        expect(await failure('not a url')).toBe('bad_url')
    })

    it('limits the body and the time, and maps statuses', async () => {
        expect(
            await failure(site('/big'), {
                maxBytes: 1_000,
            }),
        ).toBe('too_large')
        expect(
            await failure(site('/slow'), {
                timeoutMs: 200,
            }),
        ).toBe('timeout retryable')
        expect(await failure(site('/missing'))).toBe('http_404')
        expect(await failure(site('/busy'))).toBe('http_503 retryable')
        expect(await failure('http://nowhere.example.org/')).toBe('dns_not_found')
    })
})
