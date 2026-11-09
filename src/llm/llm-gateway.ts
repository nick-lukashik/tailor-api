import { z } from 'zod'

/**
 * A failed call to the LLM gateway. `code` is short and machine-readable
 * (`llm_<gateway code>`, `llm_http_<status>`, `llm_timeout`, …): it is stored
 * and logged, so it never carries the gateway's message, the prompt or the answer.
 */
export class LlmCallError extends Error {
    constructor(
        readonly code: string,
        /** Worth another try later: the gateway or its provider is down, busy or slow. */
        readonly retryable: boolean,
        readonly status?: number,
    ) {
        super(`LLM gateway call failed: ${code}`)
        this.name = 'LlmCallError'
    }
}

/** The gateway's error body (OpenAI shape plus `retryable` and `resets_at`); only its code is read. */
const errorBodySchema = z.object({
    error: z.object({
        code: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
    }),
})

/** 5xx and 429 are worth a retry (the gateway restarting, a provider down or out of quota); other 4xx are not. */
export function classifyGatewayError(status: number, body: unknown): LlmCallError {
    const parsed = errorBodySchema.safeParse(body)
    const code = parsed.success ? `llm_${parsed.data.error.code}` : `llm_http_${status}`
    return new LlmCallError(code, status >= 500 || status === 429, status)
}

const completionSchema = z.object({
    choices: z
        .array(
            z.object({
                message: z.object({
                    content: z.string(),
                }),
            }),
        )
        .min(1),
    usage: z
        .object({
            prompt_tokens: z.number(),
            completion_tokens: z.number(),
        })
        .optional(),
})

export type Completion<T> = {
    output: T
    promptTokens?: number
    completionTokens?: number
}

/**
 * The structured answer of a chat completion: the JSON text of the first
 * choice, checked against the schema it was asked for. Anything else is
 * `llm_invalid_output`, not retried: the gateway already corrected it once.
 */
export function readCompletion<T>(body: unknown, schema: z.ZodType<T>): Completion<T> {
    const completion = completionSchema.safeParse(body)
    if (!completion.success) throw new LlmCallError('llm_invalid_response', false)
    let json: unknown
    try {
        json = JSON.parse(completion.data.choices[0]?.message.content ?? '')
    } catch {
        throw new LlmCallError('llm_invalid_output', false)
    }
    const output = schema.safeParse(json)
    if (!output.success) throw new LlmCallError('llm_invalid_output', false)
    return {
        output: output.data,
        promptTokens: completion.data.usage?.prompt_tokens,
        completionTokens: completion.data.usage?.completion_tokens,
    }
}
