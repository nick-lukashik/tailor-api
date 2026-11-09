import { Inject, Injectable, Logger } from '@nestjs/common'
import type { ConfigType } from '@nestjs/config'
import { z } from 'zod'
import { llmConfig } from '../config/config.js'
import { type Completion, classifyGatewayError, LlmCallError, readCompletion } from './llm-gateway.js'

/**
 * One call. It runs in a job, never in a request, so it is outside the 10 s
 * request budget; the gateway itself allows a call up to 16 minutes.
 */
export const LLM_CALL_TIMEOUT_MS = 120_000

export type StructuredCall<T> = {
    model: string
    /** One of the model's efforts (`GET /api/v1/models`); the model's default when absent. */
    reasoningEffort?: string
    system: string
    user: string
    /** The answer's schema: sent as JSON Schema, and the answer is checked against it. */
    schema: z.ZodType<T>
    schemaName: string
    /** What the call is for, in the gateway's journal. */
    purpose: string
    /** The same key within 24 h returns the stored answer of a successful call, without a second model run. */
    idempotencyKey?: string
    signal?: AbortSignal
}

const parseJson = (text: string): unknown => {
    try {
        return JSON.parse(text)
    } catch {
        return undefined
    }
}

/**
 * The platform LLM gateway (llm-gateway, OpenAI-compatible): structured
 * output through `response_format: json_schema`. Prompts, answers and the key
 * are never logged; failures are `LlmCallError` with a short code.
 */
@Injectable()
export class LlmGatewayClient {
    private readonly logger = new Logger(LlmGatewayClient.name)

    constructor(@Inject(llmConfig.KEY) private readonly config: ConfigType<typeof llmConfig>) {}

    async complete<T>(call: StructuredCall<T>): Promise<Completion<T>> {
        const deadline = AbortSignal.timeout(LLM_CALL_TIMEOUT_MS)
        const headers: Record<string, string> = {
            authorization: `Bearer ${this.config.key}`,
            'content-type': 'application/json',
            accept: 'application/json',
        }
        if (call.idempotencyKey) headers['idempotency-key'] = call.idempotencyKey
        let response: Response
        let text: string
        try {
            response = await fetch(`${this.config.url}/api/v1/chat/completions`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    model: call.model,
                    ...(call.reasoningEffort
                        ? {
                              reasoning_effort: call.reasoningEffort,
                          }
                        : {}),
                    messages: [
                        {
                            role: 'system',
                            content: call.system,
                        },
                        {
                            role: 'user',
                            content: call.user,
                        },
                    ],
                    response_format: {
                        type: 'json_schema',
                        json_schema: {
                            name: call.schemaName,
                            schema: z.toJSONSchema(call.schema),
                            strict: true,
                        },
                    },
                    metadata: {
                        purpose: call.purpose,
                    },
                }),
                signal: call.signal
                    ? AbortSignal.any([
                          deadline,
                          call.signal,
                      ])
                    : deadline,
            })
            text = await response.text()
        } catch (error) {
            const code = deadline.aborted ? 'llm_timeout' : call.signal?.aborted ? 'llm_aborted' : 'llm_unreachable'
            this.logger.warn(
                {
                    code,
                    reason: error instanceof Error ? error.name : 'unknown',
                },
                'LLM gateway call failed',
            )
            throw new LlmCallError(code, true)
        }
        const body = parseJson(text)
        if (!response.ok) {
            const failure = classifyGatewayError(response.status, body)
            this.logger.warn(
                {
                    status: response.status,
                    code: failure.code,
                    retryable: failure.retryable,
                },
                'LLM gateway refused the call',
            )
            throw failure
        }
        return readCompletion(body, call.schema)
    }
}
