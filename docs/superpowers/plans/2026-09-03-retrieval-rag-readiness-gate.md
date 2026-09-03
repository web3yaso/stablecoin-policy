# Phase 6 Retrieval and RAG Readiness Gate — Implementation Plan

Status: implemented and locally verified on
`codex/retrieval-rag-readiness-gate`; production activation is explicitly out
of scope.

## Goal

Turn the existing Evidence RAG search, negative-path behavior, and Phase 3
quality thresholds into one strict, versioned, per-scope eval artifact. That
artifact is the only typed source for the `RETRIEVAL_AND_RAG` readiness gate.

## Formal-spec impact

No Quint transition, invariant, or witness changes are required. The
implementation must preserve the existing `evidenceRag.qnt` guarantees:

- retrieval consumes one pinned, authorized index and corpus release;
- successful retrieval returns citation-complete, grounded evidence;
- human-reviewed requests cannot consume provisional evidence;
- stale, conflicting, unavailable, or insufficient evidence produces no
  narrative;
- RAG cannot change deterministic playbook decisions; and
- historical results remain replayable against their pinned release.

The new artifact measures the implemented retrieval behavior against those
existing guarantees. It must not weaken or rewrite the formal model to make an
implementation pass.

## Accepted boundary

- Cover the exact EEA generic business-model scope and EEA USDC Pre-listing
  scope independently.
- Use a versioned, sanitized JSONL dataset with strict case validation.
- Exercise real hybrid retrieval against the deterministic Phase 3 fixture.
- Include successful retrieval, topic filtering, provisional/human-review
  authorization isolation, stale-index, conflicting-evidence, and repository
  outage paths for each scope.
- Require pinned index/corpus versions, exact source-backed citations, and
  rights-safe results.
- Require every unsafe or degraded result to return zero hits and no narrative.
- Emit hashes, booleans, typed statuses, and aggregate metrics only. Do not
  copy queries, excerpts, propositions, canonical URLs, source text, prompts,
  customer data, or credentials into the report.
- A passing report never activates self-service, never upgrades evidence to
  human-reviewed, and does not replace signed production smoke.

## Metrics and gate

Each scope must contain at least eight cases, including at least four expected
successful retrievals, and meet:

- Recall@10 greater than or equal to `0.95`;
- MRR@10 greater than or equal to `0.90`;
- citation precision exactly `1.0`;
- structured-filter accuracy exactly `1.0`;
- version-isolation rate exactly `1.0`;
- repeated pinned-run exact-match rate exactly `1.0`;
- safe-degradation rate exactly `1.0`;
- non-narrative safety rate exactly `1.0`; and
- zero unauthorized, rights-blocked, or prompt-injected authority use.

Malformed or duplicate cases, missing expected provisions, cross-scope result
borrowing, ranking drift below threshold, citation drift, filter leakage,
release leakage, unsafe degraded output, or narrative output fails the exact
scope.

## Implementation sequence

1. Add strict case/report schemas and the scope-bound sanitized dataset.
2. Add a pure evaluator whose report contains no query or evidence content.
3. Add a fixture executor that drives the real search service and all modeled
   negative paths.
4. Add the exact-scope readiness adapter, runner, package script, and CI gate.
5. Add positive, failure-injection, privacy, determinism, schema, and adapter
   tests.
6. Update canonical development documents and the local context index.
7. Run the unchanged Evidence RAG Quint model, the new eval, and the full
   repository quality suite.

## Verification

```bash
npm run spec:rag
npm run eval:phase5:retrieval-rag
node --import tsx --test tests/retrieval-rag-eval.test.ts tests/scope-readiness.test.ts tests/evidence-rag.test.ts
npm run lint
npm run typecheck
npm test
npm run build
npm run data:check
```

Local verification passes the unchanged 19-scenario Evidence RAG Quint test
model, all 11 sampled invariants and 13 witnesses, the 16-case per-scope eval
at `1.0` for every rate and zero unauthorized authority use, focused failure
injection and schema tests, 302 repository tests, lint, typecheck, production
build, and repository data policy.
