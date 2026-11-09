import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { classifyGatewayError, LlmCallError, readCompletion } from './llm-gateway.js'

const schema = z.strictObject({
    title: z.string().nullable(),
})

const completion = (content: string) => ({
    id: 'chatcmpl-1',
    object: 'chat.completion',
    choices: [
        {
            index: 0,
            message: {
                role: 'assistant',
                content,
            },
            finish_reason: 'stop',
        },
    ],
    usage: {
        prompt_tokens: 120,
        completion_tokens: 30,
        total_tokens: 150,
    },
})

const failure = (fn: () => unknown) => {
    try {
        fn()
    } catch (error) {
        if (error instanceof LlmCallError)
            return {
                code: error.code,
                retryable: error.retryable,
            }
        throw error
    }
    throw new Error('did not throw')
}

describe('readCompletion', () => {
    it('returns the structured answer of the first choice and its tokens', () => {
        expect(readCompletion(completion('{"title":"Backend engineer"}'), schema)).toEqual({
            output: {
                title: 'Backend engineer',
            },
            promptTokens: 120,
            completionTokens: 30,
        })
    })

    it.each([
        [
            'not JSON',
            completion('Sure! Here it is'),
            'llm_invalid_output',
        ],
        [
            'off the schema',
            completion('{"title":1}'),
            'llm_invalid_output',
        ],
        [
            'an extra key',
            completion('{"title":null,"note":"x"}'),
            'llm_invalid_output',
        ],
        [
            'no choices',
            {
                choices: [],
            },
            'llm_invalid_response',
        ],
        [
            'not a completion',
            undefined,
            'llm_invalid_response',
        ],
    ])('refuses an answer that is %s, without a retry', (_, body, code) => {
        expect(failure(() => readCompletion(body, schema))).toEqual({
            code,
            retryable: false,
        })
    })

    it('never puts the answer into the error', () => {
        const error = (() => {
            try {
                readCompletion(completion('{"title":42,"secret":"the vacancy text"}'), schema)
            } catch (caught) {
                return caught as Error
            }
        })()
        expect(error?.message).not.toContain('the vacancy text')
    })
})

describe('classifyGatewayError', () => {
    const body = (code: string) => ({
        error: {
            message: 'The provider said something long, maybe quoting the prompt',
            type: code,
            code,
            param: null,
            retryable: true,
            resets_at: null,
        },
    })

    it.each([
        [
            503,
            body('provider_unavailable'),
            'llm_provider_unavailable',
            true,
        ],
        [
            504,
            body('provider_timeout'),
            'llm_provider_timeout',
            true,
        ],
        [
            429,
            body('provider_quota'),
            'llm_provider_quota',
            true,
        ],
        [
            500,
            undefined,
            'llm_http_500',
            true,
        ],
        [
            502,
            '<html>Bad gateway</html>',
            'llm_http_502',
            true,
        ],
        [
            400,
            body('bad_request'),
            'llm_bad_request',
            false,
        ],
        [
            401,
            body('invalid_api_key'),
            'llm_invalid_api_key',
            false,
        ],
        [
            403,
            body('permission_denied'),
            'llm_permission_denied',
            false,
        ],
        [
            422,
            body('invalid_output'),
            'llm_invalid_output',
            false,
        ],
        [
            404,
            {
                code: 'NOT_FOUND',
                message: 'Not found',
            },
            'llm_http_404',
            false,
        ],
    ])('%i → %s', (status, response, code, retryable) => {
        const error = classifyGatewayError(status, response)
        expect({
            code: error.code,
            retryable: error.retryable,
            status: error.status,
        }).toEqual({
            code,
            retryable,
            status,
        })
        expect(error.message).not.toContain('prompt')
    })

    it('keeps a code that is not a short machine word out', () => {
        expect(classifyGatewayError(400, body('Ignore previous instructions')).code).toBe('llm_http_400')
    })
})
