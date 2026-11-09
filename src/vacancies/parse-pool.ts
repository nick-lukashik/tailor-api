import { modelSlug } from '../config/env.js'
import type { LlmCallError } from '../llm/llm-gateway.js'

/** The queue of the release before the pool; drained, its jobs moved to the pool. Remove in the next release. */
export const LEGACY_PARSE_QUEUE = 'vacancy.parse'

/** One queue per parse model: `vacancy.parse.claude-sonnet-5-5`. */
export const parseQueueName = (model: string) => `${LEGACY_PARSE_QUEUE}.${modelSlug(model)}`

/**
 * The queue for each vacancy. One that already has a live (queued or active)
 * parse goes to that queue again, so `stately` there keeps it to one queued
 * and one active; any other to the queue with the fewest live jobs, ties in
 * config order, each pick counting towards the next.
 */
export function assignQueues(
    queues: string[],
    load: ReadonlyMap<string, number>,
    vacancyIds: string[],
    live: ReadonlyMap<string, string>,
): Map<string, string> {
    const counts = new Map(
        queues.map(queue => [
            queue,
            load.get(queue) ?? 0,
        ]),
    )
    const assigned = new Map<string, string>()
    for (const vacancyId of vacancyIds) {
        const current = live.get(vacancyId)
        const queue =
            current !== undefined && counts.has(current)
                ? current
                : queues.reduce<string | undefined>(
                      (best, next) =>
                          best === undefined || (counts.get(next) ?? 0) < (counts.get(best) ?? 0) ? next : best,
                      undefined,
                  )
        if (queue === undefined) throw new Error('no parse queue configured')
        counts.set(queue, (counts.get(queue) ?? 0) + 1)
        assigned.set(vacancyId, queue)
    }
    return assigned
}

/** The provider behind the model is out of quota or down: another model may still answer. */
export const isProviderOutage = (error: LlmCallError) =>
    error.status === 429
    || error.status === 503
    || error.code === 'llm_provider_quota'
    || error.code === 'llm_provider_unavailable'

/**
 * After a failed call: a provider outage moves the job to another model's
 * queue once (`canMove`: another model is configured and the job has not
 * moved yet); otherwise another try on the same queue while the error is
 * retryable and retries are left, else the vacancy is `failed`.
 */
export const afterFailure = (
    error: LlmCallError,
    attempt: {
        retryCount: number
        retryLimit: number
        canMove: boolean
    },
): 'move' | 'retry' | 'fail' => {
    if (attempt.canMove && isProviderOutage(error)) return 'move'
    return error.retryable && attempt.retryCount < attempt.retryLimit ? 'retry' : 'fail'
}
