import { describe, expect, it } from 'vitest'
import { routeVacancyUrl } from './fetch-routes.js'

describe('vacancy link routing', () => {
    it.each([
        [
            'https://boards.greenhouse.io/examplelabs/jobs/4012345',
            {
                kind: 'greenhouse',
                board: 'examplelabs',
                jobId: '4012345',
            },
        ],
        [
            'https://job-boards.greenhouse.io/examplelabs/jobs/4012345?gh_src=feed',
            {
                kind: 'greenhouse',
                board: 'examplelabs',
                jobId: '4012345',
            },
        ],
        [
            'https://boards.greenhouse.io/embed/job_app?for=examplelabs&token=4012345',
            {
                kind: 'greenhouse',
                board: 'examplelabs',
                jobId: '4012345',
            },
        ],
        [
            'https://careers.example.com/jobs?gh_jid=4012345',
            {
                kind: 'greenhouse-embed',
                jobId: '4012345',
            },
        ],
        [
            'https://jobs.lever.co/examplelabs/0b9e5c4e-1111-4a2b-9c3d-000000000001/apply',
            {
                kind: 'lever',
                company: 'examplelabs',
                postingId: '0b9e5c4e-1111-4a2b-9c3d-000000000001',
            },
        ],
        [
            'https://jobs.ashbyhq.com/examplelabs/5a1b2c3d-0000-4000-8000-000000000001/application',
            {
                kind: 'ashby',
                org: 'examplelabs',
                jobId: '5a1b2c3d-0000-4000-8000-000000000001',
            },
        ],
        [
            'https://apply.workable.com/examplelabs/j/AB12CD34EF/',
            {
                kind: 'workable',
                account: 'examplelabs',
                shortcode: 'AB12CD34EF',
            },
        ],
    ])('routes %s', (url, route) => {
        expect(routeVacancyUrl(url)).toEqual(route)
    })

    it.each([
        'https://example.com/jobs/1',
        'https://boards.greenhouse.io/examplelabs',
        'https://boards.greenhouse.io/examplelabs/jobs/not-a-number',
        'https://jobs.lever.co/examplelabs',
        'https://apply.workable.com/examplelabs/',
        'https://evil.example.com/boards.greenhouse.io/examplelabs/jobs/1',
        'not a url',
    ])('reads %s as a page', url => {
        expect(routeVacancyUrl(url)).toEqual({
            kind: 'page',
        })
    })
})
