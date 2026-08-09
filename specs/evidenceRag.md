# Evidence RAG — Phase 3 index and retrieval model

This executable Quint specification models the Evidence RAG safety boundary
defined by the formal development spec and master plan. Run it with:

```bash
npm run spec:rag
```

## Scope and assumptions

- PostgreSQL is shared state; there is no message-passing protocol, so this is
  plain Quint rather than Choreo.
- Index build, activation, rollback, and one retrieval response are separate
  atomic database/application operations.
- Two index IDs are enough to exercise activation, replacement, rollback, and
  historical replay.
- `Provisional` and `HumanReviewed` model caller-visible assurance tiers.
- Embedding generation, HTTP retries, SQL syntax, ranking arithmetic, and
  wall-clock scheduling are implementation details covered outside the model.
- A fixed integer stands in for the deterministic Playbook decision
  fingerprint; every RAG transition must preserve it.

## Requirement coverage

| Requirement | Model operation/property |
| --- | --- |
| Only complete, rights-authorized, version-isolated, pinned indexes activate | `activationEligible`; `activeAndRetiredIndexesAreStructurallySafe` |
| Index releases can be activated, replaced, and rolled back | `activateIndexWith`, `rollbackIndex`; activation/rollback scenarios |
| Retrieval pins corpus and index releases and returns complete citations | `searchSuccessWith`; `successfulRetrievalPinsAuthorizedEvidence` |
| Human-reviewed queries cannot consume provisional evidence | `tierAuthorized`; `humanReviewedQueryCannotUseProvisionalIndex` |
| Low-confidence, conflicting, unauthorized, stale, and unavailable retrieval is explicit and non-narrative | typed outcome actions; `unsafeOutcomesProduceNoNarrative` |
| Material narrative is allowed only from grounded successful retrieval | `narrativeOnlyFromGroundedSuccessfulRetrieval` |
| Historical runs replay against their original immutable index | `replayPinnedRun`; `historicalReplayIsStable` |
| RAG cannot change deterministic decisions | `ragCannotChangeDeterministicDecision` |

## Deliberately not modeled

- Recall@10, MRR@10, lexical/vector score fusion, and deduplication arithmetic;
  these require a concrete gold dataset and run in the Phase 3 eval suite.
- Sentence-level explanation faithfulness and prompt-injection resistance;
  these are evaluated against returned evidence and the synthesis adapter.
- Authentication, rate limits, privacy, and HTTP response serialization.
- Legal substance, claim approval, and corpus publication. Existing
  `legalCorpusPublication.qnt` and `machineAssurance.qnt` remain authoritative
  for those separate workflows.

## Maintenance trigger

Update and re-run this model before changing index activation/rollback,
assurance-tier visibility, retrieval outcome semantics, historical replay, or
the rule that RAG cannot modify deterministic conclusions and reason codes.
