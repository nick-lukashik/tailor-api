# AGENTS.md

The API of Tailor (Work Finder), created from `nest-starter`: HTTP, config, logs, health, metrics and PostgreSQL (Drizzle). Modules: `access` (id-api access tokens through `@nick-lukashik/auth`, the `tailor` role check, `GET /me`), `applications` (the person's pool: vacancies and what was sent to them, per user), `vacancies` (shared vacancy rows found by a normalized link, the intake of pasted links and texts into the pool, and the `vacancy.parse` job), `llm` (the client of the platform LLM gateway), `profile` (the person's profile document: sections in jsonb columns, versions, snapshots), `master-cv` (the profile as a PDF through tailor-tex, no vacancy) and `cv` (the CV of an application on `cv.<domain>/<application id>/<file name>`, a demo PDF for now). pg-boss (jobs) is here for the parse job; Redis and RabbitMQ (events through outbox/inbox) are added only when the service uses them, copied from `nest-example` ("Add a capability" in `README.md`). The human-facing description is `README.md`.

## Commands

- `pnpm install`: dependencies (Node 26, pnpm 12; versions pinned exactly).
- `pnpm infra:up` / `pnpm infra:down` / `pnpm infra:reset`: Postgres 18 from `compose.yaml`.
- `pnpm env:local`: `.env` from `.env.example`; `pnpm db:migrate`: build and migrations; `pnpm dev`: build, `tsc --watch` and `node --watch`.
- `pnpm verify`: lint + typecheck + build + test. It must be green before you hand work over; report the command and its actual result.
- `pnpm test:unit` (no Docker), `pnpm test:int` (Testcontainers, needs Docker). Tests only through `vitest run`, never watch.
- `pnpm db:generate --name <what_it_changes>`: an SQL migration from `src/db/schema.ts`; read the generated SQL.
- `pnpm format`: Biome with fixes.

## Structure

