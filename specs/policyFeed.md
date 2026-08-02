# policyFeed.qnt — /v1/policy-feed projection model

Executable Quint model of the `/v1/policy-feed` atomic build semantics.
Requirements source: `docs/superpowers/plans/2026-08-01-citely-policy-feed.md`.

Run:

```bash
npm run spec:policy-feed
```

## What it covers

Single actor (the route handler) plus an environment (dataset store, abstract
clock); coordination is through shared state, so this is plain Quint without
Choreo. `serve` is atomic: the handler observes the dataset and clock and
produces the whole response in one transition, recorded in `lastServe` so
invariants can relate every response to the exact state it was computed from.

| Plan requirement | Model element | Checked by |
|---|---|---|
| §3 `generatedAt` is the release's, never request time | `buildResponse` copies `r.generatedAt` | `invGeneratedAtFromRelease`, `republishRefreshesGeneratedAtTest` |
| §3/§6 stale serve keeps old generation time visible | `stale` flag + original timestamp | `invStaleServeKeepsOldTime`, `staleServeKeepsGeneratedAtTest` |
| §4 official-source-only inclusion | `officialMembers` filter | `invOnlyOfficialWellFormed`, `thirdPartyExcludedTest` |
| §4 ordering: date desc, jurisdiction asc, sourceUrl asc | `ORDERED_OFFICIAL_IDS` + independent `sortKeyBefore` check | `invServedOrdering`, `orderingDeterministicTest` |
| §5 playbook only from explicit map; unknown playbook fails build | `PLAYBOOK_MAP`, `mappingInvalid` | `invPlaybookFromMapOnly`, `invalidPlaybookMappingPoisonsFeedTest` |
| §6 any malformed eligible item ⇒ whole 503, no partial feed | `buildPoisoned` | `invAtomicNoPartialFeed`, `malformedOfficialPoisonsFeedTest` |
| §6 missing dataset / unsupported schema / expired cache ⇒ 503 | `buildResponse` guards | `invFailClosed`, `serveWithoutDatasetIs503Test`, `unsupportedSchemaIs503Test`, `expiredStaleIs503Test` |
| §6 stale flag reflects release age exactly | `isStale` | `invStaleFlagCorrect` |

Witness note: `servedStaleWitness` is rare under uniform random walk (~1.6% at
`--max-steps 40 --max-samples 3000`) because any republish resets freshness;
it is reachable, and `staleServeKeepsGeneratedAtTest` pins the path
deterministically.

## Abstractions (deliberate)

- Dates, jurisdictions, and URLs are ints so ordering is mechanically checkable.
- All per-item validity rules (date format, empty jurisdiction, summary
  normalization result, HTTPS) collapse into one `wellFormed` flag — they share
  one behavioral consequence: the whole build fails.
- Time is a tick counter; `FRESH_TTL`/`MAX_STALE` are small ints standing in
  for the resilient-cache fresh/max-stale windows.

## What it does NOT cover (unit tests own these)

- HTTP mechanics: ETag computation, `304`/`If-None-Match`, CORS, exact
  `Cache-Control`/`Warning`/`X-*` header values.
- First-sentence summary normalization (including abbreviations like `U.S.`).
- JSON Schema validation mechanics and `schemaVersion: "1.0.0"` literal.
- Concrete field formats (`YYYY-MM-DD`, HTTPS URL syntax).
- Privacy: absence of reviewer/customer/DecisionRule data in responses.

## Derived unit-test checklist for `tests/policy-feed.test.ts`

From the model (each maps to a Quint test or invariant):

1. missing active dataset → 503, `Cache-Control: no-store`;
2. happy path: `schemaVersion` exactly `1.0.0`, `generatedAt` from release
   metadata, flattening `entities[jurisdiction].news[]`, `url → sourceUrl`;
3. non-official items excluded, malformed non-official items ignored;
4. one malformed eligible item → whole 503, zero items leaked;
5. mapped `playbookId` emitted, unmapped omitted;
6. mapping to unknown playbook ID → build failure (503), not silent drop;
7. unsupported source dataset schema → 503;
8. stale snapshot served with original `generatedAt`, `Warning: 110`,
   `X-Data-Stale: true`;
9. expired/absent cache → 503;
10. ordering date desc → jurisdiction asc → sourceUrl asc, stable under
    input permutation;
11. republished release refreshes `generatedAt`;
12. zero eligible items → valid empty feed, not an error.

From the not-covered list (model has no opinion; plan §9 requires):

13. deterministic first-sentence selection incl. `U.S.`-style abbreviations,
    whitespace normalization, no line breaks;
14. malformed dates, empty jurisdiction/summary, non-HTTPS URL each rejected;
15. whole-response validation against `contracts/v1/policy-feed.schema.json`;
    unknown top-level/item fields rejected;
16. ETag from complete projected response; matching `If-None-Match` → `304`;
17. headers: `X-Policy-Feed-Schema-Version`, `X-Data-Generated-At`,
    `X-Data-Cache-State`, success `Cache-Control` with
    `stale-while-revalidate`;
18. no private reviewer/customer/`DecisionRule`/`PlaybookAction` data in any
    response fixture.

## When to update

Update and re-run this spec **before** changing `lib/policy-feed/build.ts` or
the route's atomic failure/stale semantics. The spec is ground truth for build
behavior; if implementation and spec disagree, stop and fix the spec first only
if the requirement itself changed.
