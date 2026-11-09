import { describe, expect, it } from 'vitest'
import { exampleProfile } from '../../test/fixtures/profile.js'
import { profileDocumentSchema } from '../profile/profile.schemas.js'
import { CV_LINK_PLACEHOLDER, clip, finishMaterials, fitWithLink, materialsLanguage } from './materials.js'
import { materialsSystemPrompt, signatureOf } from './materials.prompts.js'
import type { MaterialsAnswer } from './materials.schemas.js'

const URL = 'https://cv.example.com/019a5f00-0000-7000-8000-00000000c001/Alex-Example-Senior-Backend-Engineer-CV.pdf'

const answer: MaterialsAnswer = {
    coverLetter: 'Hi,\n\nWhat draws me in is the checkout.\n\nAlex',
    emailSubject: 'Senior Backend Engineer:\na faster checkout',
    emailBody: `Hello,\n\nMy CV: ${CV_LINK_PLACEHOLDER}\n\nAlex`,
    telegramMessage: `Hi! I made a checkout 2x as fast — on Node.js. CV: ${CV_LINK_PLACEHOLDER}`,
    linkedinNote: 'Hi, about the Senior Backend Engineer role: I made a checkout 2x as fast.',
    whyMe: [
        '- Node.js in production for years',
        '• A checkout 2x as fast',
        'Owns what he builds',
        'A fourth point',
    ],
}

describe('materials language', () => {
    it('follows the parsed language of the vacancy', () => {
        expect(
            materialsLanguage(
                {
                    language: 'ru',
                },
                'Senior Backend Engineer',
            ),
        ).toBe('ru')
        expect(
            materialsLanguage(
                {
                    language: 'de',
                },
                'Ищем разработчика',
            ),
        ).toBe('en')
    })

    it('reads a vacancy without a parsed language by its script', () => {
        expect(
            materialsLanguage(
                {
                    language: null,
                },
                'Ищем backend-разработчика на Node.js в команду платформы',
            ),
        ).toBe('ru')
        expect(
            materialsLanguage(
                {
                    language: null,
                },
                'We hire a backend engineer, зарплата в рублях',
            ),
        ).toBe('en')
        expect(
            materialsLanguage(
                {
                    language: null,
                },
                '',
            ),
        ).toBe('en')
    })
})

describe('CV link substitution', () => {
    it('puts the real link where the model wrote the placeholder', () => {
        const content = finishMaterials(answer, {
            cvUrl: URL,
            language: 'en',
        })
        expect(content.emailBody).toBe(`Hello,\n\nMy CV: ${URL}\n\nAlex`)
        expect(content.telegramMessage).toBe(`Hi! I made a checkout 2x as fast, on Node.js. CV: ${URL}`)
        expect(JSON.stringify(content)).not.toContain(CV_LINK_PLACEHOLDER)
    })

    it('adds the link to the e-mail and the Telegram message when the model left it out', () => {
        const content = finishMaterials(
            {
                ...answer,
                emailBody: 'Hello,\n\nAlex',
                telegramMessage: 'Hi!',
            },
            {
                cvUrl: URL,
                language: 'en',
            },
        )
        expect(content.emailBody).toBe(`Hello,\n\nAlex\n\n${URL}`)
        expect(content.telegramMessage).toBe(`Hi!\n\n${URL}`)
    })

    it('keeps the link whole when a message is clipped to its limit', () => {
        const long = `${'I made a checkout fast. '.repeat(40)}CV: ${CV_LINK_PLACEHOLDER} Alex`
        const message = fitWithLink(long, URL, 600, true)
        expect(message.length).toBeLessThanOrEqual(600)
        expect(message.endsWith(`\n\n${URL}`)).toBe(true)
        expect(message).toMatch(/fast\.\n\n/)
    })

    it('cleans the rest: one-line subject, no long dash, three points without bullets, the LinkedIn limit', () => {
        const content = finishMaterials(
            {
                ...answer,
                linkedinNote: 'word '.repeat(100),
            },
            {
                cvUrl: URL,
                language: 'en',
            },
        )
        expect(content.emailSubject).toBe('Senior Backend Engineer: a faster checkout')
        expect(content.whyMe).toEqual([
            'Node.js in production for years',
            'A checkout 2x as fast',
            'Owns what he builds',
        ])
        expect(content.linkedinNote.length).toBeLessThanOrEqual(300)
        expect(content.linkedinNote.endsWith('word…')).toBe(true)
        expect(content.language).toBe('en')
    })

    it('clips at the last whole sentence', () => {
        expect(clip('One two three. Four five six seven.', 20)).toBe('One two three.')
        expect(clip('Short.', 20)).toBe('Short.')
    })
})

describe('materials prompt', () => {
    const profile = profileDocumentSchema.parse(exampleProfile())

    it("closes with the person's own letter instructions and names the language", () => {
        const prompt = materialsSystemPrompt('ru', profile.settings.promptAdditions.letters)
        expect(prompt).toMatch(/entirely in Russian/)
        expect(prompt).toMatch(/End every text with a question\.$/)
        expect(materialsSystemPrompt('en', '')).toMatch(/Never use the long dash\.$/)
    })

    it('signs in the language of the texts, else in English', () => {
        expect(signatureOf(profile, 'en')).toBe('Alex')
        expect(signatureOf(profile, 'ru')).toBe('Алекс Пример')
    })
})
