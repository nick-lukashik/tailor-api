import { describe, expect, it } from 'vitest'
import { vacancyUrlKey } from './url-key.js'

describe('vacancyUrlKey', () => {
    it.each([
        [
            'https://example.com/jobs/1',
            'https://example.com/jobs/1',
        ],
        [
            'HTTPS://WWW.Example.COM/jobs/1/',
            'https://example.com/jobs/1',
        ],
        [
            'https://example.com/jobs/1#apply',
            'https://example.com/jobs/1',
        ],
        [
            'https://example.com/jobs/1?utm_source=x&UTM_Campaign=y&gclid=1&fbclid=2&ref=a&source=b&src=c&trk=d',
            'https://example.com/jobs/1',
        ],
        [
            'https://example.com/jobs?b=2&a=1&utm_medium=mail&a=0',
            'https://example.com/jobs?a=0&a=1&b=2',
        ],
        [
            'https://example.com/',
            'https://example.com',
        ],
        [
            'http://example.com:8080/Jobs/One',
            'http://example.com:8080/Jobs/One',
        ],
        [
            'https://example.com:443/jobs',
            'https://example.com/jobs',
        ],
        [
            'https://user:secret@example.com/jobs',
            'https://example.com/jobs',
        ],
        [
            'https://jobs.www.example.com/1',
            'https://jobs.www.example.com/1',
        ],
    ])('%s → %s', (input, key) => {
        expect(vacancyUrlKey(input)).toBe(key)
    })

    it('gives the same key to the same vacancy behind tracking, www and a slash', () => {
        expect(vacancyUrlKey('https://www.example.com/jobs/7/?utm_source=feed&id=3#top')).toBe(
            vacancyUrlKey('https://example.com/jobs/7?id=3'),
        )
    })

    it('keeps the scheme and the path case apart', () => {
        expect(vacancyUrlKey('http://example.com/a')).not.toBe(vacancyUrlKey('https://example.com/a'))
        expect(vacancyUrlKey('https://example.com/A')).not.toBe(vacancyUrlKey('https://example.com/a'))
    })

    it('rejects links that are not http(s) or not links at all', () => {
        expect(() => vacancyUrlKey('ftp://example.com/jobs')).toThrow()
        expect(() => vacancyUrlKey('javascript:alert(1)')).toThrow()
        expect(() => vacancyUrlKey('not a link')).toThrow()
    })
})
