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

    it('needs the LLM gateway key and defaults the gateway, the parse and the CV models to prod', () => {
        const { LLM_GATEWAY_KEY: _key, ...withoutKey } = base
        const missing = envSchema.safeParse(withoutKey)
        expect(missing.error?.issues.map(issue => issue.path.join('.'))).toEqual([
            'LLM_GATEWAY_KEY',
        ])
        expect(envSchema.parse(base)).toMatchObject({
            LLM_GATEWAY_URL: 'http://llm-gateway.prod.svc',
            LLM_PARSE_MODELS: [
                {
                    model: 'claude-sonnet-5-5',
                    effort: 'low',
                    concurrency: 3,
                },
                {
                    model: 'gpt-6.1-sol',
                    effort: 'low',
                    concurrency: 3,
                },
            ],
            LLM_CV_MODELS: [
                {
                    model: 'claude-sonnet-5-5',
                    effort: 'low',
                    concurrency: 3,
                },
                {
                    model: 'gpt-6.1-sol',
                    effort: 'low',
                    concurrency: 3,
                },
            ],
        })
    })

    it('reads the CV models like the parse ones, refusing a model twice', () => {
        expect(
            envSchema.parse({
                ...base,
                LLM_CV_MODELS: 'claude-opus-5-5:medium:2',
            }).LLM_CV_MODELS,
        ).toEqual([
            {
                model: 'claude-opus-5-5',
                effort: 'medium',
                concurrency: 2,
            },
        ])
        const twice = envSchema.safeParse({
            ...base,
            LLM_CV_MODELS: 'gpt-6.1-sol:low:1,gpt-6.1-sol:high:1',
        })
        expect(twice.error?.issues[0]?.path[0]).toBe('LLM_CV_MODELS')
    })

    it('reads the parse models as model:effort:concurrency', () => {
        expect(
            envSchema.parse({
                ...base,
                LLM_PARSE_MODELS: ' claude-opus-5-5 : high : 1 ',
            }).LLM_PARSE_MODELS,
        ).toEqual([
            {
                model: 'claude-opus-5-5',
                effort: 'high',
                concurrency: 1,
            },
        ])
    })

    it.each([
        [
            'no entry',
            '',
        ],
        [
            'an empty entry',
            'claude-sonnet-5-5:low:3,',
        ],
        [
            'an unknown effort',
            'claude-sonnet-5-5:extreme:3',
        ],
        [
            'concurrency 0',
            'claude-sonnet-5-5:low:0',
        ],
        [
            'concurrency 11',
            'claude-sonnet-5-5:low:11',
        ],
        [
            'concurrency not a whole number',
            'claude-sonnet-5-5:low:1.5',
        ],
        [
            'no concurrency',
            'claude-sonnet-5-5:low',
        ],
        [
            'an extra part',
            'claude-sonnet-5-5:low:3:x',
        ],
        [
            'a model id with a space',
            'claude sonnet:low:3',
        ],
        [
            'a model twice',
            'claude-sonnet-5-5:low:3,claude-sonnet-5-5:high:1',
        ],
        [
            'two models with one queue name',
            'gpt-6.1-sol:low:3,gpt-6-1-sol:low:3',
        ],
    ])('refuses parse models with %s', (_, value) => {
        const result = envSchema.safeParse({
            ...base,
            LLM_PARSE_MODELS: value,
        })
        expect(result.success).toBe(false)
        expect(result.error?.issues[0]?.path[0]).toBe('LLM_PARSE_MODELS')
    })

    it('starts without R2, with the bucket, prefix and CV host of prod', () => {
        const parsed = envSchema.parse(base)
        expect(parsed).toMatchObject({
            R2_BUCKET: 'nl-files-prod',
            R2_PREFIX: 'tailor/',
            CV_PUBLIC_URL: 'https://cv.nick-lukashik.com',
        })
        expect(parsed.R2_ENDPOINT).toBeUndefined()
    })

    it('takes the R2 endpoint and keys only together', () => {
        const r2 = {
            R2_ENDPOINT: 'https://example.r2.cloudflarestorage.com',
            R2_ACCESS_KEY_ID: 'key-id',
            R2_SECRET_ACCESS_KEY: 'secret',
        }
        expect(
            envSchema.safeParse({
                ...base,
                ...r2,
            }).success,
        ).toBe(true)
        const { R2_SECRET_ACCESS_KEY: _secret, ...partial } = r2
        const result = envSchema.safeParse({
            ...base,
            ...partial,
        })
        expect(result.error?.issues.map(issue => issue.path.join('.'))).toEqual([
            'R2_ENDPOINT',
        ])
    })

    it.each([
        '/tailor/',
        'tailor',
        'a//b/',
    ])('refuses the object prefix %j', prefix => {
        expect(
            envSchema.safeParse({
                ...base,
                R2_PREFIX: prefix,
            }).success,
        ).toBe(false)
    })
})
