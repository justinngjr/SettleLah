# `src/domain/`

Pure TypeScript business logic for SettleLah. "Code handles the money; AI
only interprets": every amount is an integer number of cents and there is no
floating-point arithmetic on money anywhere in this directory.

| Module        | Responsibility                                                          |
| ------------- | ----------------------------------------------------------------------- |
| `money.ts`    | `Cents` type, validation, `fromDollars("12.34")`, `formatSGD(cents)`     |
| `charges.ts`  | Service charge then GST (basis points, half-up per line), receipt lines  |
| `split.ts`    | Allocates the receipt total across participants, exact to the cent; exclusions need an explicit `redistribute` mode |
| `rounding.ts` | `allocateRemainder` (default) and `hostNeverAbsorbs(hostId)`: the single place that decides who gets leftover cents |
| `balances.ts` | Host ↔ friend ledger: shares, payments, credit, friend-fronted           |
| `rational.ts` | Internal exact `bigint` rationals used by `split.ts`                     |

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
