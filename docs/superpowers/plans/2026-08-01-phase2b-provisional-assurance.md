# Phase 2B — Provisional Machine Assurance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/v1/policy-feed` as an independent quick win, then deliver the machine-assurance lane — Quint state machine, `MachineAssuranceRecord`, automated claim pipeline, provisional public API — and reproducible EEA/Singapore provisional baselines, with Hong Kong truthfully reported as blocked.

**Architecture:** The machine lane is a parallel assurance track (`SOURCE_OBSERVED → SOURCE_VALIDATED → AI_EXTRACTED → AI_CROSS_CHECKED → PROVISIONAL_PUBLISHED`) that reuses the existing draft-import channel (migrations `0015`/`0017`) for AI-extracted claims, adds immutable `MachineAssuranceRecord` audit rows with service-only RPC transitions (forward-only migrations from `0020`), and publishes through a separate provisional-release table that can never satisfy any named-human gate. `HUMAN_REVIEWED` remains an independent upgrade path with unchanged semantics.

**Tech Stack:** Next.js 16 Route Handlers, TypeScript, Supabase PostgreSQL/Storage, Quint 0.32.0, node:test + tsx, pgTAP, JSONL deterministic evals, OpenAI API (operator scripts only, never in CI).

## Global Constraints

- Order of delivery is fixed: policy-feed → Quint spec delta → migration `0020`+records → pipeline → provisional API → EEA baseline → SG baseline → HK blocked reporting → exit-condition docs.
- Spec first: the formal spec (`docs/superpowers/specs/2026-07-31-...-development-spec.md`) and Quint model must be updated and green **before** any migration or API code for the same behavior (master plan §1, §7).
- Machine states must never impersonate `HUMAN_REVIEWED`: no machine transition may set any `*HumanReviewRecorded` flag, satisfy a named-human RPC gate, or appear in reviewed-only views. Existing `VERIFIED`/reviewed semantics stay intact.
- Missing, contradictory, stale, or rights-blocked evidence must fail closed: it blocks deterministic conclusions and provisional publication automatically.
- Every provisional output must include `assuranceLevel`, `reviewStatus`, `confidence`, `asOf`, source version + citation, `limitations`, `counselTriggers`.
- Forward-only migrations starting at `0020`; never edit `0001`–`0019`. Migrations are never applied automatically; production application is a separate reviewed step.
- **No live LLM or live network in tests, evals, or acceptance criteria.** All CI checks run on fixed fixtures; live extraction runs are operator actions via dry-run-default CLIs.
- Work on `codex/` feature branches; local commits are fine, but the user owns pushes, PRs, and production migration application.
- `docs/PROJECT_CONTEXT.md` is updated locally but never committed.
- Quality floor (must not regress): 85 unit tests, Phase 2 evals 77, pgTAP 120, Quint 20 scenarios / 9 invariants / 6 witnesses.

---

### Task 1: `/v1/policy-feed` quick win

**Files:** exactly those listed in `docs/superpowers/plans/2026-08-01-citely-policy-feed.md` §7.

**Interfaces:**
- Consumes: `getDatasetService().getActiveDataset("news-summaries")` from `lib/data/dataset-service.ts` (returns `DatasetSnapshot<T> | null` with release `generatedAt`, checksum, cache state).
- Produces: `GET /v1/policy-feed` returning `{ schemaVersion: "1.0.0", generatedAt, items[] }`; builder `buildPolicyFeed(snapshot, playbookMap): PolicyFeedResponse` in `lib/policy-feed/build.ts` (pure, deterministic, throws typed errors on any invalid item).

- [ ] **Step 1:** Execute `docs/superpowers/plans/2026-08-01-citely-policy-feed.md` end-to-end. That plan is complete and self-contained (contract §2, projection §3, inclusion rules §4, playbook map §5, atomic failure/cache behavior §6, files §7, sequence §8, test cases §9, quality gate §10). Do not re-derive any decision recorded there. Highlights that must not be missed:
  - `generatedAt` is the release's, never request time; stale snapshots keep their old timestamp with `Warning: 110` + `X-Data-Stale: true`.
  - Only `official-api` / `official-feed` items; any single malformed eligible item → whole response `503`, no partial feed.
  - `playbookId` only from `config/policy-feed-playbook-map.json`; invalid mapped ID fails the build.
