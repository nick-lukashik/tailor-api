import { z } from 'zod'
import { baseEnvSchema, defineEnv, metricsEnvSchema, postgresEnvSchema } from '../common/config/define-env.js'

/** `uuid,uuid,…` with spaces and empty entries ignored; every entry must be a uuid. */
const userList = z
    .string()
    .default('')
    .transform(value =>
        value
            .split(',')
            .map(entry => entry.trim().toLowerCase())
            .filter(Boolean),
    )
    .pipe(
        z.array(
            z.uuid({
                error: 'a comma-separated list of user ids (uuid)',
            }),
        ),
    )

/** Every variable this service reads. Nothing else touches process.env. */
export const envSchema = baseEnvSchema
    .extend(postgresEnvSchema.shape)
    .extend(metricsEnvSchema.shape)
    .extend({
        /** Access tokens of id-api (JWKS, issuer, audience). */
        ID_JWKS_URL: z.url().default('http://id-api.prod.svc/.well-known/jwks.json'),
        TOKEN_ISSUER: z.url().default('https://id.nick-lukashik.com'),
        TOKEN_AUDIENCE: z.string().min(1).default('nick-lukashik'),
        /** Who may use Tailor (D-112): user ids of id-api. Anyone else signed in gets 403 NOT_INVITED. */
        TAILOR_USERS: userList,
        /** tailor-tex, the internal CV renderer (CvDocument JSON → PDF). */
        TAILOR_TEX_URL: z.url().default('http://tailor-tex.prod.svc'),
        /** Its INTERNAL_API_TOKEN. Unset: the routes that build a PDF answer 503. */
        TAILOR_TEX_TOKEN: z
            .string()
            .min(32, {
                error: 'at least 32 characters (the INTERNAL_API_TOKEN of tailor-tex)',
            })
            .optional(),
    })

export type Env = z.output<typeof envSchema>

export const env = defineEnv(envSchema)
