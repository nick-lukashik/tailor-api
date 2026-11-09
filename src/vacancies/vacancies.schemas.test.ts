import { describe, expect, it } from 'vitest'
import { vacancyIntakeSchema } from './vacancies.schemas.js'

const paths = (input: unknown) => {
    const result = vacancyIntakeSchema.safeParse(input)
    expect(result.success).toBe(false)
    return result.error?.issues.map(issue => issue.path.join('.'))
}

describe('vacancy intake schema', () => {
    it('takes a link, a text or both, and trims the text', () => {
        expect(
            vacancyIntakeSchema.parse({
                items: [
                    {
                        url: 'https://example.com/jobs/1',
                    },
                    {
                        text: '  Backend engineer  ',
                    },
                    {
                        url: 'http://example.com/jobs/2',
                        text: 'Frontend',
                    },
                ],
            }),
        ).toEqual({
            items: [
                {
                    url: 'https://example.com/jobs/1',
                    text: '',
                },
                {
                    text: 'Backend engineer',
                },
                {
                    url: 'http://example.com/jobs/2',
                    text: 'Frontend',
                },
            ],
        })
    })

    it('points at the item that has neither a link nor a text', () => {
        expect(
            paths({
                items: [
                    {
                        text: 'ok',
                    },
                    {},
                    {
                        text: '   ',
                    },
                ],
            }),
        ).toEqual([
            'items.1',
            'items.2',
        ])
    })

    it.each([
        [
            {
                items: [],
            },
            'items',
        ],
        [
            {
                items: Array.from(
                    {
                        length: 201,
                    },
                    () => ({
                        text: 'x',
                    }),
                ),
            },
            'items',
        ],
        [
            {
                items: [
                    {
                        url: 'javascript:alert(1)',
                    },
                ],
            },
            'items.0.url',
        ],
        [
            {
                items: [
                    {
                        url: 'not a link',
                    },
                ],
            },
            'items.0.url',
        ],
        [
            {
                items: [
                    {
                        url: `https://example.com/${'x'.repeat(2048)}`,
                    },
                ],
            },
            'items.0.url',
        ],
        [
            {
                items: [
                    {
                        text: 'x'.repeat(100_001),
                    },
                ],
            },
            'items.0.text',
        ],
        [
            {
                items: [
                    {
                        link: 'https://example.com',
                    },
                ],
            },
            'items.0',
        ],
        [
            {},
            'items',
        ],
    ])('rejects %# at %s', (input, path) => {
        expect(paths(input)?.[0]).toBe(path)
    })

    it('accepts 200 items', () => {
        expect(
            vacancyIntakeSchema.safeParse({
                items: Array.from(
                    {
                        length: 200,
                    },
                    () => ({
                        text: 'x',
                    }),
                ),
            }).success,
        ).toBe(true)
    })
})