- [ ] **Step 2:** Run the quality gate: `npm test && npm run lint && npm run typecheck && npm run build && npm run data:check`. Expected: all pass; new `tests/policy-feed.test.ts` covers every §9 case.
- [ ] **Step 3:** Commit on `codex/policy-feed`:

```bash
git add contracts/v1/policy-feed.schema.json contracts/policy-feed.md config/policy-feed-playbook-map.json lib/policy-feed app/v1/policy-feed tests/policy-feed.test.ts contracts/README.md app/openapi.json docs/citely-product-family-boundary.md docs/superpowers
git commit -m "feat: add /v1/policy-feed thin projection of news-summaries"
```

- [ ] **Step 4:** Hand the branch to the user for PR/deploy; production smoke (§11 of that plan) happens after their deploy. Do not block Task 2 on the deploy.

---

### Task 2: Quint machine-assurance state machine + formal spec delta

**Files:**
- Create: `specs/machineAssurance.qnt`, `specs/machineAssurance_test.qnt`, `specs/machineAssurance.md`
- Modify: `docs/superpowers/specs/2026-07-31-stablecoin-policy-domain-api-development-spec.md` (assurance ladder section, ~lines 319–340), `package.json` (extend `spec:phase2:*` scripts)
- Test: Quint test/simulate commands below

**Interfaces:**
- Produces: state names `SourceObserved | SourceValidated | AiExtracted | AiCrossChecked | ProvisionalPublished` and a **separate** `humanReviewed: bool` that only `applyHumanReview` can set. Tasks 3–5 must mirror these names as SQL enum `policy.machine_assurance_level` values `SOURCE_VALIDATED | AI_EXTRACTED | AI_CROSS_CHECKED | PROVISIONAL_PUBLISHED` and API `assuranceLevel` strings.

- [ ] **Step 1:** Update the formal spec: replace the ladder text with the five machine states plus `HUMAN_REVIEWED` as an explicitly separate upgrade path (not a sixth machine state); state that `PROVISIONAL_PUBLISHED` is the terminal machine state; copy in the mandatory output fields and the fail-closed evidence rules from Global Constraints; record the new Phase 2 exit conditions (see Task 9 wording — write them once here, Task 9 syncs the other docs).
- [ ] **Step 2:** Write `specs/machineAssurance.qnt` following the existing `legalCorpusPublication.qnt` can/apply convention:

```quint
module machineAssurance {
  type MachineState = SourceObserved | SourceValidated | AiExtracted
    | AiCrossChecked | ProvisionalPublished

  type EvidenceState = {
    machineState: MachineState,
    // deterministic check outcomes; false = failed or not evaluated
    identityChecksumOk: bool,
    rightsAllowStorage: bool,
    citationLocatorOk: bool,
    sourceFresh: bool,
    noContradiction: bool,
    crossCheckAgreed: bool,
    assuranceRecordWritten: bool,
    // the separate human lane — machine transitions must never touch these
    humanReviewed: bool,
    humanReviewerNamed: bool,
  }

  var state: EvidenceState

  pure def canValidateSource(s: EvidenceState): bool = and {
    s.machineState == SourceObserved,
    s.identityChecksumOk,
    s.rightsAllowStorage,
  }
  pure def applyValidateSource(s: EvidenceState): EvidenceState =
    { ...s, machineState: SourceValidated, assuranceRecordWritten: true }

  pure def canExtract(s: EvidenceState): bool = and {
    s.machineState == SourceValidated,
    s.citationLocatorOk,
  }
  pure def applyExtract(s: EvidenceState): EvidenceState =
    { ...s, machineState: AiExtracted, assuranceRecordWritten: true }

  pure def canCrossCheck(s: EvidenceState): bool = and {
    s.machineState == AiExtracted,
    s.crossCheckAgreed,
    s.noContradiction,
    s.sourceFresh,
  }
  pure def applyCrossCheck(s: EvidenceState): EvidenceState =
    { ...s, machineState: AiCrossChecked, assuranceRecordWritten: true }

  pure def canPublishProvisional(s: EvidenceState): bool = and {
    s.machineState == AiCrossChecked,
    s.identityChecksumOk, s.rightsAllowStorage, s.citationLocatorOk,
    s.sourceFresh, s.noContradiction, s.crossCheckAgreed,
    s.assuranceRecordWritten,
  }
  pure def applyPublishProvisional(s: EvidenceState): EvidenceState =
    { ...s, machineState: ProvisionalPublished }

  // human review is an upgrade on top of any machine state; it is the ONLY
  // action that may set humanReviewed, and it requires a named human
  pure def canHumanReview(s: EvidenceState, namedHuman: bool): bool = namedHuman
  pure def applyHumanReview(s: EvidenceState): EvidenceState =
    { ...s, humanReviewed: true, humanReviewerNamed: true }
}
```

