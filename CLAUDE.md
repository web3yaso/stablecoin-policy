@AGENTS.md

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — Next.js dev server (Turbopack).
- `npm run build` — Runs `prebuild` (copies `data/news/summaries.json` → `public/news-summaries.json`) then `next build`. Do not edit `public/news-summaries.json` by hand; it is regenerated from `data/news/summaries.json`.
- `npm run lint` — ESLint via `eslint-config-next` (flat config in `eslint.config.mjs`).
- `npx tsc` — Typecheck only; `tsc` has `noEmit: true`. There is no separate test runner in this repo.
- `npm run news:poll` / `npm run news:regen` — RSS pull and Anthropic-driven news regeneration.
- `npm run data:rebuild` — Regenerate `lib/placeholder-data.ts` (see "Generated data" below).
- Sync scripts: `npx tsx scripts/sync/<name>.ts` (e.g. `bills-federal.ts`, `bills-states.ts`, `news-rss.ts`, `international.ts`). Smoke checks live in `scripts/smoke/`.
- x402 paid-report e2e check (Base Sepolia ONLY, never with a mainnet key): `npx tsx scripts/reports/verify-x402.ts`.

Every standalone `tsx` script must import `./env.js` (or `../env.js`) first — `scripts/env.ts` loads `.env.local` into `process.env`. Next.js loads `.env.local` for app code automatically, but scripts do not.

## Architecture

### Generated data pipeline
`lib/placeholder-data.ts` (~690KB) is a **generated** aggregate, do not hand-edit. It is rebuilt by `scripts/build-placeholder.ts` (run via `npm run data:rebuild`) from:

- `data/legislation/federal.json` + `data/legislation/states/*.json`
- `data/figures/federal.json` + `data/figures/states/*.json`
- `data/news/summaries.json`

Per-country international data lives in `data/international/*.json`; the curated entity list / dimension overrides for EU and Asia are in `lib/international-entities.ts` and are **not** touched by the rebuild script. Sync scripts in `scripts/sync/` are the only writers of `data/legislation/`, `data/figures/`, `data/news/`, etc.

### App (Next.js 16 App Router)
Path alias `@/*` → repo root (see `tsconfig.json`). Heed the note in `AGENTS.md`: many Next.js APIs and conventions differ from older versions — consult `node_modules/next/dist/docs/` before writing route handlers, metadata, or config.

- `app/page.tsx` is a client component that composes the hero/map plus lazy-loaded `AIOverview`, `LegislationTable`, `PoliticiansOverview`, `LiveNews` sections.
- Map components in `components/map/` use `react-simple-maps` + `d3-geo` + `topojson-client`. `MapShell.tsx` is the orchestrator and exposes a `navigateRef` so the rest of the page can drive map navigation.
- Side-panel UI lives in `components/panel/`.
- i18n is a runtime string lookup: `lib/i18n.ts` + `contexts/LocaleContext.tsx`. Use `t(locale, key)` in components, do not introduce a separate i18n framework.

### Paid reports API (x402)
The paid-report subsystem is the most environment-sensitive part of the repo.

- `data/reports/index.json` is the public catalog. Each entry references an `encryptedContentFile` (`*.md.enc`).
- Report Markdown is **encrypted at rest** (AES-256-GCM) with `REPORTS_ENCRYPTION_KEY`. Plaintext `data/reports/*.md` and `data/reports/private/` are gitignored and must never be committed. Add reports via `scripts/reports/add-report.ts`.
- `lib/reports.ts` validates the index and decrypts content; it surfaces a typed `ReportContentKeyMissingError` so route handlers can return 503 instead of 500 when the key is missing.
- `lib/x402-server.ts` wires the x402 resource server with the bazaar discovery extension, derives the network from `X402_NETWORK` (CAIP-2, e.g. `eip155:84532`), and adds an `onBeforeSettle` payment-replay guard backed by Vercel KV (`lib/payment-logs.ts`).
- `app/api/reports/route.ts` is the free catalog endpoint (rate-limited per IP). `app/api/reports/[slug]/route.ts` is the paid endpoint — it constructs a named-pattern `x402HTTPResourceServer` so discovery emits a real `:slug` path param.
- `app/.well-known/x402/route.ts` and `app/openapi.json/route.ts` describe the API for discovery/registry probes.

**Facilitator choice matters and is environment-only — there is no code switch:**
- Base Sepolia (`eip155:84532`): set `X402_FACILITATOR_URL=https://x402.org/facilitator` and leave the CDP keys empty. A valid Coinbase CDP key also works for testnet; an invalid CDP key returns 401 on `getSupported`, the server loads no kinds, and the paid route 500s with an empty body in production builds only (not `next dev`). When debugging an opaque 500, reproduce with `next build && next start` and check the facilitator env before changing code.
- Base mainnet (`eip155:8453`): the public x402.org facilitator does not cover mainnet, so mainnet requires CDP (`X402_FACILITATOR_URL` empty, valid `CDP_API_KEY_ID`/`CDP_API_KEY_SECRET`). x402scan and similar registries only index mainnet endpoints.

The `verify-x402.ts` script is the canonical end-to-end check and must only be run against Base Sepolia with `TEST_BUYER_PRIVATE_KEY`. Never put a mainnet private key in any env file in this repo.
