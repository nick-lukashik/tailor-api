import { modelSlug } from '../config/env.js'
import type { LlmCallError } from './llm-gateway.js'

/*
 * A pool of models for a job (`LLM_PARSE_MODELS`, `LLM_CV_MODELS`): one queue
 * per model, each worked with that model's concurrency; new work goes to the
 * emptiest queue, and a provider outage moves a job to another model once.
 * Pure: the job reads the queue load (ModelPoolRepository) and sends.
 */

/** One queue per model of a job: `vacancy.parse.claude-sonnet-5-5`, `cv.generate.gpt-6-1-sol`. */
export const poolQueueName = (job: string, model: string) => `${job}.${modelSlug(model)}`

/**
 * The queue for each key. One that already has a live (queued or active) job
 * goes to that queue again, so `stately` there keeps it to one queued and one
 * active; any other to the queue with the fewest live jobs, ties in config
 * order, each pick counting towards the next.
 */
export function assignQueues(
    queues: string[],
    load: ReadonlyMap<string, number>,
    keys: string[],
    live: ReadonlyMap<string, string>,
): Map<string, string> {
    const counts = new Map(
        queues.map(queue => [
            queue,
            load.get(queue) ?? 0,
        ]),
    )
    const assigned = new Map<string, string>()
    for (const key of keys) {
        const current = live.get(key)
        const queue =
            current !== undefined && counts.has(current)
                ? current
                : queues.reduce<string | undefined>(
                      (best, next) =>
                          best === undefined || (counts.get(next) ?? 0) < (counts.get(best) ?? 0) ? next : best,
                      undefined,
                  )
        if (queue === undefined) throw new Error('no queue configured for the model pool')
        counts.set(queue, (counts.get(queue) ?? 0) + 1)
        assigned.set(key, queue)
    }
    return assigned
}

/** The provider behind the model is out of quota or down: another model may still answer. */
export const isProviderOutage = (error: Pick<LlmCallError, 'code' | 'status'>) =>
    error.status === 429
    || error.status === 503
    || error.code === 'llm_provider_quota'
    || error.code === 'llm_provider_unavailable'

/**
 * After a failed call: a provider outage moves the job to another model's
 * queue once (`canMove`: another model is configured and the job has not
 * moved yet); otherwise another try on the same queue while the error is
 * retryable and retries are left, else the work is `failed`.
 */
export const afterFailure = (
    error: Pick<LlmCallError, 'code' | 'retryable' | 'status'>,
    attempt: {
        retryCount: number
        retryLimit: number
        canMove: boolean
    },
): 'move' | 'retry' | 'fail' => {
    if (attempt.canMove && isProviderOutage(error)) return 'move'
    return error.retryable && attempt.retryCount < attempt.retryLimit ? 'retry' : 'fail'
}
