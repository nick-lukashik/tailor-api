import { describe, expect, it } from 'vitest'
import { envSchema } from './env.js'

const base = {
    DATABASE_URL: 'postgres://app:app@localhost:5432/app',
    LLM_GATEWAY_KEY: 'llm-tailor-api-test-key-0123456789abcdef',
}

describe('env', () => {
    it('ignores a variable it no longer reads, such as the old TAILOR_USERS allowlist', () => {
        const result = envSchema.safeParse({
            ...base,
            TAILOR_USERS: 'anything, even not a uuid',
        })
        expect(result.success).toBe(true)
        expect(result.data).not.toHaveProperty('TAILOR_USERS')
    })

    it('needs the LLM gateway key and defaults the gateway and the parse model to prod', () => {
        const { LLM_GATEWAY_KEY: _key, ...withoutKey } = base
        const missing = envSchema.safeParse(withoutKey)
        expect(missing.error?.issues.map(issue => issue.path.join('.'))).toEqual([
            'LLM_GATEWAY_KEY',
        ])
        expect(envSchema.parse(base)).toMatchObject({
            LLM_GATEWAY_URL: 'http://llm-gateway.prod.svc',
            LLM_PARSE_MODEL: 'claude-haiku-5-5',
        })
    })
})
