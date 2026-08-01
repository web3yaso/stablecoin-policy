# Phase 2 regulatory-change publication model

This companion Quint specification models the monitored-change path introduced
by migration `0019`:

`Verified version diff -> Candidate event -> Pending claim impact -> Human reviews -> Published event`

Automated analysis may create only a `CANDIDATE` event and `MAY_AFFECT / PENDING`
impact suggestions. Event review and every impact disposition require named
humans. Publication requires a current deterministic diff fingerprint, a
current approved event review, no pending impacts, and at least one reviewed
impact with its own current approval.

## Safety properties

| Requirement | Quint property | Database boundary |
| --- | --- | --- |
| Published events retain verified same-document versions and both human review layers | `publishedEventHasVerifiedVersionsAndHumanReview` | `publish_regulatory_event` |
| A reviewed impact always has named-human audit state | `reviewedImpactHasNamedHumanReview` | `review_regulatory_event_impact` |
| Change analysis cannot mutate claims or coverage | `changePipelineCannotMutateClaimOrCoverage` | migration `0019` grants and RPC bodies |
| Service role cannot directly publish an event | `serviceRoleHasNoDirectEventPublication` | migration `0019` table revokes |

The `candidateCreatedWitness` and `eventPublishedWitness` demonstrate that the
safe candidate and complete human-reviewed publication paths remain reachable.
Eight scenario tests exercise the happy path, automated-review rejection,
dismissed impact, stale manifest, denied direct publication, and denied domain
mutation.

Run this model together with the legal-corpus publication model using:

```bash
npm run spec:phase2
```

The run is bounded simulation, not exhaustive proof. The model contains no real
legal proposition, reviewer identity, private decision rule, or playbook action.
