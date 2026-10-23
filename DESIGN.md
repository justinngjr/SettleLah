# SettleLah design system: "Quiet Editorial"

The host is the only user. They log receipts at the table, on a phone, often
with one hand. The interface must feel like a well-set page: calm, legible,
nothing competing for attention. Every screen says one thing big and
everything else small.

This document is normative. Tokens live in `src/app/globals.css`
(`@theme`) and the primitives in `src/app/_ui/`. If a screen needs something
not described here, add it here first.

## 1. Hierarchy comes from size, not weight or colour

- One **statement** per screen: the amount owed, the receipt total, the
  friend's balance. `font-size: clamp(2rem, 4vw, 3.5rem)`, weight 400,
  letter-spacing -0.045em, line-height 1. Class: `.statement`.
- Everything else is small: body 1rem, meta 0.875rem, labels 11px mono.
- Never bold display type. Weight 500 is the maximum anywhere and is reserved
  for mono labels and the current nav item.
- Colour is never used to rank information. `ink` for content, `ink-soft` for
  support, `ink-mute` for meta. No accent colour.

## 2. Type

| Role | Face | Size / line | Notes |
| --- | --- | --- | --- |
| UI and body | Inter Tight | 1rem / 1.55 | Max measure 62ch (`.measure`) |
| Statement | Inter Tight | `clamp(2rem, 4vw, 3.5rem)` / 1 | weight 400, tracking -0.045em |
| Section heading | Inter Tight | 1.25rem / 1.3 | weight 400, tracking -0.02em |
| Headline (optional, max one per page) | Instrument Serif | 1.75-2.25rem | weight 400, italic allowed, `.headline` |
| Tiny label | JetBrains Mono | 11px, weight 500 | uppercase, +0.08em, colour `ink-mute`, `.label` |
| Amounts in tables | JetBrains Mono | 0.9375rem | `font-variant-numeric: tabular-nums`, `.amount` |

Fonts are loaded with `next/font/google` in `src/app/layout.tsx` and exposed
as `--font-sans`, `--font-mono`, `--font-serif`.

## 3. Space

Generous. When in doubt add space.

- Heading to its support text: 32-48px (`mt-8` / `mt-12`).
- Between blocks (sections) on a page: 64-96px (`space-y-16` / `space-y-24`).
- Phone: 16px page margin, at least 24px of inner gutter inside cards/forms.
- Desktop: content sits on a shared left edge in a `max-w-3xl` column; the
  right side stays empty (asymmetric whitespace). Never centre a page.
- Single column on phones. Two columns only when the second one is meta.

## 4. Colour tokens

CSS variables, switched by `prefers-color-scheme`. Exposed to Tailwind as
`bg-paper`, `text-ink`, `border-line`, etc.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `paper` | `#F4F2EE` | `#212121` | page background |
| `paper-raised` | `#FFFFFF` | `#2A2A2A` | cards, fields |
| `paper-sunken` | `#EAE8E3` | `#171717` | wells, code, disabled |
| `ink` | `#171614` | `#F2F0EB` | text, primary button fill |
| `ink-soft` | `#4A4845` | `#C8C5BF` | support text |
| `ink-mute` | `#6B6863` | `#99968F` | labels, meta |
| `line` | `#DCD9D3` | `#3C3C3C` | 1px hairlines |

Forbidden: accent fills, gradients, shadows at rest, glass/blur, emoji,
icon-card rows, coloured status pills. Status is text ("Pending", "Paid").

Contrast: every text/background pair above meets WCAG AA (ink-mute on paper
is 4.6:1 light, 5.0:1 dark).

## 5. Lines, cards, forms

- 1px hairlines in `line`: under the nav, between sections, above meta rows
  (`.hairline`, `border-t border-line`).
- Cards: `paper-raised`, 1px `line` border, radius 8-12px, flat. No shadow.
- Forms: visible mono `.label` above a 48px field (`.field`), `paper-raised`,
  1px `line` border, radius 8px. Focus: 2px `ink` outline, 2px offset.
- Error text: `ink`, prefixed with the field it belongs to, `role="alert"`.
- Tables (ledger, shares): no vertical rules; hairline between rows; amounts
  right-aligned in mono.

## 6. Buttons

Pill shape (`rounded-full`), 48px tall on phones, trailing arrow glyph `→`
(the glyph, not an icon) for actions that go somewhere or submit.

- Primary: `ink` fill, `paper` text. One per screen.
- Secondary: 1px `line` outline, `ink` text.
- Tertiary: underlined text link, `ink`.
- Disabled: `paper-sunken` fill, `ink-mute` text, `cursor-not-allowed`, and
  the **reason** is printed next to it in `ink-mute`. Never disable silently.
- Destructive actions (archive, reject, cancel) are secondary with plain
  words. No red.

## 7. Motion

Calm. 150-200ms, `transform` and `opacity` only (hover lift of 1px, fade in
of new rows). No layout animation. Everything is wrapped in
`@media (prefers-reduced-motion: no-preference)`; with reduced motion there is
no transition at all.

## 8. Layout

- Shared left edge. The nav, the statement, every heading and every form
  field start on the same x. Right-aligned content is only numbers in tables.
- Nav: wordmark left, small text links right, hairline below. On phones the
  same row, scrollable if needed; no tab bar, no icons.
- Phone first: design every screen at 390px, then let it breathe at 1280px.

## 9. States are part of the design

Every list and every action has: loading (text "Loading…" in `ink-mute`,
or a `paper-sunken` block the size of the content), empty (one sentence +
one action), error (what happened + what to do; e.g. LLM unavailable ->
"Interpretation is unavailable right now. Enter the receipt manually →"),
and disabled-with-reason.

Money is only ever displayed from the domain (`formatSGD`) or the database.
The LLM's words (assumptions, questions, warnings) are shown as quotes in
`ink-soft`, clearly separated from the numbers.

## 10. Accessibility

- Every input has a visible `<label>`; placeholders are examples, not labels.
- Focus rings are visible everywhere (`:focus-visible` 2px `ink` outline).
- Buttons are buttons; links are links. Icon-only controls carry an
  `aria-label`.
- Hit targets at least 44x44px on phones.
- Contrast AA for all text; `ink-mute` is the lightest text allowed.
