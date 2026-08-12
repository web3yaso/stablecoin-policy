# Citely main-site integration guide

Audience: the Citely main-site team (thin, domain-agnostic paid client).
Base URL: `https://policy.citely.info`. All wire contracts live in
`contracts/v1/`; the OpenAPI document is served at `/openapi.json`.

Citely owns authentication, billing, entitlements, and generic rendering.
This subsite owns all stablecoin domain logic. Citely must never infer,
transform, or editorialize domain data — render what the API returns,
including every assurance label.

## 1. What is live today

| Layer | Endpoint | Auth | Data |
|---|---|---|---|
| Policy feed | `GET /v1/policy-feed` | none | 77+ official policy updates, optional `playbookId` tags |
| Playbook catalog | `GET /v1/playbooks` | none | 2 launch playbooks with capability titles |
| Provisional coverage | `GET /v1/provisional/coverage` | none | EEA 47 claims, SG 98 claims |
| Claim lookup | `GET /v1/claims/{id}` | none | full assurance envelope per claim |
| Reviewed coverage | `GET /v1/coverage` | none | named-human lane; currently `IN_PROGRESS`/0% everywhere |
| **Package creation** | `POST /v1/playbook-packages` | `Authorization: Bearer <PLAYBOOK_API_KEY>` | PlaybookPackage + EvidenceBundle |

The two launch playbooks (launched together by product decision):

- `stablecoin-pre-listing` — 3 capabilities (`list-for-trading`,
  `custody-for-clients`, `transfer-services`); requires an `asset` with
  `networks` in the profile.
- `business-model-regulatory-boundary` — 8 capabilities (`issue-art`,
  `issue-emt`, `pay-emt-interest`, `casp-custody`, `casp-exchange`,
  `casp-transfer`, `operate-trading-platform`, `crypto-advice`); `asset`
  may be `null`.

## 2. Storefront (no key required)

Render the catalog directly:

```ts
const catalog = await fetch("https://policy.citely.info/v1/playbooks")
  .then((response) => response.json());
// catalog.playbooks[].{playbookId,name,version,description,capabilities[],assuranceNote}
```

Free-tier evidence pages can link `GET /v1/claims/{id}` and
`GET /v1/provisional/coverage` for acquisition. The policy feed contract is
documented in `contracts/policy-feed.md`; validate the whole response against
`contracts/v1/policy-feed.schema.json` and reject invalid payloads atomically,
falling back to the last known-good snapshot while showing that snapshot's
`generatedAt`.

## 3. Package creation (server-side only)

The bearer key is a service credential for the Citely backend. Never expose
it to browsers; never accept it from end users. Flow: user passes Citely's
entitlement check → Citely backend calls this API → Citely renders the
result for that user.

