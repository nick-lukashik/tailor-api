import { describe, expect, it } from 'vitest'
import { envSchema } from './env.js'

const base = {
    DATABASE_URL: 'postgres://app:app@localhost:5432/app',
}

describe('TAILOR_USERS', () => {
    it('is nobody when unset or blank', () => {
        expect(envSchema.parse(base).TAILOR_USERS).toEqual([])
        expect(
            envSchema.parse({
                ...base,
                TAILOR_USERS: ' , ',
            }).TAILOR_USERS,
        ).toEqual([])
    })

    it('reads comma-separated ids, trimmed and lowercased', () => {
        expect(
            envSchema.parse({
                ...base,
                TAILOR_USERS: ' 019A5F00-0000-7000-8000-000000000001 ,019a5f00-0000-7000-8000-000000000002',
            }).TAILOR_USERS,
        ).toEqual([
            '019a5f00-0000-7000-8000-000000000001',
            '019a5f00-0000-7000-8000-000000000002',
        ])
    })

    it('stops the start on anything that is not a user id', () => {
        const result = envSchema.safeParse({
            ...base,
            TAILOR_USERS: '019a5f00-0000-7000-8000-000000000001,owner@example.com',
        })
        expect(result.success).toBe(false)
        expect(result.error?.issues[0]?.path).toEqual([
            'TAILOR_USERS',
            1,
        ])
    })
})
