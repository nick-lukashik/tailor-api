import { registerAs } from '@nestjs/config'
import { env } from './env.js'

/** Service name: logs, metrics, connection names. Rename it with the repo. */
export const SERVICE_NAME = 'tailor-api'

export const appConfig = registerAs('app', () => ({
    service: SERVICE_NAME,
    nodeEnv: env().NODE_ENV,
    production: env().NODE_ENV === 'production',
    port: env().PORT,
    version: env().APP_VERSION,
    logLevel: env().LOG_LEVEL,
    trustProxyHops: env().TRUST_PROXY_HOPS,
    shutdownDelayMs: env().SHUTDOWN_DELAY_MS,
    metricsPort: env().METRICS_PORT,
}))

export const dbConfig = registerAs('db', () => ({
    url: env().DATABASE_URL,
    max: env().DATABASE_POOL_MAX,
}))

export const authConfig = registerAs('auth', () => ({
    jwksUrl: env().ID_JWKS_URL,
    issuer: env().TOKEN_ISSUER,
    audience: env().TOKEN_AUDIENCE,
}))

export const texConfig = registerAs('tex', () => ({
    url: env().TAILOR_TEX_URL.replace(/\/+$/, ''),
    token: env().TAILOR_TEX_TOKEN,
}))

export const llmConfig = registerAs('llm', () => ({
    url: env().LLM_GATEWAY_URL.replace(/\/+$/, ''),
    key: env().LLM_GATEWAY_KEY,
    parseModels: env().LLM_PARSE_MODELS,
    cvModels: env().LLM_CV_MODELS,
    lettersModels: env().LLM_LETTERS_MODELS,
}))

export const storageConfig = registerAs('storage', () => ({
    endpoint: env().R2_ENDPOINT,
    accessKeyId: env().R2_ACCESS_KEY_ID,
    secretAccessKey: env().R2_SECRET_ACCESS_KEY,
    bucket: env().R2_BUCKET,
    prefix: env().R2_PREFIX,
}))

export const cvConfig = registerAs('cv', () => ({
    publicUrl: env().CV_PUBLIC_URL.replace(/\/+$/, ''),
}))

const base = (url: string) => url.replace(/\/+$/, '')

export const fetchConfig = registerAs('fetch', () => ({
    enabled: env().VACANCY_FETCH_ENABLED,
    allowPrivate: env().VACANCY_FETCH_ALLOW_PRIVATE,
    greenhouseUrl: base(env().VACANCY_FETCH_GREENHOUSE_URL),
    leverApiUrl: base(env().VACANCY_FETCH_LEVER_API_URL),
    leverJobsUrl: base(env().VACANCY_FETCH_LEVER_JOBS_URL),
    ashbyUrl: base(env().VACANCY_FETCH_ASHBY_URL),
    workableUrl: base(env().VACANCY_FETCH_WORKABLE_URL),
}))