- [ ] **Step 3:** Add invariants + witnesses in the same module:
  - `machineCannotClaimHumanReview`: `state.humanReviewed implies state.humanReviewerNamed` and no machine `apply*` sets it (encode by construction: only `applyHumanReview` writes those fields; invariant checks the pair never diverges).
  - `provisionalRequiresFullChecks`: `state.machineState == ProvisionalPublished implies (identityChecksumOk and rightsAllowStorage and citationLocatorOk and sourceFresh and noContradiction and crossCheckAgreed and assuranceRecordWritten)`.
  - `blockedEvidenceNeverPublished`: with any check flag false, `ProvisionalPublished` is unreachable (expressed as the same implication; failing-flag nondeterminism in the step action exercises it).
  - Witnesses: `sourceValidatedWitness`, `crossCheckedWitness`, `provisionalPublishedWitness`, `humanUpgradeAfterProvisionalWitness` (reachability of the honest happy path and of the upgrade path).
- [ ] **Step 4:** Write `specs/machineAssurance_test.qnt` with at least eight scenario tests (happy path to `ProvisionalPublished`; publish blocked by each of: contradiction, stale source, rights, missing cross-check, missing assurance record; human upgrade from `ProvisionalPublished`; human review never granted to an unnamed/automated reviewer).
- [ ] **Step 5:** Wire npm scripts — extend `spec:phase2:typecheck`, `spec:phase2:test`, `spec:phase2:simulate` in `package.json` to also cover `machineAssurance` (same `npx --yes @informalsystems/quint@0.32.0` pattern, `--match '.*Test$'`, `--max-steps 20`, listing the new invariants and witnesses).
- [ ] **Step 6:** Run `npm run spec:phase2`. Expected: existing 20 scenarios untouched and green; new module typechecks, all new tests pass, invariants hold, witnesses reachable.
- [ ] **Step 7:** Commit:

```bash
git add specs/machineAssurance.qnt specs/machineAssurance_test.qnt specs/machineAssurance.md docs/superpowers/specs/2026-07-31-stablecoin-policy-domain-api-development-spec.md package.json
git commit -m "feat: model machine-assurance state machine in Quint and update formal spec"
```

- [ ] **Step 8:** STOP and show the user the spec delta + Quint output for approval before Task 3 (master plan §7 Phase 2B requires explicit approval of the spec delta before database code).

---

### Task 3: Migration `0020` — `MachineAssuranceRecord`

**Files:**
- Create: `supabase/migrations/0020_machine_assurance_records.sql`, `supabase/tests/0020_machine_assurance.sql`, `lib/legal-corpus/machine-assurance.ts`
- Modify: `lib/legal-corpus/types.ts` (add types below), `scripts/migrate/export-phase1-metadata.ts` (backup format bump to `1.5.0` including new tables)
- Test: `tests/machine-assurance.test.ts`

**Interfaces:**
- Consumes: `regulatory.source_version` ids/fingerprints and the claim-draft rows created by migration `0015`'s import path.
- Produces (used by Tasks 4–5):

