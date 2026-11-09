import { createServer, type IncomingMessage, type Server } from 'node:http'

export const LLM_TEST_KEY = 'llm-tailor-api-test-key-0123456789abcdef'

export type GatewayCall = {
    path: string
    authorization: string | undefined
    idempotencyKey: string | undefined
    body: {
        model: string
        reasoning_effort?: string
        messages: {
            role: string
            content: string
        }[]
        response_format: {
            type: string
            json_schema: {
                name: string
                schema: Record<string, unknown>
            }
        }
        metadata?: Record<string, string>
    }
}

export type GatewayReply = {
    status: number
    body: unknown
}

/** The OpenAI-shaped answer the gateway gives for a schema: the JSON text of `output`. */
export const completionOf = (output: unknown): GatewayReply => ({
    status: 200,
    body: {
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: 0,
        model: 'claude-haiku-5-5',
        provider: 'claude',
        choices: [
            {
                index: 0,
                message: {
                    role: 'assistant',
                    content: JSON.stringify(output),
                },
                finish_reason: 'stop',
            },
        ],
        usage: {
            prompt_tokens: 100,
            completion_tokens: 50,
            total_tokens: 150,
        },
    },
})

/** The gateway's error body for `code` (OpenAI shape plus `retryable`). */
export const errorOf = (status: number, code: string): GatewayReply => ({
    status,
    body: {
        error: {
            message: `test: ${code}`,
            type: code,
            code,
            param: null,
            retryable: status >= 500,
            resets_at: null,
        },
    },
})

const read = async (request: IncomingMessage) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk as Buffer)
    return Buffer.concat(chunks).toString('utf8')
}

/**
 * A stand-in for llm-gateway: records every call and answers with `reply`,
 * a 503 `provider_unavailable` unless a test says otherwise. No real network.
 */
export async function startLlmGateway() {
    const calls: GatewayCall[] = []
    let reply: (call: GatewayCall) => GatewayReply = () => errorOf(503, 'provider_unavailable')
    const server: Server = createServer(async (request, response) => {
        const call: GatewayCall = {
            path: request.url ?? '',
            authorization: request.headers.authorization,
            idempotencyKey: request.headers['idempotency-key'] as string | undefined,
            body: JSON.parse((await read(request)) || '{}'),
        }
        calls.push(call)
        const { status, body } = call.path === '/api/v1/chat/completions' ? reply(call) : errorOf(404, 'not_found')
        response.statusCode = status
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify(body))
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('no address')

    return {
        url: `http://127.0.0.1:${address.port}`,
        calls,
        /** How the gateway answers from now on. */
        answer: (next: (call: GatewayCall) => GatewayReply) => {
            reply = next
        },
        close: () => new Promise<void>(resolve => server.close(() => resolve())),
    }
}
export type FakeLlmGateway = Awaited<ReturnType<typeof startLlmGateway>>
