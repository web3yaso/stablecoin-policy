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
| **Package creation** | `POST /v1/playbook-packages` | short-lived signed Citely service JWT | PlaybookPackage + EvidenceBundle |

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

## 3. Signed service authentication (server-side only)

Citely signs a compact JWT with an Ed25519 private key that never leaves the
main-site backend. Stablecoin Policy stores only the corresponding public keys,
selected by JWT `kid`, so rotation can overlap without sharing a signing
secret. Never expose the token or private key to browsers; never accept either
from end users.

The strict payload contract is
`contracts/v1/citely-service-token-payload.schema.json`. Required identity is
`iss=https://www.citely.info`, `aud=stablecoin-policy`, and
`sub=citely:playbook-service`; `iat`, `nbf`, `exp`, and an opaque unique `jti`
are mandatory. TTL must be at most 300 seconds. The protected header contains
only `alg=EdDSA`, `typ=JWT`, and the configured `kid`.

The token also carries exactly one entitlement:

- package creation: `scope=playbook:execute` plus exact `playbookId`;
- package replay: `scope=playbook:read` plus exact `packageId`;
- direct RAG search: `scope=evidence:search` with no package/playbook target.

An invalid signature or service identity returns `401`; a valid token with the
wrong scope/target returns `403`. Stablecoin Policy does not receive account,
email, plan, payment, or team data. Flow: user passes Citely's commercial
entitlement check → Citely signs the minimal domain entitlement → subsite
verifies identity and target → Citely renders the result.

## 4. Package creation

```ts
const response = await fetch(
  "https://policy.citely.info/v1/playbook-packages",
  {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${signedServiceToken}`,
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
Validate the request locally against
`contracts/v1/playbook-package-create-request.schema.json` before signing the
entitlement token. Unknown request properties, duplicate activities/networks,
and empty identifiers are invalid rather than silently ignored.
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

Historical replay uses a separately signed package-targeted token:

```ts
const artifact = await fetch(
  `https://policy.citely.info/v1/playbook-packages/${encodeURIComponent(packageId)}`,
  { headers: { authorization: `Bearer ${packageReadToken}` } },
).then((response) => response.json());
```

The GET response is the exact checksum-verified stored artifact and uses the
same strict response schema. A `404` means the package is unknown; a `503`
means its metadata or private Storage artifact cannot be verified. Never fall
back to reconstructing a paid package client-side.

## 5. Rendering requirements (non-negotiable)

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

## 6. Operational notes

- Public endpoints are CDN-cached up to 300 s (`stale-while-revalidate`);
  data freshness is visible via each payload's own timestamps, never the
  response time.
- The provisional corpus grows by release; coverage counts aggregate
  distinct claims per jurisdiction. EEA and SG are live; Hong Kong
  deliberately reports blocked/incomplete until its source-identity issue is
  resolved.
- During rollout only, `CITELY_REQUIRE_SIGNED_SERVICE_TOKEN=0` accepts both
  signed tokens and the legacy shared key. After signed POST/GET/search smoke,
  set it to `1`; the legacy key is then rejected and may be removed.
- Incidents: a `503` from package creation means evidence, runtime, or immutable
  persistence is unavailable — surface a retry-later state; never render a
  partial package.
- Complete package JSON lives in the private `policy-playbooks` Storage bucket;
  PostgreSQL contains only fingerprints, version/query metadata, checksum, and
  object reference. Neither location is a public browser API.

## 7. Contract files

- `contracts/v1/playbook-package-create-request.schema.json` — POST request
- `contracts/v1/playbook-package-response.schema.json` — POST response
- `contracts/v1/citely-service-token-payload.schema.json` — signed service JWT
- `contracts/v1/policy-feed.schema.json` + `contracts/policy-feed.md`
- `contracts/v1/provisional-claim.schema.json` — claim lookup
- `contracts/v1/provisional-coverage-response.schema.json`
- `/openapi.json` — full API document (playbooks tag)

Executable consumer examples are in `contracts/fixtures/citely/v1/`. They
cover both launch playbooks and demonstrate both successful retrieval and a
typed retrieval outage. Subsite CI regenerates the same artifacts in memory,
validates both schemas and package integrity, resolves every conclusion claim,
and projects them through a reference consumer that never branches on a
stablecoin playbook, capability, or reason-code value.

Once the subsite migration and public-key configuration are deployed, the
Citely operator can run `npm run smoke:citely-playbook` from its secret
environment to exercise the signed create/retry/conflict/auth/replay path. The
runner reads the signing private key only from the process environment, emits
no tokens or artifact body, and creates one real immutable package. See
`docs/phase5-playbook-package-operations.md` before running it.