```typescript
// lib/legal-corpus/types.ts additions
export type MachineAssuranceLevel =
  | "SOURCE_VALIDATED"
  | "AI_EXTRACTED"
  | "AI_CROSS_CHECKED"
  | "PROVISIONAL_PUBLISHED";

export type MachineCheckResult = "PASS" | "FAIL" | "NOT_EVALUATED";

export interface MachineAssuranceChecks {
  contradiction: MachineCheckResult;
  freshness: MachineCheckResult;
  rights: MachineCheckResult;
  jurisdiction: MachineCheckResult;
  effectiveDates: MachineCheckResult;
  citationLocator: MachineCheckResult;
}

export interface MachineAssuranceRecord {
  id: string;
  subjectType: "SOURCE_VERSION" | "CLAIM_DRAFT";
  subjectId: string;
  assuranceLevel: MachineAssuranceLevel;
  sourceVersionFingerprint: string;
  claimFingerprint: string | null;      // null for SOURCE_VALIDATED records
  model: string | null;                 // null for deterministic-only records
  promptTemplateId: string | null;
  promptTemplateVersion: string | null;
  parametersVersion: string | null;
  confidence: number | null;            // 0..1; null for deterministic-only
  checks: MachineAssuranceChecks;
  inputChecksum: string;
  outputChecksum: string;
  blockers: string[];
  limitations: string[];
  createdAt: string;
}
```

- `lib/legal-corpus/machine-assurance.ts` exports `recordMachineAssurance(input: Omit<MachineAssuranceRecord, "id" | "createdAt">): Promise<MachineAssuranceRecord>` (calls the RPC) and `getAssuranceChain(subjectType, subjectId): Promise<MachineAssuranceRecord[]>`.

- [ ] **Step 1:** Write failing unit tests in `tests/machine-assurance.test.ts` against a fake repository (same pattern as `tests/source-verification.test.ts`): record creation returns immutable row; a record with any `checks.* == "FAIL"` or non-empty `blockers` cannot accompany a level advance; `confidence` outside `[0,1]` rejected; `SOURCE_VALIDATED` allows null model fields but `AI_*` levels require model, prompt template + version, parameters version, and confidence.
- [ ] **Step 2:** Run `node --import tsx --test tests/machine-assurance.test.ts` — expect FAIL (module not found).
- [ ] **Step 3:** Write migration `0020`:
  - enum `policy.machine_assurance_level`; table `policy.machine_assurance_record` with the columns above (checks as `jsonb` validated by a `CHECK` against the six keys and three values; `blockers`/`limitations` as `text[]`), RLS enabled, no direct service-role `INSERT/UPDATE/DELETE` (same denial pattern as migrations `0011`–`0019`);
  - immutability trigger rejecting `UPDATE`/`DELETE`;
  - column `policy.claim.machine_assurance_level` (nullable) — machine level lives beside, never inside, `ClaimLegalStatus` or review fields;
  - fixed-search-path `SECURITY DEFINER` RPC `policy.record_machine_assurance(...)` that atomically inserts the record and advances the subject's machine level **only** when every check is `PASS` and `blockers = '{}'`; on any failure it inserts the record with the failure captured and does not advance;
  - RPC rejects any attempt to write reviewer identities, `verified_at`, or claim review fields (machine lane cannot touch the human lane).
- [ ] **Step 4:** Implement `lib/legal-corpus/machine-assurance.ts` + types; make Step 1 tests pass: `node --import tsx --test tests/machine-assurance.test.ts` → PASS.
- [ ] **Step 5:** Write pgTAP `supabase/tests/0020_machine_assurance.sql` (≥12 assertions): direct insert/update/delete denied; RPC inserts immutable record; failed check does not advance level; passing chain advances `SOURCE_VALIDATED → AI_EXTRACTED → AI_CROSS_CHECKED`; RPC cannot set `verified_at` or claim-review columns; automated-reviewer style input to human RPCs still fails (regression). All fixtures sanitized and rolled back.
- [ ] **Step 6:** Run locally: `npm run db:phase2:start && npm run test:db:phase2 && npm run db:phase2:stop`. Expected: existing 120 + new assertions all pass (fresh apply `0001`–`0020`).
- [ ] **Step 7:** `npm test && npm run lint && npm run typecheck` → PASS. Commit:

```bash
git add supabase/migrations/0020_machine_assurance_records.sql supabase/tests/0020_machine_assurance.sql lib/legal-corpus/machine-assurance.ts lib/legal-corpus/types.ts tests/machine-assurance.test.ts scripts/migrate/export-phase1-metadata.ts
git commit -m "feat: add immutable MachineAssuranceRecord with service-only RPC (migration 0020)"
```

