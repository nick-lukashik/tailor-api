import { describe, expect, it } from 'vitest'
import { canonicalJson, documentHash } from './canonical-json.js'

describe('canonical JSON', () => {
    it('sorts keys at every level and keeps array order', () => {
        expect(
            canonicalJson({
                b: 1,
                a: {
                    d: [
                        {
                            y: 1,
                            x: 2,
                        },
                        3,
                    ],
                    c: null,
                },
            }),
        ).toBe('{"a":{"c":null,"d":[{"x":2,"y":1},3]},"b":1}')
    })

    it('hashes equal documents equally, whatever the key order', () => {
        const one = documentHash({
            a: 1,
            b: [
                1,
                2,
            ],
        })
        expect(one).toMatch(/^[0-9a-f]{64}$/)
        expect(
            documentHash({
                b: [
                    1,
                    2,
                ],
                a: 1,
            }),
        ).toBe(one)
        expect(
            documentHash({
                a: 1,
                b: [
                    2,
                    1,
                ],
            }),
        ).not.toBe(one)
    })
})
