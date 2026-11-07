import { describe, expect, it } from 'vitest'
import { cvFileName } from './cv-file-name.js'

describe('cvFileName', () => {
    it.each([
        [
            'Senior Full-stack Engineer',
            'Nick-Lukashik-Senior-Full-Stack-Engineer-CV.pdf',
        ],
        [
            'AI / Product engineer (Remote)',
            'Nick-Lukashik-AI-Product-Engineer-Remote-CV.pdf',
        ],
        [
            '',
            'Nick-Lukashik-CV.pdf',
        ],
        [
            'Инженер',
            'Nick-Lukashik-CV.pdf',
        ],
    ])('names the CV for role %j', (role, name) => {
        expect(cvFileName('Nick Lukashik', role)).toBe(name)
    })
})
