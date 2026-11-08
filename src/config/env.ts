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
    })

export type Env = z.output<typeof envSchema>

export const env = defineEnv(envSchema)