Do **not** apply `0020` to production in this task; production application follows the established backup + dry-run procedure and is owned by the user.

---

### Task 4: Automated claim pipeline (extract → cross-check → deterministic checks → provisional release)

**Files:**
- Create: `lib/legal-corpus/machine-pipeline.ts`, `lib/legal-corpus/provisional-release.ts`, `scripts/assurance/extract-claims.ts`, `scripts/assurance/cross-check-claims.ts`, `scripts/assurance/provisional-release.ts`, `scripts/smoke/machine-pipeline-dryrun.ts`, `supabase/migrations/0021_provisional_release.sql`, `supabase/tests/0021_provisional_release.sql`, `evals/phase2b-machine-pipeline-cases.jsonl`
- Modify: `package.json` (scripts `assurance:extract`, `assurance:crosscheck`, `assurance:release`, `smoke:machine-pipeline`), `scripts/evals/run-phase2.ts` (load the new JSONL), `evals/manifest.json`
- Test: `tests/machine-pipeline.test.ts`, `tests/provisional-release.test.ts`

**Interfaces:**
- Consumes: `MachineAssuranceRecord` RPC from Task 3; the claim-draft bundle preflight/import channel from migrations `0015`/`0017` (`lib/legal-corpus/claim-draft-import.ts`); provisions from `regulatory` schema; `lib/openai-llm.ts` for model calls (injected, mockable).
- Produces:

```typescript
// lib/legal-corpus/machine-pipeline.ts
export interface ExtractionRun {
  sourceVersionId: string;
  promptTemplateId: string;      // e.g. "claim-extraction"
  promptTemplateVersion: string; // e.g. "1.0.0"
  parametersVersion: string;
  drafts: ExtractedClaimDraft[]; // becomes a 0015-format bundle
}
export interface ExtractedClaimDraft {
  proposition: string;
  citations: { provisionId: string; locator: string }[];
  confidence: number;
}
export function runDeterministicChecks(draft, sourceVersion, rights): MachineAssuranceChecks;
// pure; used by tests, evals, and both CLIs

// lib/legal-corpus/provisional-release.ts
export function createProvisionalRelease(input: {
  jurisdiction: string; asOf: string; claimIds: string[];
}): Promise<{ releaseId: string; fingerprint: string }>;
```

- [ ] **Step 1:** Write failing tests first. `tests/machine-pipeline.test.ts` (all model IO from fixtures, zero network): extraction output maps to a valid `0015` bundle forced to private `DRAFT`; cross-check disagreement produces `checks.contradiction = "FAIL"` and a blocker; `runDeterministicChecks` fails closed on missing provision locator, stale source, `LINK_ONLY`/`REVIEW_REQUIRED` rights, wrong jurisdiction, out-of-range effective dates; identical input replays to identical checksums. `tests/provisional-release.test.ts`: release requires every member claim at `AI_CROSS_CHECKED` with zero blockers; empty membership rejected; fingerprint binds `asOf` + sorted membership + each claim's assurance-record checksum.
- [ ] **Step 2:** Run both test files → expect FAIL (modules not found).
- [ ] **Step 3:** Write migration `0021`: table `policy.provisional_corpus_release` (+ membership table), **physically separate from the reviewed release tables of migration `0012`** so provisional data can never appear in reviewed queries; same RLS/immutability/RPC-only-write pattern; RPC `policy.publish_provisional_release` verifies membership assurance levels, zero blockers, fresh fingerprints; reviewed-release RPCs are untouched and cannot see provisional rows. pgTAP `0021` (≥10 assertions) proves: provisional publish with a blocked claim fails; provisional rows never satisfy reviewed-release or coverage RPC preconditions; direct writes denied.
- [ ] **Step 4:** Implement `machine-pipeline.ts` + `provisional-release.ts`; make Step 1 tests pass.
- [ ] **Step 5:** Implement the three CLIs, all **dry-run by default** with explicit `--execute`, following `scripts/review/legal-claim-draft-import.ts` conventions:
  - `assurance:extract` — reads provisions, calls the extraction model, writes a `0015`-format bundle + `AI_EXTRACTED` assurance records (drafts stay private `DRAFT`);
  - `assurance:crosscheck` — independent second model (`OPENAI_MODEL` vs `OPENAI_FAST_MODEL` are NOT independent enough for confidence-critical use; parameterize `--model` explicitly) re-derives claims from the same provisions, compares entailment, runs `runDeterministicChecks`, records `AI_CROSS_CHECKED` or blockers;
  - `assurance:release` — calls `publish_provisional_release`, prints fingerprint and membership.
