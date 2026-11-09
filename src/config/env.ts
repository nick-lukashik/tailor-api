import { z } from 'zod'
import { baseEnvSchema, defineEnv, metricsEnvSchema, postgresEnvSchema } from '../common/config/define-env.js'

/** Reasoning efforts a pool model may be given (`reasoning_effort` of the gateway). */
export const MODEL_EFFORTS = [
    'minimal',
    'low',
    'medium',
    'high',
] as const

/** A model id as a part of a queue name: `gpt-6.1-sol` → `gpt-6-1-sol`. */
export const modelSlug = (model: string) => model.replace(/[^a-z0-9]+/g, '-')

const poolModelEntry = z
    .tuple([
        z.string().regex(/^[a-z0-9]+([._-][a-z0-9]+)*$/, {
            error: 'a gateway model id such as claude-sonnet-5-5',
        }),
        z.enum(MODEL_EFFORTS),
        z.coerce.number().int().min(1).max(10),
    ])
    .transform(([model, effort, concurrency]) => ({
        model,
        effort,
        concurrency,
    }))

/** `model:effort:concurrency,…`: the models of a job, one queue each, in this order on a tie. */
const modelPool = (defaults: string) =>
    z
        .string()
        .default(defaults)
        .transform((value): unknown => value.split(',').map(entry => entry.split(':').map(part => part.trim())))
        .pipe(
            z
                .array(poolModelEntry)
                .min(1)
                .refine(entries => new Set(entries.map(entry => modelSlug(entry.model))).size === entries.length, {
                    error: 'every model at most once',
                    // Only once every entry parsed.
                    when: payload => payload.issues.length === 0,
                }),
        )

/** A model of a job's pool: its id, effort and how many calls a pod makes with it at once. */
export type PoolModelConfig = z.output<typeof poolModelEntry>

/** `tailor/`: a prefix of object keys, empty or ending in `/`, never starting with one. */
const objectPrefix = z
    .string()
    .regex(/^([A-Za-z0-9._-]+\/)*$/, {
        error: 'empty, or path segments each ending in /, e.g. tailor/',
    })
    .default('tailor/')

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
        /** The platform LLM gateway (OpenAI-compatible), its client key and the models that parse vacancies and write CVs. */
        LLM_GATEWAY_URL: z.url().default('http://llm-gateway.prod.svc'),
        LLM_GATEWAY_KEY: z.string().min(32, {
            error: 'at least 32 characters (the client key of tailor-api in llm-gateway)',
        }),
        LLM_PARSE_MODELS: modelPool('claude-sonnet-5-5:low:3,gpt-6.1-sol:low:3'),
        LLM_CV_MODELS: modelPool('claude-sonnet-5-5:low:3,gpt-6.1-sol:low:3'),
        /** The models that write the materials for applying by hand (cover letter, messages). */
        LLM_LETTERS_MODELS: modelPool('claude-sonnet-5-5:low:3,gpt-6.1-sol:low:3'),
        /**
         * Cloudflare R2 (S3 API) for the CV files: the account endpoint and an
         * API token's key pair, all three or none. Unset: the service starts,
         * and a CV generation fails with `storage_not_configured`.
         */
        R2_ENDPOINT: z.url().optional(),
        R2_ACCESS_KEY_ID: z.string().min(1).optional(),
        R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
        R2_BUCKET: z
            .string()
            .regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/, {
                error: 'an R2 bucket name: lowercase letters, digits and -',
            })
            .default('nl-files-prod'),
        /** Every key of this service starts with it: one bucket, a folder per service. */
        R2_PREFIX: objectPrefix,
        /** Where the CV links point: `<CV_PUBLIC_URL>/<application id>/<file name>`. */
        CV_PUBLIC_URL: z.url().default('https://cv.nick-lukashik.com'),
        /** Reading vacancy links (`vacancy.fetch`); off, a link is only parsed from the text given with it. */
        VACANCY_FETCH_ENABLED: z.stringbool().default(true),
        /** Tests only: the fetch may reach private addresses (the stand-ins on 127.0.0.1). Refused in production. */
        VACANCY_FETCH_ALLOW_PRIVATE: z.stringbool().default(false),
        /** The public APIs of the ATSs the fetch reads; set only to point tests at stand-ins. */
        VACANCY_FETCH_GREENHOUSE_URL: z.url().default('https://boards-api.greenhouse.io'),
        VACANCY_FETCH_LEVER_API_URL: z.url().default('https://api.lever.co'),
        VACANCY_FETCH_LEVER_JOBS_URL: z.url().default('https://jobs.lever.co'),
        VACANCY_FETCH_ASHBY_URL: z.url().default('https://api.ashbyhq.com'),
        VACANCY_FETCH_WORKABLE_URL: z.url().default('https://apply.workable.com'),
    })
    .refine(
        value =>
            [
                value.R2_ENDPOINT,
                value.R2_ACCESS_KEY_ID,
                value.R2_SECRET_ACCESS_KEY,
            ].every(item => item === undefined)
            || [
                value.R2_ENDPOINT,
                value.R2_ACCESS_KEY_ID,
                value.R2_SECRET_ACCESS_KEY,
            ].every(item => item !== undefined),
        {
            error: 'R2_ENDPOINT, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY are set together or not at all',
            path: [
                'R2_ENDPOINT',
            ],
        },
    )
    .refine(value => !(value.VACANCY_FETCH_ALLOW_PRIVATE && value.NODE_ENV === 'production'), {
        error: 'VACANCY_FETCH_ALLOW_PRIVATE is for tests only, never in production',
        path: [
            'VACANCY_FETCH_ALLOW_PRIVATE',
        ],
    })

export type Env = z.output<typeof envSchema>

export const env = defineEnv(envSchema)
