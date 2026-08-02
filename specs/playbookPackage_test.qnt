/**
 * Deterministic scenario tests for the PlaybookPackage lifecycle model.
 * Each pins a rule the Phase 5 runtime implementation must preserve.
 */
module playbookPackage_test {
  import playbookPackage.* from "./playbookPackage"

  // happy path: full support seals a provisional PERMITTED package
  run happyPathSealsPermittedTest =
    initFrom(initialPackage)
      .then(confirmInputs)
      .then(evaluate)
      .then(assembleEvidence)
      .then(seal)
      .expect(and {
        state.sealed,
        state.conclusion == Permitted,
        state.versionsPinned,
        state.packageProvisional,
      })

  // missing inputs can never produce certainty
  run missingInputsYieldUndeterminedTest =
    initFrom({ ...initialPackage, inputProvided: false })
      .then(confirmInputs)
      .then(evaluate)
      .expect(state.conclusion == Undetermined)

  // conflicting evidence escalates to counsel review, not a confident answer
  run conflictYieldsCounselReviewTest =
    initFrom({ ...initialPackage, evidenceConflicting: true })
      .then(confirmInputs)
      .then(evaluate)
      .then(assembleEvidence)
      .then(seal)
      .expect(and { state.sealed, state.conclusion == CounselReview })

  // missing direct evidence yields UNDETERMINED
  run missingEvidenceYieldsUndeterminedTest =
    initFrom({ ...initialPackage, hasDirectEvidence: false })
      .then(confirmInputs)
      .then(evaluate)
      .expect(state.conclusion == Undetermined)

  // stale evidence degrades to CONDITIONAL
  run staleEvidenceYieldsConditionalTest =
    initFrom({ ...initialPackage, evidenceFresh: false })
      .then(confirmInputs)
      .then(evaluate)
      .expect(state.conclusion == Conditional)

  // evidence that degrades between evaluation and assembly blocks assembly
  run degradedEvidenceBlocksAssemblyTest =
    initFrom(initialPackage)
      .then(confirmInputs)
      .then(evaluate)
      .then(conflictDiscovered)
      .then(assembleEvidence.fail())

  // sealing requires assembled evidence; no shortcut from evaluation
  run sealRequiresAssembledEvidenceTest =
    initFrom(initialPackage)
      .then(confirmInputs)
      .then(evaluate)
      .then(seal.fail())

  // a sealed package survives later degradation unchanged (immutability);
  // monitoring supersedes it instead
  run sealedPackageImmutableUnderDegradationTest =
    initFrom(initialPackage)
      .then(confirmInputs)
      .then(evaluate)
      .then(assembleEvidence)
      .then(seal)
      .then(evidenceGoesStale)
      .then(supersede)
      .expect(and {
        state.sealed,
        state.conclusion == Permitted,
        state.supersededBy == 1,
      })

  // non-provisional evidence (future human-reviewed corpus) seals a
  // non-provisional package - the flag is propagated, never invented
  run reviewedEvidenceSealsNonProvisionalTest =
    initFrom({ ...initialPackage, evidenceProvisional: false })
      .then(confirmInputs)
      .then(evaluate)
      .then(assembleEvidence)
      .then(seal)
      .expect(and { state.sealed, not(state.packageProvisional) })
}