- [ ] **Step 6:** Write `scripts/smoke/machine-pipeline-dryrun.ts`: runs the full pipeline against committed fixture provisions and canned model outputs (no network), asserting the end state is a publishable provisional release. Wire as `npm run smoke:machine-pipeline`. **This smoke, not a live LLM run, is the acceptance evidence.**
- [ ] **Step 7:** Add ≥10 deterministic eval cases in `evals/phase2b-machine-pipeline-cases.jsonl` (per Phase 2B eval list in master plan §7: entailment, contradiction, effective dates, model disagreement, stale/missing/rights-blocked source, prompt-injected source text must not become authority, replay determinism, fingerprint change, machine-to-human escalation, provisional-cannot-satisfy-human invariant) and register them in `run-phase2.ts` + `evals/manifest.json`.
- [ ] **Step 8:** Run everything: `npm test`, `npm run eval:phase2`, `npm run smoke:machine-pipeline`, local pgTAP cycle, `npm run lint && npm run typecheck && npm run build`. Expected: all green.
- [ ] **Step 9:** Commit:

```bash
git add lib/legal-corpus/machine-pipeline.ts lib/legal-corpus/provisional-release.ts scripts/assurance scripts/smoke/machine-pipeline-dryrun.ts supabase/migrations/0021_provisional_release.sql supabase/tests/0021_provisional_release.sql evals tests/machine-pipeline.test.ts tests/provisional-release.test.ts package.json scripts/evals/run-phase2.ts
git commit -m "feat: add automated claim pipeline with provisional release (migration 0021)"
```

---

### Task 5: Provisional public API exposure

**Files:**
- Create: `contracts/v1/provisional-claim.schema.json`, `supabase/migrations/0022_provisional_public_views.sql`, `supabase/tests/0022_provisional_public_views.sql`
- Modify: `lib/legal-corpus/public-contracts.ts`, `lib/legal-corpus/public-repository.ts`, `lib/legal-corpus/supabase-public-repository.ts`, `app/v1/coverage/route.ts` and `app/v1/changes/route.ts` (assurance fields), new route `app/v1/claims/[id]/route.ts`, `app/openapi.json/route.ts`, `contracts/README.md`
- Test: extend `tests/phase2-legal-corpus.test.ts`; new eval cases in `evals/phase2b-public-boundary-cases.jsonl`

**Interfaces:**
- Consumes: provisional release + assurance chain from Tasks 3–4.
- Produces: every provisional payload contains exactly the mandatory envelope; reviewed-only endpooints remain unchanged for reviewed data:

```json
{
  "assuranceLevel": "AI_CROSS_CHECKED",
  "reviewStatus": "PROVISIONAL",
  "confidence": 0.87,
  "asOf": "2026-08-01",
  "sourceVersion": { "id": "...", "checksum": "...", "retrievedAt": "..." },
  "citation": { "provisionId": "...", "locator": "Article 36(1)" },
  "limitations": ["Machine-generated; not human-reviewed legal advice."],
  "counselTriggers": ["CONFLICTING_NATIONAL_TRANSPOSITION"]
}
```

`reviewStatus` values: `PROVISIONAL | HUMAN_REVIEWED`; a payload may carry `HUMAN_REVIEWED` only when backed by a named-human review record — enforced in the view, not the route.

