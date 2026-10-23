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

CI (`.github/workflows/ci.yml`) runs install (frozen lockfile), lint,
typecheck, test and build on every push and pull request.

## Project layout

```
src/
  app/            Next.js App Router routes and layouts
  domain/         Pure TypeScript business logic (see rule below)
  lib/supabase/   Supabase client helpers (browser + server)
supabase/
  config.toml     Supabase CLI config
  migrations/     Database migrations (empty for now)
```

## Domain boundary rule

Code in `src/domain/` is pure TypeScript and **must not** import from
`next`, `react`, `@supabase/*`, or anything under `src/app`. The Telegram
bot will reuse this code outside Next.js. The rule is enforced by an ESLint
`no-restricted-imports` rule scoped to `src/domain/**`, so `pnpm lint` fails
on violations. See [`src/domain/README.md`](src/domain/README.md).
