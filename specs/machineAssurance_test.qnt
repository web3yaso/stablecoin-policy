/**
 * Deterministic scenario tests for the machine-assurance lane model.
 *
 * Each test pins a transition or fail-closed rule from spec section 8.4; the
 * Phase 2B implementation (migration 0020+) must preserve exactly these
 * behaviors in its RPC guards.
 */
module machineAssurance_test {
  import machineAssurance.* from "./machineAssurance"

  // happy path: observed -> validated -> extracted -> cross-checked -> published
  run happyPathToProvisionalPublishedTest =
    initFrom(cleanStart)
      .then(validateSource)
      .then(extractClaims)
      .then(crossCheck)
      .then(publishProvisional)
      .expect(and {
        state.machineState == ProvisionalPublished,
        state.publishedChecksOk,
        state.assuranceRecordWritten,
        not(state.humanReviewed),
      })

  // a failed identity/checksum check blocks validation
  run validateBlockedByBadChecksumTest =
    initFrom({ ...cleanStart, identityChecksumOk: false })
      .then(validateSource.fail())

  // storage-rights failure blocks validation
  run validateBlockedByRightsTest =
    initFrom({ ...cleanStart, rightsAllowStorage: false })
      .then(validateSource.fail())

  // a missing citation locator blocks extraction
  run extractRequiresLocatorTest =
    initFrom({ ...cleanStart, citationLocatorOk: false })
      .then(validateSource)
      .then(extractClaims.fail())

  // an unresolved contradiction blocks the cross-check gate
  run crossCheckBlockedByContradictionTest =
    initFrom(cleanStart)
      .then(validateSource)
      .then(extractClaims)
      .then(contradictionFound)
      .then(crossCheck.fail())

  // evidence that degrades after cross-check cannot be published: stale source
  run publishBlockedByStaleSourceTest =
    initFrom(cleanStart)
      .then(validateSource)
      .then(extractClaims)
      .then(crossCheck)
      .then(sourceGoesStale)
      .then(publishProvisional.fail())

  // evidence that degrades after cross-check cannot be published: contradiction
  run publishBlockedByContradictionTest =
    initFrom(cleanStart)
      .then(validateSource)
      .then(extractClaims)
      .then(crossCheck)
      .then(contradictionFound)
      .then(publishProvisional.fail())

  // evidence that degrades after cross-check cannot be published: rights
  run publishBlockedByRightsRevocationTest =
    initFrom(cleanStart)
      .then(validateSource)
      .then(extractClaims)
      .then(crossCheck)
      .then(rightsRevoked)
      .then(publishProvisional.fail())

  // publication requires the AI_CROSS_CHECKED state, not just green checks
  run publishRequiresCrossCheckStateTest =
    initFrom(cleanStart)
      .then(validateSource)
      .then(extractClaims)
      .then(publishProvisional.fail())

  // publication requires the immutable assurance record
  run publishRequiresAssuranceRecordTest =
    initFrom({ ...cleanStart,
      machineState: AiCrossChecked,
      assuranceRecordWritten: false })
      .then(publishProvisional.fail())

  // human review upgrades published provisional evidence without moving the ladder
  run humanUpgradeFromProvisionalTest =
    initFrom(cleanStart)
      .then(validateSource)
      .then(extractClaims)
      .then(crossCheck)
      .then(publishProvisional)
      .then(humanReviewAction(true))
      .expect(and {
        state.machineState == ProvisionalPublished,
        state.humanReviewed,
        state.humanReviewerNamed,
        state.humanReviewActionTaken,
      })

  // human review is independent of the machine ladder: it can apply to a
  // freshly observed source
  run humanReviewOnObservedSourceTest =
    initFrom(cleanStart)
      .then(humanReviewAction(true))
      .expect(and {
        state.machineState == SourceObserved,
        state.humanReviewed,
      })

  // an automated (unnamed) reviewer can never produce human review
  run automatedReviewerRejectedTest =
    initFrom(cleanStart)
      .then(validateSource)
      .then(extractClaims)
      .then(crossCheck)
      .then(publishProvisional)
      .then(humanReviewAction(false).fail())
}
