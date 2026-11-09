import { describe, expect, it } from 'vitest'
import { CV_FILE_NAME_MAX, cvFileName } from './cv-file-name.js'

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
        [
            'Développeur Full-Stack',
            'Nick-Lukashik-Developpeur-Full-Stack-CV.pdf',
        ],
    ])('names the CV for role %j', (role, name) => {
        expect(cvFileName('Nick Lukashik', role)).toBe(name)
    })

    it('takes the person and stays ASCII and within 120 characters, cutting the role by whole words', () => {
        const name = cvFileName('Alex Example', `Senior ${'Platform '.repeat(30)}Engineer`)
        expect(name.length).toBeLessThanOrEqual(CV_FILE_NAME_MAX)
        expect(name).toMatch(/^Alex-Example-Senior(-Platform)+-CV\.pdf$/)
        expect(name).toMatch(/^[A-Za-z0-9-]+\.pdf$/)
    })

    it('never gives an empty name', () => {
        expect(cvFileName('', '')).toBe('Resume-CV.pdf')
    })
})
