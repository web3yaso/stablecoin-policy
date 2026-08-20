module supersedingPlaybookEvaluation_test {
  import supersedingPlaybookEvaluation.* from "./supersedingPlaybookEvaluation"

  run exactPendingSnapshotCompletesAtomicSuccessorTest =
    init
      .then(claimRerun(true, 1, 1, 1, 1))
      .then(completeRerun)
      .expect(and {
        state.rerun.state == RerunCompleted,
        state.successorPackageState == PackageSealed,
        state.lineageRecorded,
        state.baseWatchlistState == WatchlistSuperseded,
        state.successorWatchlistState == WatchlistActive,
        state.deltas.get(1).state == DeltaCovered,
        state.deltas.get(1).coveredBySuccessorVersion == 2,
      })

  run unauthorizedExactPackageClaimFailsTest =
    init
      .then(claimRerun(false, 1, 1, 1, 1).fail())

  run mismatchedBusinessProfileClaimFailsTest =
    init
      .then(claimRerun(true, 2, 1, 1, 1).fail())

  run incompleteDeltaSnapshotClaimFailsTest =
    init
      .then(materializeAdditionalDelta)
      .then(claimRerun(true, 1, 1, 1, 1).fail())

  run wrongThroughCursorClaimFailsTest =
    init
      .then(materializeAdditionalDelta)
      .then(claimRerun(true, 1, 1, 2, 1).fail())

  run completionBeforeClaimFailsTest =
    init
      .then(completeRerun.fail())

  run additionalDeltaMakesClaimStaleTest =
    init
      .then(claimRerun(true, 1, 1, 1, 1))
      .then(materializeAdditionalDelta)
      .expect(and {
        state.rerun.state == RerunClaimed,
        state.successorPackageState == PackageMissing,
        state.baseWatchlistState == WatchlistActive,
      })
      .then(completeRerun.fail())

  run refreshedClaimCompletesAgainstBothDeltasTest =
    init
      .then(claimRerun(true, 1, 1, 1, 1))
      .then(materializeAdditionalDelta)
      .then(observeStaleCompletionConflict)
      .then(refreshRerunClaim(2))
      .then(completeRerun)
      .expect(and {
        state.rerun.state == RerunCompleted,
        state.rerun.requestFingerprintVersion == 2,
        state.rerun.submittedDeltaCount == 2,
        state.rerun.submittedThroughCursor == 2,
        coveredDeltaCount(state) == 2,
        state.deltas.get(1).coveredBySuccessorVersion == 2,
        state.deltas.get(2).coveredBySuccessorVersion == 2,
      })

  run secondClaimCannotCreateAnotherSuccessorTest =
    init
      .then(claimRerun(true, 1, 1, 1, 1))
      .then(claimRerun(true, 1, 1, 1, 1).fail())

  run exactCompletedReplayPreservesSuccessorTest =
    init
      .then(claimRerun(true, 1, 1, 1, 1))
      .then(completeRerun)
      .then(replayCompletedRerun(1, 1))
      .expect(and {
        state.replayObserved,
        state.rerun.successorPackageVersion == 2,
        state.successorPackageIntegrityVersion == 2,
        state.basePackageIntegrityVersion == 1,
        state.claimGeneration == 1,
      })

  run changedRequestCannotReplayCompletedRerunTest =
    init
      .then(claimRerun(true, 1, 1, 1, 1))
      .then(completeRerun)
      .then(replayCompletedRerun(1, 2).fail())

  run changedProfileCannotReplayCompletedRerunTest =
    init
      .then(claimRerun(true, 1, 1, 1, 1))
      .then(completeRerun)
      .then(replayCompletedRerun(2, 1).fail())

  run historicalPackageRemainsImmutableTest =
    init
      .then(claimRerun(true, 1, 1, 1, 1))
      .then(completeRerun)
      .then(replayCompletedRerun(1, 1))
      .expect(and {
        state.basePackageState == PackageSealed,
        state.basePackageIntegrityVersion == 1,
        state.baseProfileFingerprintVersion == 1,
      })

  run supersededWatchlistCannotReceiveNewDeltaTest =
    init
      .then(claimRerun(true, 1, 1, 1, 1))
      .then(completeRerun)
      .expect(and {
        state.baseWatchlistState == WatchlistSuperseded,
        state.deltas.get(2).state == DeltaAbsent,
      })
      .then(materializeAdditionalDelta.fail())
}
