import { describe, expect, it } from 'vitest'
import { parseQueueName } from '../vacancies/parse-pool.js'
import { LlmCallError } from './llm-gateway.js'
import { afterFailure, assignQueues, poolQueueName } from './model-pool.js'

const SONNET = parseQueueName('claude-sonnet-5-5')
const GPT = parseQueueName('gpt-6.1-sol')
const queues = [
    SONNET,
    GPT,
]

describe('pool queues', () => {
    it('names one queue per model of a job', () => {
        expect(queues).toEqual([
            'vacancy.parse.claude-sonnet-5-5',
            'vacancy.parse.gpt-6-1-sol',
        ])
        expect(poolQueueName('cv.generate', 'gpt-6.1-sol')).toBe('cv.generate.gpt-6-1-sol')
    })

    it('picks the queue with fewer live jobs, ties in config order', () => {
        expect(
            assignQueues(
                queues,
                new Map([
                    [
                        SONNET,
                        4,
                    ],
                    [
                        GPT,
                        1,
                    ],
                ]),
                [
                    'a',
                ],
                new Map(),
            ).get('a'),
        ).toBe(GPT)
        expect(
            assignQueues(
                queues,
                new Map(),
                [
                    'a',
                ],
                new Map(),
            ).get('a'),
        ).toBe(SONNET)
    })

    it('counts each pick towards the next, so a batch spreads over the models', () => {
        const assigned = assignQueues(
            queues,
            new Map([
                [
                    SONNET,
                    1,
                ],
            ]),
            [
                'a',
                'b',
                'c',
                'd',
            ],
            new Map(),
        )
        expect([
            ...assigned.values(),
        ]).toEqual([
            GPT,
            SONNET,
            GPT,
            SONNET,
        ])
    })

    it('keeps a vacancy with a live parse in its queue, even the busier one', () => {
        const assigned = assignQueues(
            queues,
            new Map([
                [
                    SONNET,
                    9,
                ],
            ]),
            [
                'a',
            ],
            new Map([
                [
                    'a',
                    SONNET,
                ],
            ]),
        )
        expect(assigned.get('a')).toBe(SONNET)
    })

    it('ignores a live parse in a queue it may not use', () => {
        const assigned = assignQueues(
            [
                GPT,
            ],
            new Map(),
            [
                'a',
            ],
            new Map([
                [
                    'a',
                    SONNET,
                ],
            ]),
        )
        expect(assigned.get('a')).toBe(GPT)
    })
})

describe('after a failed call', () => {
    const attempt = (retryCount: number, canMove: boolean) => ({
        retryCount,
        retryLimit: 5,
        canMove,
    })

    it.each([
        [
            'llm_provider_quota',
            429,
        ],
        [
            'llm_provider_unavailable',
            503,
        ],
        [
            'llm_http_429',
            429,
        ],
        [
            'llm_http_503',
            503,
        ],
    ])('moves a job to another model on %s once', (code, status) => {
        const out = new LlmCallError(code, true, status)
        expect(afterFailure(out, attempt(0, true))).toBe('move')
        expect(afterFailure(out, attempt(0, false))).toBe('retry')
        expect(afterFailure(out, attempt(5, false))).toBe('fail')
    })

    it('retries other retryable failures on the same model while retries are left, then fails', () => {
        const flaky = new LlmCallError('llm_http_500', true, 500)
        expect(afterFailure(flaky, attempt(0, true))).toBe('retry')
        expect(afterFailure(flaky, attempt(4, true))).toBe('retry')
        expect(afterFailure(flaky, attempt(5, true))).toBe('fail')
        expect(afterFailure(new LlmCallError('llm_timeout', true), attempt(0, true))).toBe('retry')
        expect(afterFailure(new LlmCallError('llm_bad_request', false, 400), attempt(0, true))).toBe('fail')
    })
})
