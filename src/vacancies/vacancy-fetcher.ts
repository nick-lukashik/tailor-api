import { Inject, Injectable } from '@nestjs/common'
import type { ConfigType } from '@nestjs/config'
import { fetchConfig } from '../config/config.js'
import { type ApplyForm, applyForm } from './apply-form.js'
import {
    ashbyVacancy,
    type FetchedVacancy,
    greenhouseBoardOf,
    greenhouseVacancy,
    leverForm,
    leverText,
    pageVacancy,
    workableForm,
    workableText,
} from './fetch-adapters.js'
import { FetchError, type FetchedResponse, type FetchGuard, jsonOf, publicOnly, safeFetch } from './fetch-http.js'
import { routeVacancyUrl } from './fetch-routes.js'

const isPage = (response: FetchedResponse) =>
    /html|xml|text\/plain/.test(response.contentType) || response.contentType === ''

const path = (...parts: string[]) => parts.map(encodeURIComponent).join('/')

/**
 * Reads a vacancy link: the public API of its ATS when the link is one
 * (Greenhouse, Lever, Ashby, Workable), else the page itself. Every request
 * goes through `safeFetch` (public addresses only, 15 s, 5 MB, 5 redirects).
 * A form that cannot be read leaves the text: it is a form with no fields.
 */
@Injectable()
export class VacancyFetcher {
    private readonly guard: FetchGuard

    constructor(@Inject(fetchConfig.KEY) private readonly config: ConfigType<typeof fetchConfig>) {
        this.guard = config.allowPrivate
            ? {
                  ...publicOnly,
                  isAllowed: () => true,
              }
            : publicOnly
    }

    async fetch(url: string, signal?: AbortSignal): Promise<FetchedVacancy> {
        const route = routeVacancyUrl(url)
        switch (route.kind) {
            case 'greenhouse':
                return this.greenhouse(route.board, route.jobId, signal)
            case 'greenhouse-embed': {
                const page = await this.page(url, signal)
                const board = greenhouseBoardOf(page.body)
                return board ? this.greenhouse(board, route.jobId, signal) : pageVacancy(page.body)
            }
            case 'lever': {
                const posting = await this.json(
                    `${this.config.leverApiUrl}/v0/postings/${path(route.company, route.postingId)}`,
                    signal,
                )
                const form = await this.optionalForm('lever', async () =>
                    leverForm(
                        (
                            await this.page(
                                `${this.config.leverJobsUrl}/${path(route.company, route.postingId)}/apply`,
                                signal,
                            )
                        ).body,
                    ),
                )
                return {
                    source: 'lever',
                    text: leverText(posting, route.company),
                    form,
                }
            }
            case 'ashby':
                return ashbyVacancy(
                    await this.json(
                        `${this.config.ashbyUrl}/posting-api/job-board/${path(route.org)}?includeCompensation=true`,
                        signal,
                    ),
                    route.org,
                    route.jobId,
                )
            case 'workable': {
                const job = `${this.config.workableUrl}/api/v2/accounts/${path(route.account)}/jobs/${path(route.shortcode)}`
                const text = workableText(await this.json(job, signal), route.account)
                const form = await this.optionalForm('workable', async () =>
                    workableForm(await this.json(`${job}/form`, signal)),
                )
                return {
                    source: 'workable',
                    text,
                    form,
                }
            }
            case 'page': {
                const page = await this.page(url, signal)
                return pageVacancy(page.body)
            }
        }
    }

    private async greenhouse(board: string, jobId: string, signal?: AbortSignal) {
        return greenhouseVacancy(
            await this.json(
                `${this.config.greenhouseUrl}/v1/boards/${path(board, 'jobs', jobId)}?questions=true`,
                signal,
            ),
        )
    }

    private async json(url: string, signal?: AbortSignal) {
        return jsonOf(
            await safeFetch(
                url,
                {
                    accept: 'json',
                    signal,
                },
                this.guard,
            ),
        )
    }

    private async page(url: string, signal?: AbortSignal) {
        const response = await safeFetch(
            url,
            {
                accept: 'html',
                signal,
            },
            this.guard,
        )
        if (!isPage(response)) throw new FetchError('unsupported_type', false)
        return response
    }

    private async optionalForm(source: 'lever' | 'workable', read: () => Promise<ApplyForm>): Promise<ApplyForm> {
        try {
            return await read()
        } catch (error) {
            if (error instanceof FetchError) return applyForm(source, [])
            throw error
        }
    }
}
