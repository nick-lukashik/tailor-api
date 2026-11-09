/** Which reader a vacancy link goes to: an ATS with a public API, or the page itself. */
export type FetchRoute =
    | {
          kind: 'greenhouse'
          board: string
          jobId: string
      }
    | {
          /** A `gh_jid` link on the company's own site: the board is found on the page. */
          kind: 'greenhouse-embed'
          jobId: string
      }
    | {
          kind: 'lever'
          company: string
          postingId: string
      }
    | {
          kind: 'ashby'
          org: string
          jobId: string
      }
    | {
          kind: 'workable'
          account: string
          shortcode: string
      }
    | {
          kind: 'page'
      }

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/
const NUMERIC = /^\d{1,20}$/

const segments = (url: URL) =>
    url.pathname
        .split('/')
        .filter(Boolean)
        .map(part => {
            try {
                return decodeURIComponent(part)
            } catch {
                return part
            }
        })

/**
 * The reader of a link, in order: Greenhouse (`boards.greenhouse.io/<board>/jobs/<id>`,
 * `job-boards.greenhouse.io`, the embed with `for` and `token`, `gh_jid` anywhere),
 * Lever (`jobs.lever.co/<company>/<id>`), Ashby (`jobs.ashbyhq.com/<org>/<id>`),
 * Workable (`apply.workable.com/<account>/j/<shortcode>`), else the page.
 */
export function routeVacancyUrl(input: string): FetchRoute {
    let url: URL
    try {
        url = new URL(input)
    } catch {
        return {
            kind: 'page',
        }
    }
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    const path = segments(url)
    const params = url.searchParams

    if (host === 'boards.greenhouse.io' || host === 'job-boards.greenhouse.io') {
        const [board, jobs, jobId] = path
        if (board && jobs === 'jobs' && jobId && SEGMENT.test(board) && board !== 'embed' && NUMERIC.test(jobId))
            return {
                kind: 'greenhouse',
                board,
                jobId,
            }
        const forBoard = params.get('for') ?? ''
        const token = params.get('token') ?? params.get('gh_jid') ?? ''
        if (SEGMENT.test(forBoard) && NUMERIC.test(token))
            return {
                kind: 'greenhouse',
                board: forBoard,
                jobId: token,
            }
    }
    const ghJid = params.get('gh_jid') ?? ''
    if (NUMERIC.test(ghJid)) {
        const forBoard = params.get('for') ?? ''
        return SEGMENT.test(forBoard)
            ? {
                  kind: 'greenhouse',
                  board: forBoard,
                  jobId: ghJid,
              }
            : {
                  kind: 'greenhouse-embed',
                  jobId: ghJid,
              }
    }

    if (host === 'jobs.lever.co') {
        const [company, postingId] = path
        if (company && postingId && SEGMENT.test(company) && /^[0-9a-f-]{8,64}$/i.test(postingId))
            return {
                kind: 'lever',
                company,
                postingId,
            }
    }

    if (host === 'jobs.ashbyhq.com') {
        const [org, jobId] = path
        if (org && jobId && SEGMENT.test(org) && /^[0-9a-f-]{8,64}$/i.test(jobId))
            return {
                kind: 'ashby',
                org,
                jobId,
            }
    }

    if (host === 'apply.workable.com') {
        const [account, j, shortcode] = path
        if (account && j === 'j' && shortcode && SEGMENT.test(account) && /^[A-Za-z0-9]{4,32}$/.test(shortcode))
            return {
                kind: 'workable',
                account,
                shortcode,
            }
    }

    return {
        kind: 'page',
    }
}
