# `src/domain/`

Pure TypeScript business logic for SettleLah (bill splitting, Singapore
service charge + GST, running balances, etc. — to be written in later
sessions).

## The rule

Code in `src/domain/` must be framework- and infrastructure-agnostic. It
**must not** import anything outside `src/domain` — only other files in
`src/domain` (relative or via `@/domain/*`) and pure third-party libraries
are allowed. In particular, this forbids:

- `next` or `next/*`
- `react` or `react-dom`
- `@supabase/*`
- anything else under `src/` (e.g. `src/app`, `src/lib`), whether reached
  via the `@/` alias or a relative path like `../lib/...`

The Telegram bot will reuse this code outside of Next.js, so it must run in
plain Node without any web framework present.

This rule is enforced in `eslint.config.mjs`, scoped to `src/domain/**`, by
`no-restricted-imports` (package bans and the `@/` alias) and
`import/no-restricted-paths` (relative imports escaping `src/domain`);
`pnpm lint` fails on violations.