```ts
const response = await fetch(
  "https://policy.citely.info/v1/playbook-packages",
  {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.PLAYBOOK_API_KEY}`,
      "idempotency-key": crypto.randomUUID(),
    },
    body: JSON.stringify({
      playbookId: "stablecoin-pre-listing",
      profile: {
        operatorJurisdiction: "SG",
        targetJurisdiction: "EEA",
        activities: ["list-for-trading", "custody-for-clients"],
        asset: { symbol: "USDC", networks: ["base", "ethereum"] },
      },
    }),
  },
);
// 201 first completion; 200 exact retry replay
// -> { package, evidenceBundle } (schemaVersion 1.1.0)
```

Validate every successful `200` or `201` body against
`contracts/v1/playbook-package-response.schema.json`; reject on mismatch.
`Idempotency-Key` is mandatory and must be an opaque 8–128 character token.
Reuse the same key only for the byte-equivalent logical request. Stablecoin
Policy stores only its SHA-256. The first completed call returns `201`; an
exact retry returns the original immutable artifact with `200` and
`Idempotency-Replayed: true`. Same key plus a different request, or a duplicate
still holding its short execution lease, returns `409` (the latter includes
`Retry-After`). Do not charge or create a second Citely run on any replay.

Statuses: `400` invalid profile/JSON/idempotency key, `401` bad key, `404`
unknown playbook, `409` idempotency conflict/in-progress, `503` core runtime,
claim evidence, or immutable persistence unavailable. Responses are always
`Cache-Control: no-store`.

`evidenceBundle.retrieval` always exists. `SUCCESS` includes only
presentation-safe ranked citations and exact index/corpus pins. Typed degraded
states (`INSUFFICIENT_EVIDENCE`, `CONFLICTING_EVIDENCE`,
`UNAUTHORIZED_EVIDENCE`, `STALE_INDEX`, or `RETRIEVAL_UNAVAILABLE`) may have
no items and must be rendered with their `limitations`. A retrieval outage does
not turn package creation into `503` and cannot change deterministic
conclusions, reason codes, actions, or claim IDs.

Replay determinism is scoped to the idempotency key: an exact retry returns the
same stored `packageId`, `evaluatedAt`, and `integritySha256`. A new evaluation,
even with the same `playbookId`, profile, and version pins, may produce a new
identity because `evaluatedAt` is integrity-bound. Citely may cache a package
keyed by `packageId` on its side (it owns customer-data retention policy).

Historical replay is server-side and authenticated:

```ts
const artifact = await fetch(
  `https://policy.citely.info/v1/playbook-packages/${encodeURIComponent(packageId)}`,
  { headers: { authorization: `Bearer ${process.env.PLAYBOOK_API_KEY}` } },
).then((response) => response.json());
```

The GET response is the exact checksum-verified stored artifact and uses the
same strict response schema. A `404` means the package is unknown; a `503`
means its metadata or private Storage artifact cannot be verified. Never fall
back to reconstructing a paid package client-side.

## 4. Rendering requirements (non-negotiable)

These come from the product's legal posture; a renderer that drops them is a
launch blocker.

1. **Assurance is always visible.** Every package carries
   `assurance.reviewStatus` (currently always `PROVISIONAL`),
   `assurance.limitations[]`, and `assurance.counselTriggers[]`. Render the
   review status as a prominent badge and the limitations verbatim near the
   conclusions. Machine output must never be presented as human-reviewed
   legal advice.
2. **Conclusions are capability-level.** Render one row per
   `conclusions[]` entry with its `conclusion` enum
   (`PERMITTED | CONDITIONAL | UNDETERMINED | COUNSEL_REVIEW | PROHIBITED`),
   `reasonCodes`, and `actions`. Never aggregate them into a single
   compliant/non-compliant label.
3. **Citations are first-class.** Each conclusion lists
   `evidenceClaimIds`; the `evidenceBundle.claims[]` entries carry the full
   propositions and exact provision locators (e.g. `Article 36`,
   `Section 5`). Link each claim to
   `https://policy.citely.info/v1/claims/{claimId}` or render the bundle
   inline. Singapore claims include an SSO unofficial-consolidation
   limitation — display it.
4. **Version pins are shown.** `versions` identifies the exact corpus
   release, retrieval index/corpus, dossier, rules, template, and schema the
   package was built from; show at least `corpusReleaseId`,
   `retrievalIndexReleaseId` when non-null, and `evaluatedAt` so a customer can
   see what the answer was based on and when.
5. **No inference.** `playbookId` tags in the policy feed, reason codes,
   and conclusions come only from this API. Unknown enum values mean the
   contract moved: reject the response, do not guess.

## 5. Operational notes

- Public endpoints are CDN-cached up to 300 s (`stale-while-revalidate`);
  data freshness is visible via each payload's own timestamps, never the
  response time.
- The provisional corpus grows by release; coverage counts aggregate
  distinct claims per jurisdiction. EEA and SG are live; Hong Kong
  deliberately reports blocked/incomplete until its source-identity issue is
  resolved.
- The bearer-key scheme is an explicit MVP interim. The planned upgrade is
  signed short-lived service tokens with entitlement assertions; the
  request/response bodies will not change.
- Incidents: a `503` from package creation means evidence, runtime, or immutable
  persistence is unavailable — surface a retry-later state; never render a
  partial package.
- Complete package JSON lives in the private `policy-playbooks` Storage bucket;
  PostgreSQL contains only fingerprints, version/query metadata, checksum, and
  object reference. Neither location is a public browser API.

## 6. Contract files

- `contracts/v1/playbook-package-response.schema.json` — POST response
- `contracts/v1/policy-feed.schema.json` + `contracts/policy-feed.md`
- `contracts/v1/provisional-claim.schema.json` — claim lookup
- `contracts/v1/provisional-coverage-response.schema.json`
- `/openapi.json` — full API document (playbooks tag)
