# Phase 5 Citely service-auth operations

## Current checkpoint

Branch `codex/phase5-citely-service-auth` is locally verified but not deployed.
It passes 202 Node tests, all Phase 0–3 evals, the Phase 2/RAG/Playbook Quint
gates, dependency audit with zero known vulnerabilities, and the Next.js
production build. Production configuration and signed-token smoke remain
explicit post-merge rollout work.

## Boundary

Citely owns customer identity, billing, team access, and commercial
entitlements. Stablecoin Policy receives only a five-minute Ed25519-signed JWT
that proves the Citely backend identity and one narrow domain entitlement. It
never receives account, plan, payment, email, or team fields.

The Stablecoin environment stores public verification keys only:

- `CITELY_SERVICE_PUBLIC_KEYS_JSON`: JSON map of opaque `kid` to Ed25519 SPKI
  public PEM, at most ten keys;
- `CITELY_REQUIRE_SIGNED_SERVICE_TOKEN`: `0` during dual-auth smoke, then `1`.

Issuer (`https://www.citely.info`), audience (`stablecoin-policy`), and subject
(`citely:playbook-service`) are compiled into the verifier and v1 contract, not
runtime-configurable, so an environment mistake cannot widen token identity.

The Citely main site holds the private key and generic signer. That signer can
be reused for AI Policy and future Web3 Policy by changing only audience,
domain, scope, and target; it contains no domain decision logic.

## Required claims

Protected header: exactly `alg=EdDSA`, `typ=JWT`, and configured `kid`.

Payload: exactly `iss`, `aud`, `sub`, integer `iat`/`nbf`/`exp`, opaque `jti`,
and `entitlement`. Runtime requires `exp > iat`, a maximum 300-second TTL, and
30 seconds clock tolerance. Entitlement must be one of:

- `playbook:execute` + exact `playbookId`;
- `playbook:read` + exact `packageId`;
- `evidence:search` with no target.

JWTs are authorization assertions, not package idempotency keys. Citely must
reuse `Idempotency-Key` for an exact POST retry and may mint a fresh short-lived
JWT for that retry.

## Rollout

1. Generate the Ed25519 key pair inside Citely's secret-management boundary.
2. Configure the Stablecoin Vercel project with the public-key map; keep
   `CITELY_REQUIRE_SIGNED_SERVICE_TOKEN=0`.
3. Deploy and smoke signed package POST (`201`), exact retry (`200`), exact
   package GET (`200`), evidence search, wrong target (`403`), wrong audience
   (`401`), and expired token (`401`). Confirm the legacy key still works.
4. Set `CITELY_REQUIRE_SIGNED_SERVICE_TOKEN=1` and redeploy.
5. Repeat signed smoke and confirm legacy keys return `401`.
6. Remove `PLAYBOOK_API_KEY` and `EVIDENCE_API_KEY` after the rollback window.

## Rotation

1. Citely creates a new key with a new `kid`.
2. Add the new public key alongside the current key and deploy Stablecoin.
3. Start signing with the new `kid`; smoke all scopes.
4. Wait longer than maximum token TTL plus clock tolerance (330 seconds).
5. Remove the old public key and deploy again.

Never reuse a `kid` for different key bytes.

## Rollback

Before legacy removal, set `CITELY_REQUIRE_SIGNED_SERVICE_TOKEN=0` and restore
the last known-good legacy secret while retaining public keys. After legacy
secrets are removed, rollback should restore a known-good public-key set and
Citely signing key; do not weaken target authorization or extend token TTL.
