# tailor-api

The API of Tailor: a vacancy in, a CV and a cover letter for it out, and the application tracked until an offer or a refusal. Its web app is [`tailor-web`](https://github.com/nick-lukashik/tailor-web) on `tailor.<domain>`; this API is internal to it, except the CV files on `cv.<domain>`.

Created from [`nest-starter`](https://github.com/nick-lukashik/nest-starter) (`.template-version`). Modules: `access` (id-api access tokens and the `tailor` role), `applications` (the person's pool, their own; three demo rows without a person from migration `0001_demo_data`, listed to nobody), `vacancies` (one shared row per vacancy, found again by its normalized link; pasted links and texts go into the pool, the `vacancy.fetch` job reads each link, and the `vacancy.parse` job reads each with a model), `llm` (the client of the platform [`llm-gateway`](https://github.com/nick-lukashik/llm-gateway)), `profile` (the person's profile document, versions and snapshots), `master-cv` (a PDF of the profile without a vacancy, built by [`tailor-tex`](https://github.com/nick-lukashik/tailor-tex)), `storage` (Cloudflare R2 through its S3 API), `cv-generation` (a CV tailored to each vacancy of the pool: the `cv.generate` job, versions in `cvs`), `materials` (the texts for applying by hand from each ready CV: the `materials.generate` job, versions in `materials`) and `cv` (the CV of an application by its id: the newest ready version from R2; the demo PDF for the demo rows).

pg-boss (jobs, schema `pgboss` in the same database) runs the vacancy fetch, vacancy parse, CV generation and materials jobs. Redis and RabbitMQ (events through outbox/inbox) are not here. When a feature needs one, copy it from [`nest-example`](https://github.com/nick-lukashik/nest-example) ("Add a capability" below). The shared code in `src/common/` is identical to the starter's, so a fix there is ported from the starter (`.github` `docs/templates.md`).

## Routes in prod

| Host                                       | Reaches                   | How                                                                                                    |
| ------------------------------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------ |
| `cv.<domain>/<application id>/<file name>` | `GET /api/v1/cv/...` only | the gitops IngressRoute rewrites every path to `/api/v1/cv/...`, so nothing else of the API is public  |
| none                                       | everything else           | `tailor-web` calls `http://tailor-api.prod.svc` from its server (`/api` proxy) with the person's token |

## What is inside

| Component                        | Version       | Why this one                                                                              |
| -------------------------------- | ------------- | ----------------------------------------------------------------------------------------- |
| Node.js / pnpm                   | 26.13 / 12.16 | `.node-version`, `packageManager`                                                         |
| NestJS (express)                 | 12.3          | ESM; built-in `StandardSchemaValidationPipe` and `useSecurityHeaders()` (replaces helmet) |
| TypeScript                       | 7.0           | native `tsc` for build and typecheck; no Nest CLI, SWC only in tests                      |
| Zod                              | 4.6           | one schema for validation and OpenAPI; no class-validator or nestjs-zod                   |
| @nestjs/swagger                  | 12.0.5        | understands Standard JSON Schema from Zod                                                 |
| Drizzle ORM / drizzle-kit        | 0.45 / 0.31   | SQL migrations, typed queries; driver `pg` 8.23                                           |
| PostgreSQL                       | 18.6          | `uuidv7()` built in                                                                       |
| pino / nestjs-pino               | 10.4 / 5.3    | JSON logs with `requestId`                                                                |
| @prometheus-io/client            | 0.16          | prom-client, moved to the Prometheus organization                                         |
| @nestjs/terminus, @nestjs/config | 12.1, 12.0    | official Nest modules                                                                     |
| @aws-sdk/client-s3               | 3.1155        | the S3 API of Cloudflare R2 (region `auto`, path-style)                                   |
| Vitest / Testcontainers          | 5.0 / 12.2    | an S3 stand-in (`adobe/s3mock`) for R2 in the integration tests                           |
| Biome                            | 2.6           | linter and formatter                                                                      |

Versions are pinned exactly. [Renovate](https://docs.renovatebot.com/) (`renovate.json`, the same policy in every repo) opens update PRs on Monday early morning (`Asia/Tbilisi`): one PR for all non-major updates, one per major, weekly lockfile maintenance. Releases younger than 3 days are skipped.

## Getting started

```sh
pnpm install
pnpm infra:up        # Postgres :5432 (app/app)
pnpm env:local       # .env from .env.example
pnpm db:migrate      # build + Drizzle migrations
pnpm dev             # http://localhost:4000, metrics http://localhost:9464/metrics
```

The rest:

```sh
pnpm verify          # lint + typecheck + build + test (Testcontainers need Docker)
pnpm test:unit       # no Docker
pnpm test:int        # Postgres in Testcontainers
pnpm start           # node dist/main.js after pnpm build
pnpm infra:down      # stop; pnpm infra:reset stops and deletes the data
```

Swagger UI: `/docs` (except with `NODE_ENV=production`), document: `/openapi.json`.

## API

Prefix `/api`, version in the URI. The `x-request-id` header is accepted (if well-formed) or generated, and returned; `x-app-version` is `APP_VERSION`. CORS is off: browsers reach the API only through the web app's server.

Every `/api/v1` route but `/api/v1/cv/*` needs `Authorization: Bearer <access token of id-api>` (ES256, checked against id-api's JWKS with `@nick-lukashik/auth`: `iss`, `aud`, `typ: at+jwt`, expiry): 401 `UNAUTHORIZED` without a valid one, 503 `UNAVAILABLE` when the keys cannot be fetched. Tailor is open only to people whose token carries the `tailor` role (granted in id-api; the decision of 08.11 that replaced the allowlist of D-112): anyone else gets 403 `FORBIDDEN` everywhere except `GET /api/v1/me`. Everything is the caller's own (`sub` of the token): someone else's application is a 404.

| Method and path                                                             | Response                                                                                                                 |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/v1/me`                                                            | `{ userId, allowed }` for any valid token: `allowed` is whether it carries the `tailor` role                             |
| `GET /api/v1/applications?limit=20&cursor=…`                                | `{ items: Application[], nextCursor: string \| null }`, the caller's, newest first                                       |
| `GET /api/v1/applications/:id`                                              | `ApplicationDetail` (below) or 404                                                                                       |
| `PATCH /api/v1/applications/:id` `{ status }`                               | `Application` with the new status (`new`, `sent`, `interview`, `offer`, `rejected`); 404 unless the caller's             |
| `POST /api/v1/applications` `{ company, role?, vacancyUrl?, vacancyText? }` | 201 `Application` (status `new`), the caller's                                                                           |
| `POST /api/v1/vacancies/intake` `{ items: [{ url?, text? }] }`              | 200 `{ created, existing, items: [{ applicationId, vacancyId, result }] }` in input order (see below)                    |
| `POST /api/v1/vacancies/:id/parse`                                          | 202 `{ vacancyId, parseStatus: 'pending' }`: parses it again; 404 unless it is in the caller's pool                      |
| `POST /api/v1/vacancies/:id/fetch`                                          | 202 `{ vacancyId, fetchStatus: 'pending' }`: reads its link again; 404 unless in the caller's pool, 409 without a link   |
| `POST /api/v1/applications/:id/cv`                                          | 202 `ApplicationCv` (`queued`, the new version): a new CV version; 409 before the parse or while one is made             |
| `POST /api/v1/applications/:id/materials`                                   | 202 `ApplicationMaterials` (`queued`, the new version) from the newest ready CV; 409 without one or while one is written |
| `GET /api/v1/profile`                                                       | `{ version, updatedAt, document }`; 404 before the first save                                                            |
| `PUT /api/v1/profile` the whole document                                    | `{ version, sha256, updatedAt }`: version + 1 and a snapshot; 400 with every bad path; `{}` is an empty one              |
| `GET /api/v1/profile/schema`                                                | JSON Schema (draft 2020-12) of the document, for editors                                                                 |
| `GET /api/v1/profile/cv.pdf`                                                | the master CV ("Master CV" below): `application/pdf` inline, `private, no-store`; 404 without a profile                  |
| `GET /api/v1/cv/:id/:fileName`                                              | the CV of application `id` inline, `no-store`, `noindex`: its newest ready version from R2 (demo rows: demo)             |
| `GET /api/v1/cv/:id`, a wrong name                                          | 302 to the canonical link (relative, `<First>-<Last>-<Role>-CV.pdf`); 404 for an unknown id or no ready CV               |
| `GET /health/live`, `GET /health/ready`                                     | ready: 503 without Postgres                                                                                              |
| `GET /openapi.json`, `GET /docs`                                            | OpenAPI from the Zod schemas                                                                                             |

`ApplicationDetail` is `Application` plus `vacancy`, `cv` and `materials` (`{ status, version?, content?, error?, updatedAt? }`: the newest version's status, the texts of the newest ready one; list items carry `materialsStatus`); the list keeps the light `Application`. `vacancy` is null for an application created by hand, else `{ id, url, rawText, parseStatus, parseError, updatedAt, model, parsed, applyForm, fetchStatus, fetchError }`: the pasted text (`vacancies.raw_text`; `vacancyText` of the application stays empty for the intake), `model` from `parsed._meta.model` (null before a parse), `parsed` the answer of `src/vacancies/parse.schemas.ts` without `_meta` (null until parsed, or when the stored answer no longer matches the schema), `applyForm` the questions read from the link (`{ source, fields: [{ key, label, type, required, options? }] }`, null before or without one), `fetchStatus` (`pending`, `fetched`, `failed`, `skipped`) and `fetchError` ("Vacancy fetch" below). `cv` is `{ status, version?, url?, pages?, model?, error?, updatedAt? }`: `status` `none` before the first version, else the newest version's `queued`, `generating`, `ready` or `failed` with its `version`, `model` and failure `error` code; `url` (`<CV_PUBLIC_URL>/<application id>/<file name>`) and `pages` belong to the newest ready version, which the link serves, so they stay while a newer one is made. `Application` (the list too) has `cvStatus`, the newest version's status or `none`.

Error body: `{ code, message, details?: { path, message }[], requestId }` with `code` one of `VALIDATION_FAILED` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403: signed in, no `tailor` role), `NOT_FOUND` (404), `CONFLICT` (409: a CV asked for before its vacancy is parsed or while one is made), `PAYLOAD_TOO_LARGE` (413, body over 1 MiB), `UNPROCESSABLE` (422: the profile does not make a CV), `RATE_LIMITED` (429), `INTERNAL` (500), `UNAVAILABLE` (503: Postgres or tailor-tex over a time budget or down, retry later), `TIMEOUT` (504: the request exceeded its budget, 10 s unless the route has its own; a write may still have been applied).

## Vacancy intake

`POST /api/v1/vacancies/intake` takes 1–200 items, each a link (http/https, up to 2048), a raw text (up to 100 000) or both; an item with neither is a 400 at `items.<n>`. A vacancy is a shared row (`vacancies`), a person's application points at it (`applications.vacancy_id`, one per person and vacancy). In one transaction per request: a link is found again by its key (`vacancyUrlKey`: lowercase scheme and host, no `www.`, fragment, `utm_*`, `gclid`, `fbclid`, `ref`, `source`, `src`, `trk`, sorted params, no trailing slash) or creates the vacancy; a found vacancy with an empty text takes the item's text. A text without a link is always a new vacancy. Then the caller's application is created (`new`, company and role from the vacancy, empty until parsed) or reported `existing`. In the same transaction every vacancy the request created and every known one whose empty text it filled (that one is `pending` again) is queued: a `vacancy.fetch` job when it has a link (the fetch queues the parse), else a `vacancy.parse` job; someone else's application stays a 404.

## Vacancy fetch

The pg-boss job `vacancy.fetch { vacancyId }` (`src/vacancies/vacancy-fetch.job.ts`, one queue, `stately` per vacancy, 4 at once per pod) reads a vacancy's link before its parse (`vacancy-fetcher.ts`):

- **Readers**, in order (`fetch-routes.ts`): Greenhouse (`boards.greenhouse.io/<board>/jobs/<id>`, `job-boards.greenhouse.io`, the embed with `for`/`token`, and `gh_jid` links on a company's site, whose board is found on the page): `boards-api.greenhouse.io/v1/boards/<board>/jobs/<id>?questions=true`, the content and the questions; Lever (`jobs.lever.co/<company>/<id>`): `api.lever.co/v0/postings/<company>/<id>`, the questions from the plain HTML form of `/apply`; Ashby (`jobs.ashbyhq.com/<org>/<id>`): the job from `api.ashbyhq.com/posting-api/job-board/<org>?includeCompensation=true`, which has no form (no fields); Workable (`apply.workable.com/<account>/j/<shortcode>`): `apply.workable.com/api/v2/accounts/<account>/jobs/<shortcode>` and `…/form`; any other page: its JSON-LD `JobPosting` when it has one, else the readable text of its main content (no scripts, styles, navigation, header, footer or forms), and its own form only when it takes a file (`fetch-adapters.ts`, `fetch-html.ts`). A form that cannot be read leaves the text: no fields.
- **Safety** (`fetch-http.ts`): http and https only, no credentials in the link, every host resolved once and refused (`blocked_address`) when any of its addresses is loopback, private, link-local, CGNAT, multicast or reserved (IPv4-mapped IPv6 judged as IPv4), the connection made to the checked address; at most 5 redirects, each checked the same way; 15 s per request, at most 5 MB of body (decompressed), browser-like headers.
- **Result.** `apply_form` (jsonb), `fetch_status` `fetched` or `failed` with `fetch_error` (`http_<status>`, `timeout`, `network`, `dns_not_found`, `blocked_address`, `too_large`, `too_many_redirects`, `bad_url`, `bad_response`, `unsupported_type`, `not_found`, `no_content`, `internal`), `skipped` without a link (and for the rows before the fetch). The text read fills `raw_text` only when the person pasted none; their own text is kept. Then the parse is queued in the same transaction when the vacancy is `pending`: a failure without a pasted text ends as the parse's `no_text`. Timeouts, network errors, 429 and 5xx are retried twice with backoff. `vacancy_fetch_total{result,source}`; texts are never logged.
- **Config.** `VACANCY_FETCH_ENABLED` (default `true`; `false`: every fetch is `skipped`, the tests' default). The `VACANCY_FETCH_*_URL` bases and `VACANCY_FETCH_ALLOW_PRIVATE` exist only to point tests at local stand-ins (`test/sites.ts`); the latter is refused in production.

## Vacancy parsing

The pg-boss job `vacancy.parse.<model> { vacancyId }` (`src/vacancies/vacancy-parse.job.ts`, `src/vacancies/parse-pool.ts`) reads a vacancy with a model of the pool through the LLM gateway (`POST {LLM_GATEWAY_URL}/api/v1/chat/completions`, `response_format: json_schema`, the model's `reasoning_effort`, 300 s per call, an `Idempotency-Key` per job so a retry reuses an answer the gateway already has):

- **Pool.** `LLM_PARSE_MODELS` is a comma-separated list of `model:effort:concurrency` (default `claude-sonnet-5-5:low:3,gpt-6.1-sol:low:3`; effort `minimal`, `low`, `medium` or `high`, concurrency 1–10, at least one model, each once). One queue per model (`vacancy.parse.claude-sonnet-5-5`, `vacancy.parse.gpt-6-1-sol`); every pod works each queue with the model's concurrency. The gateway runs at most a few calls per provider at once across all its clients (`concurrency` in its `config/models.json`), so more in flight just wait there, inside the 300 s.
- **Assignment.** The intake and the re-parse put each vacancy into the queue with the fewest queued and active jobs (counted in pg-boss's table in the same transaction; ties in config order; each pick of a batch counts towards the next). A vacancy that already has a queued or active parse goes to that same queue, under the vacancy's row lock, so it is never in two queues at once.
- **Queue.** `stately` with the vacancy id as `singletonKey`: at most one queued and one active parse per vacancy. 5 retries with backoff from 5 s up to 5 min, expiry 360 s.
- **Provider out.** A call refused for the provider's quota or unavailability (429, 503: `llm_provider_quota`, `llm_provider_unavailable`) moves the job to another model's queue once (`movedFrom` in the payload); after that, and for any other retryable failure, the job backs off on its own queue.
- **Legacy queue.** Jobs left in `vacancy.parse` by the release before the pool are moved into the pool by a drain worker; it goes in the next release.
- **No text** (a link whose fetch found none): `failed`, `parse_error` `no_text`, no model call. A text pasted later for the same link, or a fetch that finds one (`POST /api/v1/vacancies/:id/fetch`), queues the parse again.
- **Parsed.** The answer (`src/vacancies/parse.schemas.ts`: title, company, companyDescription, seniority, location, remote, regions, employmentType, salary, language, skills, requirements, responsibilities, niceToHave, applyChannels, summary, warnings) goes to `parsed` whole, with `_meta: { model, effort, promptVersion }` added (strip it before checking `parsed` against the schema), `title` and `company` trimmed to 200, `parse_status` `parsed`; in the same transaction every application on the vacancy gets the company and role it still has empty.
- **Failed.** 5xx, 429, a timeout or an unreachable gateway are retried (429 and 503 on another model first); another 4xx, an answer off the schema or the last retry make it `failed` with a short code: `llm_<gateway code>` (`llm_bad_request`, `llm_provider_quota`, …), `llm_http_<status>`, `llm_timeout`, `llm_unreachable`, `llm_invalid_output`. `POST /api/v1/vacancies/:id/parse` queues it again.
- **Prompt.** `src/vacancies/parse.prompt.ts`, ported from Work Finder's job parser. The vacancy text and link go in as data between `<vacancy>` and `<link>` tags, never as instructions. Prompts, texts, answers and the key are never logged; the logs carry ids, codes, tokens and time. `vacancy_parse_total{result,model}` counts parsed, failed, retry, moved and skipped per configured model.

## Profile

The data a CV, the texts and the form answers are built from (notes `tailor/02-cv/profile.md`): one strict JSON document with the sections `person`, `career`, `employments` (with `projects`), `cases` (the achievement bank: variants `full`/`compact`/`minimal`, `keyClaims`, `metricClaims`, `categoryRatings` over FE BE AR RE PF QA SE OW EE CO UX AI), `skills`, `education`, `languages`, `summary`, `story` (with `personal` facts), `applicationFacts`, `answers`, `voice`, `settings`. The Zod schemas in `src/profile/profile.schemas.ts` are the contract; every field has a default, unknown fields are refused, and cross-checks run on the whole document (unique ids, a case's `employmentId` and `projectId`).

- **Stored by section.** `profiles` has one row per user and a jsonb column per section, so a pipeline step reads only its slice (D-93). The document is written whole (D-98): the screen of tailor-web is a JSON editor.
- **Versions.** Every save bumps `profiles.version` and writes `profile_snapshots { user_id, version, document, sha256 }` in the same transaction; `sha256` is of the canonical JSON (sorted keys). A CV will point at the snapshot it was built from.
- **Size.** A profile with a few hundred cases fits the 1 MiB body limit.

## Master CV

`GET /api/v1/profile/cv.pdf` is the person's profile as a PDF, without a vacancy and without a model (notes `tailor/02-cv`, "Мастер-CV"): it checks the whole way to a PDF before the pipeline exists. `buildMasterCv` (`src/master-cv/master-cv.ts`, pure) turns the profile into tailor-tex's `CvDocument` (`src/tex/cv-document.ts`, a copy of tailor-tex's schema), ported from Atelier's assemble and selection:

- Header: the English name (D-99), city and country, the phone, the first target role's headline (else `career.headline`), `career.stackLine`, the links (the e-mail and Telegram added when no link has them; at most 8).
- Summary: the first two `summary` entries, `full` (else `compact`). Skills: every row with items, in order.
- Experience: employments by `order` without the AI-only ones; each has its `fixedBullets`, then its active cases in the profile's order, `full` variant, up to `quota.general.target` (all active cases without a quota), one case per `achievementGroup` on the whole CV.
- Education (degrees) and languages (`note`, else the level; `none` left out). Dates print as `Mar 2022 – Present`.
- A profile that cannot make one (no phone, no summary, a value over a template limit) is a 422 before any build, each issue at its profile section (`person.phone`, `employments`, …). The file name is `cvFileName(name, headline)`: `<First>-<Last>-<Role>-CV.pdf`.

The PDF comes from tailor-tex `POST /api/v1/cv/render` (template `minimal-violet`, `settings.maxPages`) with `TAILOR_TEX_TOKEN` and is streamed through. Its answers map to: 422 (TeX error or more pages than allowed: its message and log tail; a value it refused), 503 (busy, down, a wrong token; `TAILOR_TEX_TOKEN` unset: "PDF rendering is not configured"), 504 (its build budget, or 60 s here). The person closing the tab aborts the build.

## Storage

`src/storage/object-storage.ts`: the service's files in Cloudflare R2 through its S3 API (`@aws-sdk/client-s3`, region `auto`, path-style, checksums only where required): `put`, `head`, `get` as a stream, every key under `R2_PREFIX` (default `tailor/`) in `R2_BUCKET` (default `nl-files-prod`). `R2_ENDPOINT`, `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` are optional, all three or none (a partial set stops the process at start): without them the service starts, and a CV generation fails with `storage_not_configured`. Deadlines: 2 s to connect, 15 s for a put or head, 8 s for a read (inside a request's 10 s), 2 attempts. Failures are short codes: `storage_unavailable` (network, 5xx, timeout: retried by the job), `storage_refused` (another 4xx: wrong keys or bucket). A missing object reads as none; the body and the keys are never logged.

The integration tests run it against [`adobe/s3mock`](https://github.com/adobe/S3Mock) (`test/containers.ts`, pinned) in Testcontainers, locally and in CI: the real client and its requests against an S3 API, rather than an in-memory fake that would test nothing of the client. MinIO, the usual choice, no longer publishes images. The stand-in does not check signatures, so the keys themselves are checked only in prod.

## CV generation

A CV tailored to each vacancy of the pool (`src/cv-generation/`), ported from Work Finder's resume generation (resume v2: `analyze-requirements.ts`, `compose-resume.ts`, `fit-resume.ts`, `generate-v2.ts`, `domain/fitting.ts`) and its policy sources (`00_PROJECT_INSTRUCTIONS`, `02_ADAPTATION_WORKFLOW`, `07_OUTPUTS_AND_MESSAGES`), adapted to the profile:

- **Versions.** `cvs` holds the versions of an application's CV: `version` 1, 2, … per application, `status` `queued` → `generating` → `ready` or `failed` (`error`, a short code), `file_key` (`<R2_PREFIX>cv/<application id>/<cv id>.pdf`) and `file_name` (`cvFileName(name, CV title)`: ASCII, dashes, at most 120 characters) once ready, `role`, `model`, `effort`, `prompt_version`, `profile_version`, `pages`, `ai_role`, `analysis` and `document` (the `CvDocument` sent to tailor-tex). A version is never changed once ready; the link serves the newest ready one.
- **Triggers.** A successful parse queues version 1 for every application of the vacancy that has no CV yet, in the parse's own transaction. `POST /api/v1/applications/:id/cv` queues a new version (202); 404 for someone else's application, 409 when its vacancy is not parsed yet or a version is queued or generating (a version `generating` longer than twice the job's expiry is taken as lost).
- **Pool.** The job `cv.generate.<model> { applicationId, cvId }` has its own pool like the parse (`src/llm/model-pool.ts`): `LLM_CV_MODELS` (`model:effort:concurrency,…`, default `claude-sonnet-5-5:low:3,gpt-6.1-sol:low:3`), one queue per model, the emptiest queue at send, a provider out of quota or down moves the job to another model once. `stately`, `singletonKey` the version's id, 3 retries with backoff from 10 s up to 5 min, expiry 1 440 s (two gateway calls of 300 s, 13 tailor-tex calls of 60 s, a minute for the rest). Each call has an `Idempotency-Key` per version and model, so a retry reuses an answer the gateway has.
- **1. Analysis** (a model call, `cv_analysis`): the vacancy's atomic requirements (importance, categories, technologies) and which active cases of the bank evidence them (1 or 0.5, with claim ids), grounded in code (unknown ids and duplicates dropped). It decides `aiRole` (D-115): an applied-AI, LLM engineer or forward-deployed role; a title that names one says so too. Employments, skill rows and summary paragraphs marked `aiOnly` are on the CV only then.
- **Selection** (code): per employment its quota (`quota.ai` for an AI role, `quota.general` otherwise; every case without one), its eligible active cases (`whenVacancyMentions`) ranked by 0.6 × category fit + 0.4 × evidence fit, with Work Finder's role weights plus up to 10 points for a case listing the vacancy's main stack (the technologies of its must and responsibility requirements), and a suggestion: the best `target`, one per achievement group on the CV.
- **2. Composition** (a model call, `cv_composition`): the model proposes the CV's English title, chooses and orders the cases within the quotas (preferring cases with the vacancy's stack, `matchingStack`), writes each anew in `full`, `compact` and `minimal` (at most two lines each) from the case's source text: what the vacancy needs first, the vacancy's names for the technologies the case lists, the case's figures without hedges; adapts the summary, orders the skills and reads each vacancy skill in English with its row. Prompt version 2 sent the profile's three variants and asked to keep each metric claim verbatim: the model (low effort) returned every bullet unchanged, so version 3 sends one source text and says a repeat is not adapted. Every bullet is a case of the profile, kept by its id: Work Finder's lines that told the model to invent experience or write bullets from the vacancy text are not ported. Code checks it: a case of another employment, a second case of a group or over the quota is dropped, a variant with a figure its case does not have takes the case's own text, the minimum is topped up from the suggestion, `roughly`, `about`, `around` before a figure are dropped. `bulletChanges` counts the bullets printed as their case's own text: when the vacancy's stack names a technology a case's wording does not, most such bullets must differ, else a warning `Most bullets not tailored to the vacancy` (counts only); `unchangedBullets` is in the `CV ready` log.
- **Skills** (D-118): the profile's rows and labels in their order, the model's order, the vacancy's spelling when it is English (`K8s`, `ReactJS`), else the model's English name (`unit-тесты` → `Unit testing`), never a non-ASCII item; every profile item kept, nothing neither side has; each skill once (`Python (FastAPI)` covers Python and FastAPI, split into both when the vacancy lists them separately); every skill of the vacancy in the row of the item it spells, else the row the model gave it, else the row its kind fits (`asyncio` to the backend row); a phrase that is no technology or practice (teamwork) nowhere.
- **3. Document** (code): `cvFrame` of the master CV (header, links, education, languages per the settings), the CV title as the headline and the file name, the profile's stack line. The title (`title.ts`): the model's proposal when it is printable ASCII, at most 60 characters and without an entry-level word (junior, entry, beginner, trainee, intern, начинающий, джун, стажёр), else the vacancy's title made plain ASCII when it passes the same check, else the profile's headline.
- **4. Fit** (code, tailor-tex `POST /api/v1/cv/measure`, at most 12 builds): while it has more pages than `settings.maxPages`, the compact summary, then the lowest-priority bullets (the last of each employment first) to compact, then minimal, then skill items of a wrapping row (never a vacancy skill or the core), then whole bullets within the employment's minimum. A round after which a line is overfull (over 2 pt, Work Finder's tolerance) is undone and its variants blocked. Without a clean build, the narrowest overflow up to 12 pt on the allowed pages is taken; else `cv_does_not_fit` or `cv_overfull`.
- **5. Render and store**: tailor-tex `render`, the PDF to R2, `ready` with `pages`.
- **Prompts.** `cv.prompts.ts` (`CV_PROMPT_VERSION`) with `cv-generation.schemas.ts`; the vacancy and the profile go in as data between tags. `settings.promptAdditions.cv` of the profile (up to 4 000 characters) is appended to both as the person's own instructions, under the factual rules.
- **Failures** (`error`): `llm_<code>` as in parsing, `storage_not_configured`, `storage_unavailable`, `storage_refused`, `tex_not_configured`, `tex_unavailable` and `tex_timeout` (retried), `tex_unprocessable`, `cv_invalid_document` (the profile does not make a CV), `cv_does_not_fit`, `cv_overfull`, `vacancy_not_parsed`, `no_profile`, `internal` (the last try of an unexpected error). Prompts, CV text and vacancy text are never logged; the logs carry ids, codes, pages, builds and time. `cv_generate_total{result,model}` counts ready, failed, retry, moved and skipped per configured model.

## Materials

The texts for applying by hand (`src/materials/`), ported from Work Finder's outreach (`material-prompt.ts`, cv-builder's `outreach.prompt.ts`) and the lessons of its best letters (`letters-best.md`).

- **Versions and trigger.** `materials` holds versions 1, 2, … per application, each written from one CV version (`cv_id`): `queued` → `generating` → `ready` (`content`) or `failed` (`error`). A CV version that becomes ready queues one in the same transaction; `POST /api/v1/applications/:id/materials` queues another from the newest ready CV (409 without one or while one is queued or generating for less than twice the job's expiry).
- **Pool.** `materials.generate.<model> { applicationId, materialsId }`, `LLM_LETTERS_MODELS` (default `claude-sonnet-5-5:low:3,gpt-6.1-sol:low:3`), the same pool rules as the CV; one gateway call (`application_materials`, `Idempotency-Key` per version and model), expiry 360 s, 3 retries.
- **Content.** `language` (English unless the vacancy is Russian: its parsed `language`, else a mostly Cyrillic text), `coverLetter` (150–250 words), `emailSubject`, `emailBody` (80–140 words), `telegramMessage` (at most 600 characters), `linkedinNote` (at most 300), `whyMe` (3 points), `answers` (`[{ key, label, answer }]`, one per non-file field of the vacancy's `apply_form`, in its order: name, e-mail, phone, links, location, salary expectation, notice period, sponsorship and EEO (declined) straight from the profile's `person` and `applicationFacts` (`form-answers.ts`), the other questions written by the model from the CV, the profile and its prepared `answers`; an answer outside a field's options, or one the facts do not give, is empty). Facts only from the CV (its `CvDocument`) and the profile (summary, story, voice, applicationFacts); two of the owner's best texts go in as style templates with every fact a `[slot]`. The model writes `{cvUrl}`; code puts the CV link in (added to the e-mail and the Telegram message when missing, never cut when a text is clipped to its limit) and drops the long dash. `settings.promptAdditions.letters` (up to 4 000 characters) closes the prompt and takes precedence. `materials.prompts.ts` (`MATERIALS_PROMPT_VERSION`) with `materials.schemas.ts`.
- **Failures:** `llm_<code>`, `vacancy_not_parsed`, `cv_not_ready`, `no_profile`, `internal`. `materials_generate_total{result,model}`. Texts are never logged.

## Import vacancies

`node dist/cli/import-vacancies.js <userId> < file.json` in a pod (`kubectl exec -i`), the file `{ "items": [{ "url"?, "text"? }] }`: the whole file is checked first (exit 2 and the bad item's index, nothing imported), then each chunk of 200 goes through the intake of `POST /api/v1/vacancies/intake`, so parses and CVs are queued; it prints `created N, existing M`. It runs the app module with `METRICS_PORT=0` next to the server.

## Add a capability

Each one is a copy from `nest-example`, wired in `app.module.ts`. Pick by need ("Which mechanism" in its README): a job for this service's own background work, an event to tell other services, a consumer to react to theirs. Do not add one "for later".

| Capability                                  | Copy from nest-example                                                                                                                                                                                                       | Also                                                                                                                                                                                                           |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Redis (cache, rate limit)                   | `src/common/redis/`, `RedisModule` and `ThrottlerModule` in `app.module.ts`, `.claude/rules/redis.md`                                                                                                                        | `@redis/client`, `@nestjs/throttler`; `REDIS_URL` (`redisEnvSchema`); the `redis` service in `compose.yaml`; `RedisContainer` in `test/global-setup.ts`; `services: postgres,redis` in CI                      |
| Jobs (pg-boss)                              | `src/common/jobs/`, `JobsModule` in `app.module.ts`, the pg-boss part of `src/db/migrations.ts`, `src/notes/note-stats.job.ts` as the model, `.claude/rules/pg-boss.md`                                                      | `pg-boss`; nothing else: it runs in Postgres                                                                                                                                                                   |
| Events (RabbitMQ: outbox, inbox, consumers) | `src/common/messaging/`, `src/messaging/replay-dlq.ts`, `MessagingModule` in `app.module.ts`, `outbox`/`inbox` in `src/db/schema.ts`, `src/notes/notes.events.ts` and `src/activity/` as models, `.claude/rules/rabbitmq.md` | `amqplib`; `RABBITMQ_URL` (`rabbitEnvSchema`); the `rabbitmq` service in `compose.yaml`; `RabbitMQContainer` in `test/global-setup.ts`; `services: postgres,rabbitmq` in CI; the `messaging:replay-dlq` script |

Copy the tests of the capability too (`test/*.int.test.ts` of nest-example: `redis-degradation`, `messaging`, `broker-outage` and the helpers in `test/containers.ts`). The degradation metrics they export already have alerts in gitops (`platform/monitoring/rules/services.yaml`). A new secret goes to the service's SealedSecret.

## Time budgets

A dependency that hangs fails the request fast instead of filling the pool (service contract, "Time budgets"):

| Budget                               | Value                      | Where                                                                                                                    | When exceeded                                                                                           |
| ------------------------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Whole request                        | 10 s                       | `RequestTimeoutInterceptor` (`src/common/http/request-timeout.ts`)                                                       | 504 `TIMEOUT`; `http_server_request_timeouts_total`                                                     |
| Whole request, master CV PDF         | **65 s** (contract: 10 s)  | `@RequestBudget` on the route (`src/request-budget.ts`, `MASTER_CV_REQUEST_BUDGET_MS`)                                   | 504 `TIMEOUT`                                                                                           |
| tailor-tex render                    | 60 s                       | `TEX_RENDER_TIMEOUT_MS` (`src/tex/tailor-tex.client.ts`); tailor-tex itself stops a build at 45 s                        | 504 `TIMEOUT`                                                                                           |
| LLM gateway call (in a job)          | 300 s                      | `LLM_CALL_TIMEOUT_MS` (`src/llm/llm-gateway.client.ts`), its wait for a provider slot included; the job expires at 360 s | `llm_timeout`, retried                                                                                  |
| CV generation job                    | 1 440 s                    | `CV_EXPIRE_SECONDS` (`src/cv-generation/cv-generate.job.ts`): two gateway calls, 13 tailor-tex calls, a minute more      | expired, retried; a version stuck `generating` for twice that no longer blocks a new one                |
| R2 call                              | 15 s (read 8 s)            | `STORAGE_WRITE_TIMEOUT_MS`, `STORAGE_READ_TIMEOUT_MS` (`src/storage/object-storage.ts`); 2 s to connect                  | `storage_unavailable`; on the CV link 503 `UNAVAILABLE`                                                 |
| SQL statement                        | 5 s                        | `statement_timeout`, a startup parameter of every pool connection (`DATABASE_TIMEOUTS`)                                  | 503 `UNAVAILABLE`                                                                                       |
| Waiting for a lock                   | 2 s                        | `lock_timeout` (row and table locks, e.g. a migration's `ALTER TABLE`)                                                   | 503 `UNAVAILABLE`                                                                                       |
| Transaction idle without a statement | 10 s                       | `idle_in_transaction_session_timeout`: the server ends a leaked transaction                                              | the connection is closed and replaced                                                                   |
| Waiting for a pool connection        | 2 s                        | `connectionTimeoutMillis`; the pool is bounded by `DATABASE_POOL_MAX` (10)                                               | 503 `UNAVAILABLE` ("Database is busy")                                                                  |
| Request body                         | 1 MiB                      | the JSON and urlencoded body parsers (`BODY_LIMIT` in `src/app.setup.ts`), also chunked                                  | 413 `PAYLOAD_TOO_LARGE`                                                                                 |
| Migration waiting for a lock         | 1 s per run, up to 10 runs | `lock_timeout` of the migration connection (`MIGRATION_LOCKS` in `src/common/database/database.ts`)                      | the run is rolled back and repeated after 1–10 s; after about 1 min the Job fails and the rollout stops |

The master CV route is an exception to the 10 s budget, like tailor-tex's own 60 s: one XeLaTeX build may take more than 10 s on a busy node (about 1 s normally). `RouteBudgetInterceptor` keeps 10 s for every other route; a route gets its own only with `@RequestBudget(ms)`, above the budget of the dependency it waits for, so the dependency's answer comes first.

503s from Postgres are logged with the reason only (never the SQL) and counted in `http_server_database_failures_total{reason}`; `db_pool_connections{state=total|idle|waiting}` shows the pool. Postgres also has a 6 s client reply deadline: a connection whose server never replies is closed and removed from the pool. Readiness (`/health/ready`) requires Postgres; a capability added later registers its own check, degradable ones with `required: false`.

## Migrations

`node dist/db/migrate.js` runs in the migrate Job before the new pods, while the old pods keep serving. So:

- **Compatible with the running code.** The old version runs during the Job, during the rollout and after a rollback. Add first (a column, a table, an index), switch the code in the next release, remove the old in the release after that. Never rename or drop in the same release that stops using it.
- **Forward only.** There are no down migrations; a rollback in gitops brings back the old image, which works with the new schema because of the rule above.
- **Short locks.** A DDL statement waiting for a lock holds up every later query on that table. The migration connection waits at most 1 s, below the app's 2 s, so the app's queries get through; the run (one transaction for every pending migration) is then rolled back and repeated, up to 10 times (`MIGRATION_LOCKS`, each retry logged). Once a statement holds its lock, it holds it until the end: a rewrite of a big table or an index on it is planned on its own, not mixed into a feature migration.
- **Data in batches.** Backfilling existing rows is a job, in batches, not an `UPDATE` of the whole table in the migration.

## Docker

```sh
docker build --build-arg APP_VERSION=$(git rev-parse HEAD) -t tailor-api .
pnpm infra:up
# as in Kubernetes: read-only root filesystem, no capabilities, uid 10001
docker run --rm --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges \
  --user 10001:10001 --network tailor-api_default -p 4000:3000 -p 9464:9464 \
  -e DATABASE_URL=postgres://app:app@postgres:5432/app \
  -e LLM_GATEWAY_KEY=llm-tailor-api-local-only-key-change-me-0123456789 tailor-api
# migrations from the same image
docker run --rm --read-only --tmpfs /tmp --user 10001:10001 --network tailor-api_default \
  -e DATABASE_URL=postgres://app:app@postgres:5432/app tailor-api node dist/db/migrate.js
```

- Base `node:26.13.0-trixie-slim`. Stages: `deps` (pnpm from `packageManager`) → `build` (`dist/`) and `prod-deps` (`node_modules` without dev dependencies) → `runtime`.
- `APP_VERSION` is the only build arg: nothing environment-specific is baked in, so one image runs on stage and prod.
- App files are owned by root, the app runs as uid `10001` and writes nothing: a read-only root filesystem works, only `/tmp` is writable.
- `PORT` is 3000 in the image (the local default without it is 4000), metrics on `METRICS_PORT` 9464. `HEALTHCHECK` polls `/health/ready` for `docker run`; Kubernetes ignores it and uses its probes.
- `node dist/main.js` is PID 1. On `SIGTERM`: readiness answers 503 for `SHUTDOWN_DELAY_MS` (0 by default; the pod's `preStop` sleep drains the load balancer), then HTTP and the pool close. A hard deadline in `main.ts` exits with an error after 25 s, before Kubernetes kills the pod at 30 s.
- Behind an ingress set `TRUST_PROXY_HOPS=1`, or client IPs are the proxy's.

## CI

`.github/workflows/ci.yml` calls the org reusable workflows from `nick-lukashik/.github` by the moving major tag `@v1`, never `@master`:

- job `ci`: `build.yml@v1.1.0` (the first with `github-packages`) with `kind: api`, `services: postgres` and `github-packages: true` (`@nick-lukashik/auth` from GitHub Packages; `.npmrc` names the registry, the token is user-level: packages README, "Installing"). It starts a Postgres service container, exports it as `TEST_DATABASE_URL`, runs `pnpm verify` and builds the image with `APP_VERSION=<full SHA>`; on `master` it pushes the image to GHCR and outputs its digest. A change to docs only (`docs/`, `.claude/`, `*.md` at the root) skips all of it. The required check is `ci / verify`. `publish` is on: this repository is not a template.
- job `deploy`: on `master`, when an image was pushed: `deploy-pr.yml@v1` opens the gitops PR with the new digest. Secrets are passed explicitly, never `secrets: inherit`.

`test/global-setup.ts` uses `TEST_DATABASE_URL` when it is set, else starts Postgres in Testcontainers; the S3 stand-in for R2 always runs in Testcontainers (the org workflow has no service container for it; the runner has Docker). Plain `DATABASE_URL` is never used, because the tests truncate tables.

## Deploy

The image follows the [service runtime contract](https://github.com/nick-lukashik/.github/blob/master/docs/service-contract.md) (kind **api**); it is the source of truth for everything below.

- Image: `ghcr.io/nick-lukashik/<repo-name>`, tags `sha-<7 chars>` and the full SHA, deployed by digest only. The same image goes to stage and then to prod.
- gitops: `apps/<svc>/prod/kustomization.yaml` includes `components/service` and `components/api`, sets the host, and has one `images:` entry `ghcr.io/nick-lukashik/<svc>` with a `digest`. The deploy PR changes only that digest.
- Config through `envFrom`: non-secret values (`LOG_LEVEL`, `TRUST_PROXY_HOPS`, `DATABASE_POOL_MAX`, …) in the ConfigMap `<svc>-config`; `ID_JWKS_URL`, `TOKEN_ISSUER` and `TOKEN_AUDIENCE` default to prod (`http://id-api.prod.svc/.well-known/jwks.json`, `https://id.nick-lukashik.com`, `nick-lukashik`), and the pod needs egress to id-api (the `api-client` label); `TAILOR_TEX_URL` defaults to `http://tailor-tex.prod.svc`, `LLM_GATEWAY_URL` to `http://llm-gateway.prod.svc`, `LLM_PARSE_MODELS`, `LLM_CV_MODELS` and `LLM_LETTERS_MODELS` to `claude-sonnet-5-5:low:3,gpt-6.1-sol:low:3`, `R2_BUCKET` to `nl-files-prod`, `R2_PREFIX` to `tailor/` and `CV_PUBLIC_URL` to `https://cv.nick-lukashik.com`; `R2_ENDPOINT`, `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` (all three or none; without them CV generation fails with `storage_not_configured`), `DATABASE_URL`, `TAILOR_TEX_TOKEN` (the `INTERNAL_API_TOKEN` of tailor-tex; without it the master CV answers 503) and `LLM_GATEWAY_KEY` (the client key of tailor-api in llm-gateway; required, the process does not start without it) in the SealedSecret `<svc>-secrets`. `PORT=3000` comes from gitops; `APP_VERSION` from the image. A bad or missing value stops the process at start.
- Migrations: `components/api` runs `node dist/db/migrate.js` as an Argo CD `Sync`-hook Job in wave 0 with the same image, config and secrets: after `<svc>-secrets` (wave -1), before the Deployment (wave 1), so a failed migration stops the rollout. See "Migrations" for the rules a migration follows.
- Probes on the `http` port: `/health/live` (the process answers) and `/health/ready` (503 without Postgres). Both return `x-app-version`, which the post-deploy smoke check waits for.
- Metrics: Prometheus text on port `9464` (`METRICS_PORT`), path `/metrics`, scraped through the ServiceMonitor from `components/api`. Never on the public `http` port.
- Callers: only Traefik and pods labelled `nick-lukashik.com/api-client: "true"` (NetworkPolicy from `components/api`).
- Egress: id-api and tailor-tex, both admitting `api-client` pods, llm-gateway, which admits tailor-api by name, and the internet on 443 (R2 and the vacancy fetch, which `components/api` allows); a vacancy link on plain http or another port fails with `network`/`timeout` unless that egress is opened too.
- Jobs: pg-boss keeps its own pool (the parse, CV and letters models' concurrencies plus 3 plus the fetch's 4, 25 by default) per pod (beside `DATABASE_POOL_MAX`) and its schema `pgboss`, installed and upgraded by the migrate Job and at start.

Conventions for agents and people: `AGENTS.md`; library rules: `.claude/rules/`.
