import { z } from 'zod'
import { baseEnvSchema, defineEnv, metricsEnvSchema, postgresEnvSchema } from '../common/config/define-env.js'

/** Reasoning efforts a parse model may be given (`reasoning_effort` of the gateway). */
export const PARSE_EFFORTS = [
    'minimal',
    'low',
    'medium',
    'high',
] as const

/** A model id as a part of a queue name: `gpt-6.1-sol` → `gpt-6-1-sol`. */
export const modelSlug = (model: string) => model.replace(/[^a-z0-9]+/g, '-')

const parseModelEntry = z
    .tuple([
        z.string().regex(/^[a-z0-9]+([._-][a-z0-9]+)*$/, {
            error: 'a gateway model id such as claude-sonnet-5-5',
        }),
        z.enum(PARSE_EFFORTS),
        z.coerce.number().int().min(1).max(10),
    ])
    .transform(([model, effort, concurrency]) => ({
        model,
        effort,
        concurrency,
    }))

/** `model:effort:concurrency,…`: the models that parse vacancies, one queue each, in this order on a tie. */
const parseModels = z
    .string()
    .default('claude-sonnet-5-5:low:3,gpt-6.1-sol:low:3')
    .transform((value): unknown => value.split(',').map(entry => entry.split(':').map(part => part.trim())))
    .pipe(
        z
            .array(parseModelEntry)
            .min(1)
            .refine(entries => new Set(entries.map(entry => modelSlug(entry.model))).size === entries.length, {
                error: 'every model at most once',
                // Only once every entry parsed.
                when: payload => payload.issues.length === 0,
            }),
    )

export type ParseModel = z.output<typeof parseModelEntry>

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
        /** The platform LLM gateway (OpenAI-compatible), its client key and the models that parse vacancies. */
        LLM_GATEWAY_URL: z.url().default('http://llm-gateway.prod.svc'),
        LLM_GATEWAY_KEY: z.string().min(32, {
            error: 'at least 32 characters (the client key of tailor-api in llm-gateway)',
        }),
        LLM_PARSE_MODELS: parseModels,
    })

export type Env = z.output<typeof envSchema>

export const env = defineEnv(envSchema)
