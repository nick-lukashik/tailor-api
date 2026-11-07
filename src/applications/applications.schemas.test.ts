import { describe, expect, it } from 'vitest'
import { createApplicationSchema, listApplicationsQuerySchema } from './applications.schemas.js'

describe('applications schemas', () => {
    it('trims the company and defaults the vacancy text', () => {
        expect(
            createApplicationSchema.parse({
                company: '  Hi  ',
            }),
        ).toEqual({
            company: 'Hi',
            role: '',
            vacancyText: '',
        })
    })

    it.each([
        [
            {
                company: '',
            },
            'company',
        ],
        [
            {
                company: '   ',
            },
            'company',
        ],
        [
            {
                company: 'x'.repeat(201),
            },
            'company',
        ],
        [
            {
                company: 'ok',
                vacancyText: 'x'.repeat(50_001),
            },
            'vacancyText',
        ],
        [
            {},
            'company',
        ],
    ])('rejects %j at %s', (input, path) => {
        const result = createApplicationSchema.safeParse(input)
        expect(result.success).toBe(false)
        expect(result.error?.issues[0]?.path).toEqual([
            path,
        ])
    })

    it('rejects unknown fields', () => {
        const result = createApplicationSchema.safeParse({
            company: 'ok',
            compnay: 'typo',
        })
        expect(result.success).toBe(false)
        expect(result.error?.issues[0]?.code).toBe('unrecognized_keys')
    })

    it('coerces and bounds the page size', () => {
        expect(listApplicationsQuerySchema.parse({})).toEqual({
            limit: 20,
        })
        expect(
            listApplicationsQuerySchema.parse({
                limit: '5',
            }).limit,
        ).toBe(5)
        expect(
            listApplicationsQuerySchema.safeParse({
                limit: '101',
            }).success,
        ).toBe(false)
        expect(
            listApplicationsQuerySchema.safeParse({
                limit: '1.5',
            }).success,
        ).toBe(false)
    })
})
