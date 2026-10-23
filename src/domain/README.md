# `src/domain/`

Pure TypeScript business logic for SettleLah (bill splitting, Singapore
service charge + GST, running balances, etc. — to be written in later
sessions).

## The rule

Code in `src/domain/` must be framework- and infrastructure-agnostic. It
**must not** import from:

- `next` or `next/*`
- `react` or `react-dom`
- `@supabase/*`
- anything under `src/app` (including via the `@/app` alias)

The Telegram bot will reuse this code outside of Next.js, so it must run in
plain Node without any web framework present.

This rule is enforced by an ESLint `no-restricted-imports` rule scoped to
`src/domain/**` in `eslint.config.mjs`; `pnpm lint` fails on violations.
