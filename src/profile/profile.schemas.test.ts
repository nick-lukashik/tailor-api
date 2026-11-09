import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { exampleProfile } from '../../test/fixtures/profile.js'
import { profileDocumentSchema, profileJsonSchema, profileSections, settingsSchema } from './profile.schemas.js'

const issuesOf = (input: unknown) => {
    const result = profileDocumentSchema.safeParse(input)
    return result.success
        ? []
        : result.error.issues.map(issue => ({
              path: issue.path.join('.'),
              message: issue.message,
          }))
}

describe('profile document', () => {
    it('reads {} as an empty profile with every section', () => {
        const empty = profileDocumentSchema.parse({})
        expect(Object.keys(empty)).toEqual([
            ...profileSections,
        ])
        expect(empty).toMatchObject({
            person: {
                names: [],
                links: [],
                location: {
                    city: '',
                },
            },
            cases: [],
            applicationFacts: {
                eeo: 'prefer_not_to_say',
            },
            settings: {
                maxPages: 2,
                template: 'minimal-violet',
                cvLocale: 'en',
                factsMode: 'strict',
                cvShowLocation: true,
                cvShowPhone: true,
                promptAdditions: {
                    cv: '',
                },
            },
        })
    })

    it('keeps an old settings section valid: the prompt additions default to empty', () => {
        const parsed = settingsSchema.parse({
            maxPages: 1,
            cvShowPhone: false,
        })
        expect(parsed.promptAdditions).toEqual({
            cv: '',
        })
        expect(
            settingsSchema.safeParse({
                promptAdditions: {
                    cv: 'x'.repeat(4_001),
                },
            }).success,
        ).toBe(false)
    })

    it('keeps a full profile as it is', () => {
        const profile = exampleProfile()
        expect(profileDocumentSchema.parse(profile)).toEqual(profile)
    })

    it('fills a missing rating with 0 and a missing end with null', () => {
        const profile = exampleProfile()
        const { categoryRatings, ...rest } = profile.cases[0] ?? {}
        const { end, ...employment } = profile.employments[0] ?? {}
        const parsed = profileDocumentSchema.parse({
            ...profile,
            employments: [
                employment,
            ],
            cases: [
                rest,
            ],
        })
        expect(parsed.cases[0]?.categoryRatings.AI).toBe(0)
        expect(parsed.employments[0]?.end).toBeNull()
    })

    it('rejects unknown fields, at their path', () => {
        const profile = exampleProfile()
        expect(
            issuesOf({
                ...profile,
                persn: {},
            }),
        ).toEqual([
            {
                path: '',
                message: expect.stringContaining('persn'),
            },
        ])
        expect(
            issuesOf({
                cases: [
                    {
                        ...profile.cases[0],
                        categoryRatings: {
                            XX: 1,
                        },
                    },
                ],
                employments: profile.employments,
            }).map(issue => issue.path),
        ).toEqual([
            'cases.0.categoryRatings',
        ])
    })

    it('names every bad field of a section', () => {
        expect(
            issuesOf({
                person: {
                    email: 'not-an-email',
                    links: [
                        {
                            kind: 'myspace',
                            url: 'javascript:alert(1)',
                        },
                    ],
                },
                employments: [
                    {
                        id: 'x',
                        company: {
                            name: 'X',
                        },
                        title: 'Engineer',
                        start: '2024-13',
                    },
                ],
            }).map(issue => issue.path),
        ).toEqual([
            'person.email',
            'person.links.0.kind',
            'person.links.0.url',
            'employments.0.start',
        ])
    })

    it('checks that cases point at an employment and its project, and that ids are unique', () => {
        const profile = exampleProfile()
        const [first] = profile.cases
        expect(
            issuesOf({
                ...profile,
                cases: [
                    first,
                    first,
                    {
                        ...first,
                        id: 'c2',
                        employmentId: 'nowhere',
                    },
                    {
                        ...first,
                        id: 'c3',
                        projectId: 'other-project',
                    },
                ],
            }),
        ).toEqual([
            {
                path: 'cases.1.id',
                message: 'duplicate id "c1"',
            },
            {
                path: 'cases.2.employmentId',
                message: 'no employment "nowhere"',
            },
            {
                path: 'cases.3.projectId',
                message: 'no project "other-project" in employment "acme"',
            },
        ])
    })

    it('has a JSON Schema for editors', () => {
        const schema = profileJsonSchema() as {
            properties: Record<string, unknown>
            additionalProperties: boolean
        }
        expect(Object.keys(schema.properties)).toEqual([
            ...profileSections,
        ])
        expect(schema.additionalProperties).toBe(false)
        expect(() =>
            z.toJSONSchema(profileDocumentSchema, {
                target: 'openapi-3.0',
            }),
        ).not.toThrow()
    })
})
