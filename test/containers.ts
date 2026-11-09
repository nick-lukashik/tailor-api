/** Same majors as compose.yaml and production; a capability added later adds its image here. */
export const IMAGES = {
    postgres: 'postgres:18.6-alpine',
    /** An S3 API stand-in for Cloudflare R2 (MinIO no longer publishes images). It does not check signatures. */
    s3: 'adobe/s3mock:4.7.0',
}

/** The bucket the S3 stand-in creates at start. */
export const TEST_BUCKET = 'tailor-test'
