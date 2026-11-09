import { Readable } from 'node:stream'
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client, S3ServiceException } from '@aws-sdk/client-s3'
import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common'
import type { ConfigType } from '@nestjs/config'
import { storageConfig } from '../config/config.js'

/** A put or head: the object is small (a CV is about 100 KB), so this is generous. */
export const STORAGE_WRITE_TIMEOUT_MS = 15_000
/** A read for a request: below its 10 s budget. */
export const STORAGE_READ_TIMEOUT_MS = 8_000

/**
 * A failed storage call. `code` is short and stored on the CV: `storage_not_configured`
 * (no R2 keys), `storage_unavailable` (network, 5xx, a timeout: worth a retry),
 * `storage_refused` (another 4xx: wrong keys or bucket, not retried).
 */
export class StorageError extends Error {
    constructor(
        readonly code: 'storage_not_configured' | 'storage_unavailable' | 'storage_refused',
        readonly status?: number,
    ) {
        super(`Object storage failed: ${code}`)
        this.name = 'StorageError'
    }

    get retryable() {
        return this.code === 'storage_unavailable'
    }
}

export type StoredObject = {
    size: number
    contentType?: string
}

export type ObjectStream = StoredObject & {
    body: Readable
}

const statusOf = (error: unknown) => (error instanceof S3ServiceException ? error.$metadata.httpStatusCode : undefined)

/**
 * The service's files in Cloudflare R2 through its S3 API (`R2_*`): one bucket,
 * every key under `R2_PREFIX`. Without the keys `configured` is false and every
 * call throws `storage_not_configured`; the service still starts.
 */
@Injectable()
export class ObjectStorage implements OnApplicationShutdown {
    private readonly logger = new Logger(ObjectStorage.name)
    private readonly client?: S3Client

    constructor(@Inject(storageConfig.KEY) private readonly config: ConfigType<typeof storageConfig>) {
        const { endpoint, accessKeyId, secretAccessKey } = config
        if (endpoint && accessKeyId && secretAccessKey)
            this.client = new S3Client({
                endpoint,
                // R2 takes `auto`; S3-compatible stand-ins in tests take any.
                region: 'auto',
                credentials: {
                    accessKeyId,
                    secretAccessKey,
                },
                // Bucket in the path: works for R2 and for local stand-ins alike.
                forcePathStyle: true,
                // Checksums only where the API requires them: R2 and stand-ins differ in the optional ones.
                requestChecksumCalculation: 'WHEN_REQUIRED',
                responseChecksumValidation: 'WHEN_REQUIRED',
                maxAttempts: 2,
                requestHandler: {
                    connectionTimeout: 2_000,
                    requestTimeout: 10_000,
                },
            })
    }

    get configured() {
        return this.client !== undefined
    }

    /** `cv/<id>.pdf` → `tailor/cv/<id>.pdf`. */
    key(path: string) {
        return `${this.config.prefix}${path}`
    }

    async put(key: string, body: Buffer, contentType: string): Promise<void> {
        await this.call('put', key, false, STORAGE_WRITE_TIMEOUT_MS, (client, abortSignal) =>
            client.send(
                new PutObjectCommand({
                    Bucket: this.config.bucket,
                    Key: key,
                    Body: body,
                    ContentType: contentType,
                    ContentLength: body.length,
                }),
                {
                    abortSignal,
                },
            ),
        )
    }

    /** Its size and type, or undefined when there is no such object. */
    async head(key: string): Promise<StoredObject | undefined> {
        const head = await this.call('head', key, true, STORAGE_WRITE_TIMEOUT_MS, (client, abortSignal) =>
            client.send(
                new HeadObjectCommand({
                    Bucket: this.config.bucket,
                    Key: key,
                }),
                {
                    abortSignal,
                },
            ),
        )
        return head
            ? {
                  size: head.ContentLength ?? 0,
                  contentType: head.ContentType,
              }
            : undefined
    }

    /** The object as a stream, or undefined when there is none. The deadline covers the whole read. */
    async get(key: string): Promise<ObjectStream | undefined> {
        const object = await this.call('get', key, true, STORAGE_READ_TIMEOUT_MS, (client, abortSignal) =>
            client.send(
                new GetObjectCommand({
                    Bucket: this.config.bucket,
                    Key: key,
                }),
                {
                    abortSignal,
                },
            ),
        )
        if (!object?.Body) return undefined
        return {
            body: object.Body instanceof Readable ? object.Body : Readable.fromWeb(object.Body.transformToWebStream()),
            size: object.ContentLength ?? 0,
            contentType: object.ContentType,
        }
    }

    onApplicationShutdown() {
        this.client?.destroy()
    }

    /**
     * One call with its deadline. A missing object is undefined when `missing`
     * allows it (a read); a missing bucket and any other failure are a StorageError.
     */
    private async call<T>(
        operation: string,
        key: string,
        missing: boolean,
        timeoutMs: number,
        send: (client: S3Client, signal: AbortSignal) => Promise<T>,
    ): Promise<T | undefined> {
        if (!this.client) throw new StorageError('storage_not_configured')
        try {
            return await send(this.client, AbortSignal.timeout(timeoutMs))
        } catch (error) {
            const status = statusOf(error)
            if (missing && status === 404 && !(error instanceof Error && error.name === 'NoSuchBucket'))
                return undefined
            const failure = new StorageError(
                status !== undefined && status >= 400 && status < 500 && status !== 408 && status !== 429
                    ? 'storage_refused'
                    : 'storage_unavailable',
                status,
            )
            // The key names an application and a CV id, nothing personal; never the body.
            this.logger.warn(
                {
                    operation,
                    key,
                    status,
                    code: failure.code,
                    reason: error instanceof Error ? error.name : 'unknown',
                },
                'Object storage call failed',
            )
            throw failure
        }
    }
}
