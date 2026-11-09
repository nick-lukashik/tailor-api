import { randomUUID } from 'node:crypto'
import { text } from 'node:stream/consumers'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ObjectStorage, StorageError } from '../src/storage/object-storage.js'
import { startApp, type TestApp } from './harness.js'

describe('object storage (R2 through the S3 API, a stand-in here)', () => {
    let t: TestApp
    let storage: ObjectStorage

    beforeAll(async () => {
        t = await startApp()
        storage = t.app.get(ObjectStorage)
    })
    afterAll(async () => {
        await t?.close()
    })

    it('puts an object under the prefix, heads it and reads it back as a stream', async () => {
        const key = storage.key(`test/${randomUUID()}.txt`)
        expect(key).toMatch(/^tailor\/test\//)
        const body = Buffer.from('%PDF-1.4 a stand-in body')
        await storage.put(key, body, 'application/pdf')
        expect(await storage.head(key)).toEqual({
            size: body.length,
            contentType: 'application/pdf',
        })
        const object = await storage.get(key)
        expect(object).toMatchObject({
            size: body.length,
            contentType: 'application/pdf',
        })
        if (!object) throw new Error('no object')
        expect(await text(object.body)).toBe(body.toString())
    })

    it('reads a missing object as undefined', async () => {
        const key = storage.key(`test/${randomUUID()}.txt`)
        expect(await storage.head(key)).toBeUndefined()
        expect(await storage.get(key)).toBeUndefined()
    })
})

describe('object storage: not configured or unreachable', () => {
    let t: TestApp

    afterAll(async () => {
        await t?.close()
    })

    it('starts without the R2 keys and refuses every call with storage_not_configured', async () => {
        t = await startApp({
            R2_ENDPOINT: undefined,
            R2_ACCESS_KEY_ID: undefined,
            R2_SECRET_ACCESS_KEY: undefined,
        })
        const storage = t.app.get(ObjectStorage)
        expect(storage.configured).toBe(false)
        await expect(storage.put(storage.key('x'), Buffer.from('x'), 'text/plain')).rejects.toMatchObject({
            code: 'storage_not_configured',
            retryable: false,
        })
        await expect(storage.get(storage.key('x'))).rejects.toThrow(StorageError)
        await t.close()
    })

    it('fails a put to a missing bucket as storage_refused and an unreachable endpoint as storage_unavailable', async () => {
        t = await startApp({
            R2_BUCKET: 'no-such-bucket',
        })
        const missing = t.app.get(ObjectStorage)
        await expect(missing.put(missing.key('x'), Buffer.from('x'), 'text/plain')).rejects.toMatchObject({
            code: 'storage_refused',
            status: 404,
        })
        await t.close()

        t = await startApp({
            R2_ENDPOINT: 'http://127.0.0.1:9',
        })
        const down = t.app.get(ObjectStorage)
        await expect(down.head(down.key('x'))).rejects.toMatchObject({
            code: 'storage_unavailable',
            retryable: true,
        })
    })
})
