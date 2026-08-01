# Phase 2 legal-corpus publication model

This executable Quint specification models the reviewed-evidence publication
chain implemented by Supabase migrations `0010` through `0014`:

`SourceVersion -> LegalClaim -> CorpusRelease -> CoverageScope`

It is a design and regression model, not legal analysis and not a substitute
for the named-human reviews required by the production workflow.

## Scope and assumptions

- PostgreSQL is shared state; there is no message-passing protocol, so this is
  plain Quint rather than Choreo.
- Each modeled action is one atomic RPC transaction. A false guard represents a
  rejected RPC and has no observable partial write.
- Participants are the service role, automated callers, and named human
  reviewers. Reviewer credentials and identity storage are abstracted to the
  `humanReviewer` input and the resulting immutable-review-record flag.
- Time is represented by manifest freshness, source freshness, `as_of`, and
  knowledge-cutoff predicates. Wall-clock scheduling and monitoring are outside
  this model.
- The concrete instance starts with sanitized evidence prerequisites set to
  true so every valid lifecycle transition is reachable. No real legal claim,
  checklist, or approval is represented.

The model does **not** cover source parsing, object-storage transport, customer
data, Evidence RAG, private `DecisionRule` definitions, `PlaybookAction`
generation, notification delivery, or the legal substance of a baseline.

## Requirement coverage

| Requirement | Model operation/property | Canonical implementation |
| --- | --- | --- |
| Verification requires reviewed rights, provisions, known permissions, a current fingerprint, and a named human | `verifySource`; `verifiedSourceHasHumanReviewedEvidence` | migration `0010` |
| Claim approval requires verified direct evidence, no conflict, a current manifest, and a named human | `submitClaimForReview`, `reviewClaim`; `reviewedClaimHasVerifiedDirectSupport` | migration `0011` |
| A release must bind reviewed membership and remain current through publication | `createRelease`, `submitReleaseForReview`, `reviewRelease`, `publishRelease`; `publishedReleaseHasCurrentHumanApproval` | migration `0012` |
| Coverage requires a published release, complete checklist, fresh sources, a current manifest, and a named human | `reviewCoverage`; `reviewedCoverageHasCompleteReviewedBaseline` | migration `0013` |
| Service role cannot directly mutate coverage | `serviceRoleDirectCoverageMutation`; `serviceRoleHasNoDirectCoverageWrite` | migration `0014` |
| Rejected reviews leave no partial approval record | stale-fingerprint and automated-reviewer tests | migrations `0010`–`0013` atomic RPCs |

## Running it

```bash
npm run spec:phase2
npm run db:phase2:start
npm run test:db:phase2
npm run db:phase2:stop
```

The PostgreSQL tests apply every migration to an isolated local Supabase
database, run 55 pgTAP assertions inside rolled-back transactions, and map
the executable model to the real RPCs and grants. Its fixtures are sanitized;
they never represent production legal conclusions or named production users.

The simulation is bounded random sampling, not exhaustive model checking. A
clean run means no counterexample was found in the sampled traces; it is not a
proof. `quint verify` is intentionally not part of this workflow.

Quint is invoked as the pinned, isolated CLI version `0.32.0` rather than added
to the application dependency tree. At the time this model was added, Quint's
CLI depended on an `adm-zip` version with a crafted-ZIP memory-exhaustion
advisory. This repository accepts the isolated CI use only for official Quint
release assets. Re-evaluate and upgrade the pin when Quint removes that
transitive dependency.

## Maintenance triggers

Update this model and its requirement map whenever a migration changes any
review state, draft-import boundary, publication gate, manifest/freshness rule,
atomicity boundary, or service-role grant in migrations `0010` through `0016`
or their successors.
