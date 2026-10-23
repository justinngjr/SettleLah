# SettleLah

SettleLah helps the person who fronts payments for a group (the "host")
track, collect and reconcile money friends owe them. This repo is the host
web app (Next.js). A Telegram bot for friends will later share the same core
domain logic.

## Stack

- Node 22 (`.nvmrc`) and pnpm (`packageManager` in `package.json`)
- Next.js (App Router, `src/` layout), TypeScript (`strict`), Tailwind CSS
- ESLint, Vitest
- Supabase (`@supabase/supabase-js` + `@supabase/ssr`)

## Getting started

```bash
nvm use            # or otherwise use Node 22
corepack enable    # provides the pinned pnpm version
pnpm install
cp .env.example .env.local   # then fill in the values
pnpm dev
```

### Environment variables

Copy `.env.example` to `.env.local` and set:

| Variable                        | Description                       |
| ------------------------------- | --------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase project URL              |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon (public) API key    |
| `SUPABASE_SERVICE_ROLE_KEY`     | Service-role key, server-only; bypasses RLS. Only for the bot/webhooks/cron (`createServiceClient`) |
| `NEXT_PUBLIC_SITE_URL`          | Optional origin for magic-link redirects (defaults to the request host) |
| `LLM_BASE_URL`                  | OpenAI-compatible API root for receipt interpretation (server-only) |
| `LLM_API_KEY`                   | API key for that provider (server-only) |
| `LLM_MODEL`                     | Primary model name (server-only) |
| `LLM_FALLBACK_MODEL`            | Optional second model tried once if the primary fails (server-only) |

`.env*.local` files are gitignored. The app builds without real values; they
are only required at runtime when a Supabase client is created.

## Scripts

| Command          | What it does                      |
| ---------------- | --------------------------------- |
| `pnpm dev`       | Start the dev server              |
| `pnpm lint`      | ESLint                            |
| `pnpm typecheck` | `tsc --noEmit`                    |
| `pnpm test`      | `vitest run`                      |
| `pnpm build`     | Production build (`next build`)   |

CI (`.github/workflows/ci.yml`) runs two jobs on every push and pull
request: `ci` (install with frozen lockfile, lint, typecheck, test, build) and
`supabase` (`supabase start`, `supabase db reset`, `supabase test db`, and a
check that `src/server/db/database.types.ts` matches the migrations).

## Running Supabase locally

Requires Docker and the [Supabase CLI](https://supabase.com/docs/guides/local-development).

```bash
supabase start                 # Postgres, Auth, PostgREST, Mailpit...
supabase status                # prints the API URL and keys
# .env.local: NEXT_PUBLIC_SUPABASE_URL = API URL, NEXT_PUBLIC_SUPABASE_ANON_KEY = anon key,
#             SUPABASE_SERVICE_ROLE_KEY = service_role key
supabase db reset              # drop + re-apply supabase/migrations + seed.sql
supabase test db               # pgTAP tests in supabase/tests
supabase gen types typescript --local > src/server/db/database.types.ts   # after changing migrations
supabase stop
```

Sign in at `http://localhost:3000/login`; the magic link lands in Mailpit at
`http://127.0.0.1:54324`. Writing a migration: add
`supabase/migrations/<YYYYMMDDHHMMSS>_<name>.sql`, run `supabase db reset`,
regenerate the types and add/adjust a test in `supabase/tests/`. The schema and
its rules are described in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Auth

Only hosts sign in (Supabase email magic link): `/login` -> email ->
`/auth/callback` -> `/app`. `src/proxy.ts` refreshes the session on every
request and blocks `/app/*` and `/api/*` without a session (redirect / 401).
`src/lib/auth/routes.ts` holds the single allowlist of routes that stay
public. Friends never have accounts.

## API

| Route                 | What it does |
| --------------------- | ------------ |
| `POST /api/interpret` | Sends a receipt (image data URL or text), the host's note and the participants to the configured LLM and returns a *proposed* split computed by `src/domain` (amounts in cents). Nothing is persisted. See `src/server/interpret/`. |

`/api/interpret` requires a signed-in host (401 otherwise). The host's
participant id is their auth user id, taken from the session; a client-sent
`hostId` is ignored, and the participants list must include the host.

## Branches

- `develop` is the integration branch. Feature branches are opened as PRs
  into `develop`.
- `main` only receives deliberate promotions from `develop` on release.
- CI runs on every pull request and on pushes to `main` and `develop`.

## Project layout

```
src/
  app/            Next.js App Router routes and layouts
  domain/         Pure TypeScript business logic (see rule below)
  server/         Server-only modules: db/ (typed data layer), auth/, interpret/ (LLM)
  lib/auth/       Route protection allowlist (pure)
  lib/supabase/   Supabase client helpers (browser, server, proxy)
  proxy.ts        Next.js proxy: session refresh + route guard
supabase/
  config.toml     Supabase CLI config
  migrations/     Database migrations (schema, RLS, SQL functions)
  tests/          pgTAP tests (`supabase test db`)
docs/ARCHITECTURE.md  Tables, RLS model, RPCs, what each later session uses
```

## Domain boundary rule

Code in `src/domain/` is pure TypeScript and **must not** import from
`next`, `react`, `@supabase/*`, or anything under `src/app`. The Telegram
bot will reuse this code outside Next.js. The rule is enforced by an ESLint
`no-restricted-imports` rule scoped to `src/domain/**`, so `pnpm lint` fails
on violations. See [`src/domain/README.md`](src/domain/README.md).
