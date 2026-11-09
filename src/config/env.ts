import { z } from 'zod'
import { baseEnvSchema, defineEnv, metricsEnvSchema, postgresEnvSchema } from '../common/config/define-env.js'

/** Every variable this service reads. Nothing else touches process.env. */
export const envSchema = baseEnvSchema
    .extend(postgresEnvSchema.shape)
    .extend(metricsEnvSchema.shape)
    .extend({
        /** Access tokens of id-api (JWKS, issuer, audience). */
        ID_JWKS_URL: z.url().default('http://id-api.prod.svc/.well-known/jwks.json'),
        TOKEN_ISSUER: z.url().default('https://id.nick-lukashik.com'),
        TOKEN_AUDIENCE: z.string().min(1).default('nick-lukashik'),
        /** tailor-tex, the internal CV renderer (CvDocument JSON → PDF). */
        TAILOR_TEX_URL: z.url().default('http://tailor-tex.prod.svc'),
        /** Its INTERNAL_API_TOKEN. Unset: the routes that build a PDF answer 503. */
        TAILOR_TEX_TOKEN: z
            .string()
            .min(32, {
                error: 'at least 32 characters (the INTERNAL_API_TOKEN of tailor-tex)',
            })
            .optional(),
        /** The platform LLM gateway (OpenAI-compatible), its client key and the model that parses vacancies. */
        LLM_GATEWAY_URL: z.url().default('http://llm-gateway.prod.svc'),
        LLM_GATEWAY_KEY: z.string().min(32, {
            error: 'at least 32 characters (the client key of tailor-api in llm-gateway)',
        }),
        LLM_PARSE_MODEL: z.string().min(1).max(100).default('claude-haiku-5-5'),
    })

export type Env = z.output<typeof envSchema>

export const env = defineEnv(envSchema)