- [ ] **Step 1:** Write the strict JSON Schema `contracts/v1/provisional-claim.schema.json` (2020-12, `additionalProperties: false`, all eight envelope fields required, `confidence` 0–1, `assuranceLevel` enum without any human value, `reviewStatus` enum) and failing contract tests asserting: a provisional claim response validates; a response missing any envelope field fails; a payload claiming `reviewStatus: "HUMAN_REVIEWED"` without a review record is impossible to construct from the view fixture.
- [ ] **Step 2:** Run new tests → FAIL.
- [ ] **Step 3:** Migration `0022`: presentation-safe views `policy.public_provisional_claim` / extensions to coverage+changes views that (a) join assurance records for `assuranceLevel`/`confidence`/`limitations`/`counselTriggers`, (b) label every machine row `PROVISIONAL`, (c) structurally cannot emit `HUMAN_REVIEWED` for a row lacking a named-human review (CASE on review-record join, no fallback). pgTAP (≥8 assertions): view exposes no reviewer identity, prompt text, or private fields; machine rows always `PROVISIONAL`; reviewed rows unchanged.
- [ ] **Step 4:** Implement repository + route changes; provisional data appears only under an explicit `reviewStatus=PROVISIONAL` filter or clearly-labeled field, never silently mixed into previously reviewed-only responses. Coverage responses gain `provisionalCoverage` alongside (not replacing) reviewed coverage percentages.
- [ ] **Step 5:** OpenAPI + `contracts/README.md` updates; add public-boundary eval cases (no leakage of prompts, reviewer PII, raw rules; mislabel case must fail).
- [ ] **Step 6:** Full gate: `npm test && npm run eval:phase2 && npm run lint && npm run typecheck && npm run build && npm run data:check` + local pgTAP cycle → all green. Commit:

```bash
git add contracts/v1/provisional-claim.schema.json supabase/migrations/0022_provisional_public_views.sql supabase/tests/0022_provisional_public_views.sql lib/legal-corpus app/v1 app/openapi.json contracts/README.md evals tests
git commit -m "feat: expose provisional assurance data through public v1 APIs (migration 0022)"
```

---

### Task 6: EEA MiCA provisional baseline (priority)

