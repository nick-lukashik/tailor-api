import { describe, expect, it } from 'vitest'
import { jobPostingPage, leverApplyPage, plainJobPage } from '../../test/fixtures/vacancy-sites.js'
import { decodeEntities, formFields, htmlToText, jsonLdJobPosting, pageText } from './fetch-html.js'

describe('HTML to text', () => {
    it('keeps paragraphs and list items, drops tags, scripts and styles', () => {
        expect(
            htmlToText(
                '<style>p{}</style><p>Example Labs <b>builds</b> tools.</p><script>alert(1)</script><ul><li>Node.js</li><li>Go</li></ul><p>Line<br>break</p>',
            ),
        ).toBe('Example Labs builds tools.\n\n- Node.js\n- Go\n\nLine\nbreak')
    })

    it('decodes named and numeric entities', () => {
        expect(decodeEntities('R&amp;D &lt;3 &#8364;5&nbsp;k &#x2014; &unknown;')).toBe('R&D <3 €5 k — &unknown;')
    })

    it('reads the main content of a page without navigation, header, footer and forms', () => {
        const text = pageText(plainJobPage)
        expect(text).toContain('QA Engineer\n\nExample Labs is looking for a QA engineer')
        expect(text).toContain('- Playwright')
        expect(text).not.toMatch(/All jobs|Privacy|window\.x|Search/)
    })
})

describe('JSON-LD JobPosting', () => {
    it('takes the posting from a @graph, its escaped description as text', () => {
        expect(jsonLdJobPosting(jobPostingPage)).toEqual({
            title: 'Site Reliability Engineer',
            company: 'Example Labs',
            location: 'Example City, EX',
            description: 'Keep the platform up.\n\n- On-call',
        })
    })

    it('finds none in a page without one or with broken JSON', () => {
        expect(jsonLdJobPosting(plainJobPage)).toBeUndefined()
        expect(jsonLdJobPosting('<script type="application/ld+json">{oops</script>')).toBeUndefined()
    })
})

describe('apply form fields', () => {
    it('reads labels, required marks, radio groups, checkboxes and selects of a plain form', () => {
        expect(formFields(leverApplyPage)).toEqual([
            {
                key: 'resume',
                label: 'Resume/CV',
                type: 'file',
                required: true,
            },
            {
                key: 'name',
                label: 'Full name',
                type: 'text',
                required: true,
            },
            {
                key: 'email',
                label: 'Email',
                type: 'text',
                required: true,
            },
            {
                key: 'urls[LinkedIn]',
                label: 'LinkedIn URL',
                type: 'text',
                required: false,
            },
            {
                key: 'cards[c1][field0]',
                label: 'Do you have experience with React Native?',
                type: 'select',
                required: true,
                options: [
                    'Yes',
                    'No',
                ],
            },
            {
                key: 'cards[c2][field0]',
                label: 'Which time zones can you cover?',
                type: 'multiselect',
                required: false,
                options: [
                    'Europe',
                    'Americas',
                ],
            },
            {
                key: 'comments',
                label: 'Additional information',
                type: 'textarea',
                required: false,
            },
            {
                key: 'eeo[gender]',
                label: 'Additional information',
                type: 'select',
                required: false,
                options: [
                    'Female',
                    'Male',
                    'Decline to self-identify',
                ],
            },
        ])
    })

    it('finds nothing without a form', () => {
        expect(formFields('<p>No form here <input name="q"></p>')).toEqual([])
    })
})
