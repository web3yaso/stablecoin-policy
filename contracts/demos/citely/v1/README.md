# Citely Stablecoin static demo

This directory contains a fixed, presentation-ready Stablecoin Pre-listing
snapshot for the Citely main-site demo. It is separate from
`contracts/fixtures/`: consumer fixtures use sanitized evidence to test the
wire contract, while this snapshot pins real public provisional claims from
`policy.citely.info` and the committed USDC dossier.

The response uses the exact production `PlaybookPackage` schema. It truthfully
shows `RETRIEVAL_UNAVAILABLE`, is not persisted to the production package
store, and must be presented as a fixed provisional demonstration rather than
live legal advice. Its manifest records the snapshot time, public claim URLs,
and required limitations.

`stablecoin-merchant-payment.fixture.json` is one fixed, response-only fixture
for a platform that controls USDC on behalf of EEA merchants and settles the
stablecoin to those merchants. It reuses the production package envelope, real
public provisional MiCA claims, and the committed USDC dossier, but its
merchant-payment rule is fixture-only: it is not registered in the live API.
The fixture covers the CASP authorization and client-asset safeguarding slice;
its actions explicitly require separate review of the own-account merchant
boundary, AML/CFT, sanctions, KYB, tax, consumer, refund, freeze, and failed-
settlement questions.

Refresh only after inspecting the public claims:

```bash
npm run contracts:citely:demo:write
node --import tsx --test tests/citely-demo-snapshot.test.ts
```
