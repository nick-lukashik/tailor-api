import { createServer, type Server } from 'node:http'

export type SiteReply = {
    status?: number
    contentType?: string
    body: string
}

/**
 * A stand-in for the sites the vacancy fetch reads (the ATS APIs and the
 * vacancy pages): `on(path, reply)` serves a path with its query, every other
 * one is a 404; `requests` records what was asked. No real network.
 */
export async function startSites() {
    const routes = new Map<string, () => SiteReply>()
    const requests: string[] = []
    const server: Server = createServer((request, response) => {
        const path = request.url ?? '/'
        requests.push(path)
        const reply = routes.get(path)?.() ?? {
            status: 404,
            contentType: 'text/plain',
            body: 'not found',
        }
        response.statusCode = reply.status ?? 200
        response.setHeader('content-type', reply.contentType ?? 'application/json')
        response.end(reply.body)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('no address')
    const url = `http://127.0.0.1:${address.port}`

    return {
        url,
        requests,
        /** Serves `path` (with its query) with `reply` from now on. */
        on: (path: string, reply: SiteReply | (() => SiteReply)) => {
            routes.set(path, typeof reply === 'function' ? reply : () => reply)
        },
        json: (path: string, body: unknown) => {
            routes.set(path, () => ({
                body: JSON.stringify(body),
            }))
        },
        html: (path: string, body: string) => {
            routes.set(path, () => ({
                contentType: 'text/html; charset=utf-8',
                body,
            }))
        },
        reset: () => {
            routes.clear()
            requests.length = 0
        },
        /** The env that points every reader of the fetch at this stand-in. */
        env: () => ({
            VACANCY_FETCH_ENABLED: 'true',
            VACANCY_FETCH_ALLOW_PRIVATE: 'true',
            VACANCY_FETCH_GREENHOUSE_URL: `${url}/greenhouse`,
            VACANCY_FETCH_LEVER_API_URL: `${url}/lever-api`,
            VACANCY_FETCH_LEVER_JOBS_URL: `${url}/lever-jobs`,
            VACANCY_FETCH_ASHBY_URL: `${url}/ashby`,
            VACANCY_FETCH_WORKABLE_URL: `${url}/workable`,
        }),
        close: () =>
            new Promise<void>(resolve => {
                server.closeAllConnections()
                server.close(() => resolve())
            }),
    }
}
export type FakeSites = Awaited<ReturnType<typeof startSites>>
