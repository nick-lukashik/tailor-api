import { describe, expect, it } from 'vitest'
import { CV_TITLE_MAX, cvTitle, validCvTitle } from './title.js'

const headline = 'Senior Full-Stack Engineer'

describe('the title of a tailored CV', () => {
    it("takes the model's English role name", () => {
        expect(
            cvTitle({
                proposed: ' Senior Backend Engineer (Python) ',
                vacancyTitle: 'Backend-разработчик Python (начинающий)',
                headline,
            }),
        ).toBe('Senior Backend Engineer (Python)')
    })

    it('refuses non-ASCII, entry-level and long titles', () => {
        expect(validCvTitle('Backend-разработчик Python')).toBeUndefined()
        expect(validCvTitle('Python Developer (начинающий)')).toBeUndefined()
        for (const title of [
            'Junior Python Developer',
            'Entry-Level Backend Engineer',
            'Beginner Developer',
            'Trainee Engineer',
            'Software Engineer Intern',
        ])
            expect(validCvTitle(title), title).toBeUndefined()
        expect(validCvTitle('A'.repeat(CV_TITLE_MAX + 1))).toBeUndefined()
        expect(validCvTitle('A'.repeat(CV_TITLE_MAX))).toBe('A'.repeat(CV_TITLE_MAX))
        // A word that only starts like one is fine.
        expect(validCvTitle('Internal Tools Engineer')).toBe('Internal Tools Engineer')
    })

    it("falls back to the vacancy's title when it is English, else to the profile's headline", () => {
        expect(
            cvTitle({
                proposed: 'Junior Python Developer',
                vacancyTitle: 'Senior Développeur Backend – Python',
                headline,
            }),
        ).toBe('Senior Developpeur Backend - Python')
        expect(
            cvTitle({
                proposed: 'Бэкенд-разработчик',
                vacancyTitle: 'Backend-разработчик Python (начинающий)',
                headline,
            }),
        ).toBe(headline)
        expect(
            cvTitle({
                proposed: '',
                vacancyTitle: 'Junior Backend Developer',
                headline,
            }),
        ).toBe(headline)
        expect(
            cvTitle({
                proposed: 'Senior Backend Engineer With A Very Long Title That Goes On And On',
                vacancyTitle: null,
                headline,
            }),
        ).toBe(headline)
    })
})