**Files:**
- Create: `data/legal-corpus/baselines/eea-mica-checklist.json` (versioned jurisdiction checklist, small fixture — allowed in Git), operator runbook section in `docs/phase2-legal-corpus-operations.md`
- Modify: none in `lib/` (this task exercises Task 4's pipeline; code changes here indicate a Task 4 gap — go fix Task 4 instead)

**Interfaces:**
- Consumes: MiCA source version (checksum `c694819a…`, 149 provisions, `ALLOWED` rights) via `assurance:extract` / `assurance:crosscheck` / `assurance:release` CLIs.
- Produces: a published EEA provisional release fingerprint recorded in the runbook; provisional coverage visible on `/v1/coverage`.

- [ ] **Step 1:** Define the EEA checklist: enumerate the MiCA topics a stablecoin baseline must answer (issuance authorization, reserve requirements, redemption rights, EMT/ART classification, whitepaper, marketing, significant-token thresholds, transitional provisions), each item keyed to expected provision ranges. Commit the checklist before extraction so completeness is measured against a fixed target.
- [ ] **Step 2:** Dry-run the pipeline: `npm run assurance:extract -- --source <mica-version-id>` (no `--execute`); review the printed bundle, prompt/template versions, and cost estimate. This is an operator step — get the user's go-ahead before the live `--execute` run (live LLM, real cost, per repo policy do not run casually).
- [ ] **Step 3:** After user approval, execute extract → crosscheck → release with `--execute`. Every claim must trace to a provision locator and the pinned source version; blocked claims stay unpublished with recorded blockers.
- [ ] **Step 4:** Verify reproducibility: rerun crosscheck deterministic checks against the same fingerprints (`--replay`) and confirm identical checksums; record release fingerprint, claim counts, checklist coverage %, and open blockers in `docs/phase2-legal-corpus-operations.md`.
- [ ] **Step 5:** Production smoke (read-only): `/v1/coverage` shows EEA `provisionalCoverage` with `reviewStatus: "PROVISIONAL"`, reviewed coverage still `IN_PROGRESS`/`0%`. Commit docs + checklist.

---

### Task 7: Singapore PSA + Regulations provisional baseline

Same structure as Task 6, run after EEA completes.

- [ ] **Step 1:** Checklist `data/legal-corpus/baselines/sg-psa-checklist.json` covering PSA 2019 (pinned 2025-03-09, 148 sections, checksum `6644db51…`) and PS Regulations 2019 (2025 Rev Ed, 47 regulations incl. 18A–18J, checksum `1757d0a6…`): licensing classes, DPT/e-money boundary, stablecoin (SCS) framework items, reserve/redemption obligations, exemptions.
- [ ] **Step 2:** Respect SSO terms captured in the rights overlay: SSO consolidations are officially unofficial/non-authoritative — every SG claim must carry a limitation string noting the consolidation status and a counsel trigger for authoritative-text confirmation. Verify Task 4's deterministic checks emit these from the rights metadata; if not, fix Task 4.
- [ ] **Step 3:** Dry-run, user approval, execute, replay-verify, record fingerprints and coverage — identical procedure to Task 6 Steps 2–5.

---

### Task 8: Hong Kong truthful blocked state

**Files:**
- Modify: `lib/legal-corpus/baseline-readiness.ts` + `scripts/review/legal-baseline-readiness.ts` (surface the Cap. 656 blocker verbatim), coverage view fixture/eval cases

- [ ] **Step 1:** Add eval + unit cases asserting HK reports: `IN_PROGRESS`, `0%`, blocker `HK_CAP656_ARCHIVE_IDENTITY_MISMATCH` with the factual detail (archive entry named Cap. 656 embeds `/hk/cap155!en`, `docNumber 155`), Cap. 656A marked reference-only/`LINK_ONLY`, and **no** provisional extraction is permitted from a blocked or reference-only source (`runDeterministicChecks` must return `rights: "FAIL"` / blocker for Cap. 656A).
- [ ] **Step 2:** Run → confirm current behavior; implement any missing blocker surfacing; tests green.
- [ ] **Step 3:** Verify `/v1/coverage` for HK shows the blocker in `limitations`/blocker codes rather than omitting the jurisdiction. Commit.

---

### Task 9: Phase 2 exit-condition update + documentation sync

**Files:**
- Modify: `docs/superpowers/plans/2026-08-01-stablecoin-policy-master-development-plan.md` (§7 Phase 2B exit + §11 order marked done), `docs/superpowers/specs/2026-07-31-...-development-spec.md` (if Task 2's wording needs final numbers), `docs/phase2-legal-corpus-operations.md`, `CLAUDE.md` (new commands), local-only `docs/PROJECT_CONTEXT.md`

- [ ] **Step 1:** Record the accepted Phase 2 exit conditions verbatim in the master plan:
  1. EEA and Singapore publish reproducible provisional baselines (exact fingerprints recorded);
  2. every claim traces to a specific provision locator and pinned source version;
  3. machine data is never labeled `HUMAN_REVIEWED` (enforced by Quint invariant, view structure, and pgTAP);
  4. missing, conflicting, stale, or rights-restricted evidence automatically blocks deterministic conclusions;
  5. Hong Kong truthfully reports its incomplete/blocked state.
- [ ] **Step 2:** Update `docs/PROJECT_CONTEXT.md` locally (do not commit) with the new production state, fingerprints, and eval/pgTAP/Quint counts.
- [ ] **Step 3:** Final full gate: `npm test && npm run eval:phase0 && npm run eval:phase1 && npm run eval:phase2 && npm run spec:phase2 && npm run lint && npm run typecheck && npm run build && npm run data:check` + local pgTAP cycle. All green → commit docs; hand the branch stack to the user for PRs and production migration application (`0020`–`0022` follow the backup + linked dry-run procedure).

---

## Self-review notes

- Spec coverage: user order items 1–6 map to Tasks 1, 2, 3, 4, 5, 6–8; exit-condition update maps to Task 9 (wording written once in Task 2 Step 1, synced in Task 9).
- Type consistency: `MachineAssuranceLevel` string values (Task 3) match Quint state names (Task 2) and API `assuranceLevel` enum (Task 5); `runDeterministicChecks` (Task 4) is the single check implementation reused by Tasks 6–8.
- No live LLM appears in any test, eval, smoke, or acceptance step; live runs are operator-approved steps inside Tasks 6–7 only.
- Human-lane protection is triple-enforced: Quint invariant (Task 2), RPC restrictions (Task 3), view structure + pgTAP (Task 5).
