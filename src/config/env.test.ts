import { describe, expect, it } from 'vitest'
import { envSchema } from './env.js'

const base = {
    DATABASE_URL: 'postgres://app:app@localhost:5432/app',
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
})