- `src/main.ts`: entry point; `src/app.module.ts`: module wiring; `src/app.setup.ts`: HTTP setup (shared with the tests).
- `src/config/`: the Zod env schema (`env.ts`) and the `registerAs` groups (`config.ts`). Nothing else reads `process.env`.
- `src/common/`: infrastructure without business logic, identical to `nest-example` and ready to move into a package: `http` (errors, request id, cursors, validation), `database`, `health`, `metrics`, `logging`, `openapi`, `context` (AsyncLocalStorage). Change it in `nest-example` first, then copy it here.
- `src/db/`: Drizzle schema, types, `migrate.ts` (Argo CD Sync-hook Job before the Deployment: `node dist/db/migrate.js`).
- `src/access/`: `@TailorAccess()` (a valid token carrying the `tailor` role, `TAILOR_ROLE`) and `GET /me`. Every controller under `/api/v1` but `cv` is `@TailorAccess()` or `@Authenticated()`; `test/access.int.test.ts` calls every OpenAPI route without a token and expects 401.
- `src/profile/`: the profile document (`profile.schemas.ts`, strict Zod per section, cross-checks), `profiles` and `profile_snapshots`.
- `src/tex/`: the tailor-tex client (`POST /api/v1/cv/render`, 60 s, errors mapped to 422/503/504) and `cv-document.ts`, a copy of tailor-tex's `CvDocument` schema: change both together.
- `src/master-cv/`: `buildMasterCv` (pure: profile → `CvDocument`, unit-tested) and `GET /api/v1/profile/cv.pdf`.
- `src/common/jobs/`: pg-boss (`PG_BOSS`, schema `pgboss`, stopped in `beforeApplicationShutdown`), a copy of nest-example's; `src/db/migrations.ts` installs its schema after the Drizzle migrations.
- `src/llm/`: the LLM gateway client (`POST {LLM_GATEWAY_URL}/api/v1/chat/completions`, `json_schema` output checked by Zod, 120 s, `LlmCallError` with a short code: 5xx, 429, timeouts retryable, other 4xx not). Never log prompts, texts, answers or the key.
- `src/request-budget.ts`: `@RequestBudget(ms)`, a route's own request budget; every other route keeps 10 s.
- `src/vacancies/`: `vacancies` (one shared row per vacancy, `url_key` from `vacancyUrlKey`, pure and unit-tested; `parse_status` starts `pending`) and `POST /api/v1/vacancies/intake` (1–200 links and/or texts, one transaction: find or create the vacancy, then the caller's application for it, and a `vacancy.parse` job for each new or newly filled text). `vacancy-parse.job.ts`: the job (`stately` per vacancy, retries with backoff; no text → `failed` `no_text`; the answer to `parsed`, `title`, `company` and the empty company and role of its applications in one transaction); `parse.prompt.ts` and `parse.schemas.ts`: the prompt and the answer's schema, change them together and bump `PARSE_PROMPT_VERSION`. `POST /api/v1/vacancies/:id/parse` re-queues it (202, 404 outside the caller's pool).
- `src/applications/`: applications, schemas → repository → service → controller; list and get join `vacancyId` and `parseStatus` from `vacancies`. `src/cv/`: the CV of an application, `cv.<domain>/<application id>/<file name>`; the only routes reachable from the internet (`cv.<domain>`, rewritten to `/api/v1/cv/...` in gitops).
- `drizzle/`: SQL migrations and `meta/` (generated, never edited by hand).
- `test/`: integration tests and the harness (stand-ins for id-api and llm-gateway: `identity.ts`, `llm-gateway.ts`); unit tests sit next to the code (`*.test.ts`).
- `Dockerfile`, `.github/workflows/ci.yml`: the image and CI follow the [service runtime contract](https://github.com/nick-lukashik/.github/blob/master/docs/service-contract.md) (kind **api**); see "Deploy" in `README.md`.

## Conventions

- Code style is Biome's (`biome.json`): 4 spaces, single quotes, no `;`, lines up to 120 characters, objects and arrays always expanded, operators at the start of a wrapped line, `type` over `interface`, `string[]`, kebab-case file names. Run `pnpm format` after edits.
- ESM: relative imports end in `.js`. Injectable classes are imported as values, not `import type` (DI reads `emitDecoratorMetadata`). Non-classes go through a `Symbol` token (`DB`, `PG_POOL`).
- Controllers are thin: the schema on the parameter (`@Body({ schema })`, `@Query({ schema })`), a service call. SQL lives only in `*.repository.ts`.
- The contract is described by Zod schemas in `<feature>.schemas.ts` with `.meta({ id })`; OpenAPI (`/openapi.json`) is built from them. Responses through `@ApiOkResponse({ standardSchema })`, errors through `@ApiErrors(...)`.
- Errors: `throw new AppError(code, message, details?)` or `notFound("Application")`. Codes: `VALIDATION_FAILED` 400, `UNAUTHORIZED` 401 and `FORBIDDEN` 403 (the guards of `@nick-lukashik/auth`, and `@TailorAccess()` without the `tailor` role), `NOT_FOUND` 404, `PAYLOAD_TOO_LARGE` 413, `UNPROCESSABLE` 422 (the profile does not make a CV), `RATE_LIMITED` 429 (once a rate limit is added), `INTERNAL` 500, `UNAVAILABLE` 503 (Postgres over a time budget or down: `ErrorFilter` maps it by SQLSTATE), `TIMEOUT` 504 (the request budget). Only `ErrorFilter` builds the response body; stacks, SQL and internal messages never leave the service.
- Time budgets (service contract): request 10 s, SQL statement 5 s, lock 2 s, idle in transaction 10 s, pool wait 2 s, migration lock wait 1 s (retried), body 1 MiB. They are set once (`DATABASE_TIMEOUTS`, `REQUEST_TIMEOUT_MS`, `BODY_LIMIT`); work that needs more goes to a job (pg-boss, see nest-example), not a longer budget. The one exception is the master CV PDF (65 s, `@RequestBudget`), which waits for tailor-tex's own 60 s.
- Degradation: readiness requires Postgres only. A dependency added later registers a check with `health.register(name, check, { required })`; a degradable one (Redis, RabbitMQ) uses `required: false`, is reported as `degraded`, never blocks startup, and has a metric for its degraded state.
- Migrations: compatible with the code that is running (add → switch → remove, over separate releases), forward only, no long-locking DDL mixed into a feature migration, backfills as batched jobs ("Migrations" in `README.md`).
- A new environment variable: `src/config/env.ts` → a group in `src/config/config.ts` → `.env.example`. Secrets have no `.default()`.
- Capabilities: add Redis, RabbitMQ or pg-boss only when a feature of this service needs it, by copying it from `nest-example` with its tests ("Add a capability" in `README.md`), never a stub "for later". Which one: a job for this service's own background work, an event to tell other services, a consumer with the inbox to react to theirs; not event → own job when the handler can do the work in its transaction ("Which mechanism" in nest-example's README).
- Logs: pino JSON, only `Logger` from `@nestjs/common`; the object first, a constant message. Secrets, tokens and personal data are never logged.
- Data of a person is filtered by `sub` of the token in the query (`where id = $1 and user_id = $sub`); someone else's row is a 404. Test fixtures are invented (`example.com`), never real profile data.
- Times in the API are ISO strings in UTC; ids are uuidv7 (`uuidv7()` in PostgreSQL 18, `randomUUIDv7()` in Node).
- Runtime: the app listens on `PORT` (local default 4000; the image and the cluster use 3000), metrics on `METRICS_PORT` (9464). The image runs as uid `10001` with a read-only root filesystem: write nothing outside `/tmp`.
- English everywhere: code, comments (short and rare) and docs.
- No secrets, real IPs or e-mail addresses in files (examples use `example.com`).

## Library rules

Short rules for each library, checked against the installed versions. Read the relevant file before changing code in that area.

- `.claude/rules/nestjs.md`: NestJS 12, @nestjs/config, terminus, throttler, swagger (NestJS llms.txt).
- `.claude/rules/pg-boss.md`: pg-boss 12 (copied from nest-example). Redis and RabbitMQ rules come with the capability: `.claude/rules/{redis,rabbitmq}.md` of nest-example.
- `.claude/rules/zod.md`: Zod 4 (Zod llms.txt).
- `.claude/rules/drizzle.md`: Drizzle ORM 0.45 and drizzle-kit 0.31 (Drizzle llms.txt).
- `.claude/rules/pino.md`: pino 10 and nestjs-pino 5 (docs summary).
- `.claude/rules/prometheus.md`: @prometheus-io/client (docs summary).
- `.claude/rules/vitest.md`: Vitest 5 (Vitest llms.txt and its guide for AI agents).
- `.claude/rules/testcontainers.md`: Testcontainers for Node 12 (docs summary).
- `.claude/rules/biome.md`: Biome 2 (docs summary).
