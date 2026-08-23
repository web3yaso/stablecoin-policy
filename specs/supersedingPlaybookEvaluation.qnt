/**
 * Executable model of Phase 6 superseding PlaybookPackage evaluation.
 *
 * Scope: one immutable completed base package, its ACTIVE watchlist, up to two
 * immutable pending Change-to-Action Deltas, one explicitly authorized rerun,
 * one immutable successor package, and atomic watchlist handoff. The two-delta
 * abstraction checks optimistic concurrency when a new change arrives during
 * evaluation; relational multiplicity and database locking belong in pgTAP.
 *
 * Requirements coverage:
 * - Change-to-Action requires ACKNOWLEDGE_AND_RERUN, never automatic rerun.
 * - The base Business Profile is not stored by the domain. Citely resubmits it
 *   and its fingerprint must match the base package exactly.
 * - A successor never mutates the historical package. Completion atomically
 *   records lineage, covers every pending delta, supersedes the old watchlist,
 *   and activates the successor watchlist.
 *
 * Assumptions: one domain service coordinates through shared PostgreSQL state,
 * so plain Quint is used rather than Choreo. Claim, stale-snapshot rejection,
 * package registration, lineage, delta coverage, and watchlist handoff are
 * atomic database operations. HTTP serialization and artifact upload plumbing
 * are outside the model.
 */
module supersedingPlaybookEvaluation {
  type PackageState = PackageMissing | PackageSealed
  type WatchlistState = WatchlistNone | WatchlistActive | WatchlistSuperseded
  type DeltaState = DeltaAbsent | DeltaPending | DeltaCovered
  type RerunState = RerunAbsent | RerunClaimed | RerunCompleted

  type DeltaRecord = {
    state: DeltaState,
    cursor: int,
    coveredBySuccessorVersion: int,
  }

  type RerunRecord = {
    state: RerunState,
    exactPackageAuthorized: bool,
    profileFingerprintVersion: int,
    requestFingerprintVersion: int,
    submittedDeltaCount: int,
    submittedThroughCursor: int,
    successorPackageVersion: int,
  }

  type SupersedingEvaluationState = {
    basePackageState: PackageState,
    basePackageIntegrityVersion: int,
    baseProfileFingerprintVersion: int,
    baseWatchlistState: WatchlistState,
    successorPackageState: PackageState,
    successorPackageIntegrityVersion: int,
    successorProfileFingerprintVersion: int,
    successorWatchlistState: WatchlistState,
    lineageRecorded: bool,
    deltas: int -> DeltaRecord,
    rerun: RerunRecord,
    claimGeneration: int,
    staleConflictObserved: bool,
    replayObserved: bool,
  }

  pure val DELTA_IDS = Set(1, 2)

  pure val absentDelta: DeltaRecord = {
    state: DeltaAbsent,
    cursor: 0,
    coveredBySuccessorVersion: 0,
  }

  pure val emptyRerun: RerunRecord = {
    state: RerunAbsent,
    exactPackageAuthorized: false,
    profileFingerprintVersion: 0,
    requestFingerprintVersion: 0,
    submittedDeltaCount: 0,
    submittedThroughCursor: 0,
    successorPackageVersion: 0,
  }

  var state: SupersedingEvaluationState

  pure def pendingDeltaCount(s: SupersedingEvaluationState): int =
    DELTA_IDS.filter(id => s.deltas.get(id).state == DeltaPending).size()

  pure def latestPendingCursor(s: SupersedingEvaluationState): int =
    if (s.deltas.get(2).state == DeltaPending) 2
    else if (s.deltas.get(1).state == DeltaPending) 1
    else 0

  pure def snapshotMatches(
    s: SupersedingEvaluationState,
    submittedDeltaCount: int,
    submittedThroughCursor: int,
  ): bool = and {
    pendingDeltaCount(s) > 0,
    submittedDeltaCount == pendingDeltaCount(s),
    submittedThroughCursor == latestPendingCursor(s),
  }

  pure def canMaterializeAdditionalDelta(
    s: SupersedingEvaluationState,
  ): bool = and {
    s.baseWatchlistState == WatchlistActive,
    s.deltas.get(2).state == DeltaAbsent,
  }

  pure def applyMaterializeAdditionalDelta(
    s: SupersedingEvaluationState,
  ): SupersedingEvaluationState =
    { ...s,
      deltas: s.deltas.set(2, {
        state: DeltaPending,
        cursor: 2,
        coveredBySuccessorVersion: 0,
      }) }

  pure def canClaimRerun(
    s: SupersedingEvaluationState,
    exactPackageAuthorized: bool,
    profileFingerprintVersion: int,
    requestFingerprintVersion: int,
    submittedDeltaCount: int,
    submittedThroughCursor: int,
  ): bool = and {
    s.basePackageState == PackageSealed,
    s.baseWatchlistState == WatchlistActive,
    s.rerun.state == RerunAbsent,
    exactPackageAuthorized,
    profileFingerprintVersion == s.baseProfileFingerprintVersion,
    requestFingerprintVersion > 0,
    snapshotMatches(s, submittedDeltaCount, submittedThroughCursor),
  }

  pure def applyClaimRerun(
    s: SupersedingEvaluationState,
    profileFingerprintVersion: int,
    requestFingerprintVersion: int,
    submittedDeltaCount: int,
    submittedThroughCursor: int,
  ): SupersedingEvaluationState =
    { ...s,
      rerun: {
        state: RerunClaimed,
        exactPackageAuthorized: true,
        profileFingerprintVersion: profileFingerprintVersion,
        requestFingerprintVersion: requestFingerprintVersion,
        submittedDeltaCount: submittedDeltaCount,
        submittedThroughCursor: submittedThroughCursor,
        successorPackageVersion: 0,
      },
      claimGeneration: 1 }

  pure def currentSnapshotMatchesClaim(
    s: SupersedingEvaluationState,
  ): bool = snapshotMatches(
    s,
    s.rerun.submittedDeltaCount,
    s.rerun.submittedThroughCursor,
  )

  pure def canObserveStaleCompletionConflict(
    s: SupersedingEvaluationState,
  ): bool = and {
    s.rerun.state == RerunClaimed,
    not(currentSnapshotMatchesClaim(s)),
    not(s.staleConflictObserved),
  }

  pure def applyObserveStaleCompletionConflict(
    s: SupersedingEvaluationState,
  ): SupersedingEvaluationState =
    { ...s, staleConflictObserved: true }

  pure def canRefreshRerunClaim(
    s: SupersedingEvaluationState,
    requestFingerprintVersion: int,
  ): bool = and {
    s.rerun.state == RerunClaimed,
    s.staleConflictObserved,
    not(currentSnapshotMatchesClaim(s)),
    requestFingerprintVersion > s.rerun.requestFingerprintVersion,
  }

  pure def applyRefreshRerunClaim(
    s: SupersedingEvaluationState,
    requestFingerprintVersion: int,
  ): SupersedingEvaluationState =
    { ...s,
      rerun: {
        ...s.rerun,
        requestFingerprintVersion: requestFingerprintVersion,
        submittedDeltaCount: pendingDeltaCount(s),
        submittedThroughCursor: latestPendingCursor(s),
      },
      claimGeneration: s.claimGeneration + 1 }

  pure def coveredDeltaCount(s: SupersedingEvaluationState): int =
    DELTA_IDS.filter(id => s.deltas.get(id).state == DeltaCovered).size()

  pure def coverPendingDeltas(
    s: SupersedingEvaluationState,
    successorPackageVersion: int,
  ): int -> DeltaRecord =
    DELTA_IDS.mapBy(id =>
      if (s.deltas.get(id).state == DeltaPending) {
        { ...s.deltas.get(id),
          state: DeltaCovered,
          coveredBySuccessorVersion: successorPackageVersion }
      } else s.deltas.get(id))

  pure def canCompleteRerun(s: SupersedingEvaluationState): bool = and {
    s.rerun.state == RerunClaimed,
    currentSnapshotMatchesClaim(s),
    s.rerun.exactPackageAuthorized,
    s.rerun.profileFingerprintVersion == s.baseProfileFingerprintVersion,
    s.successorPackageState == PackageMissing,
    s.baseWatchlistState == WatchlistActive,
  }

  pure def applyCompleteRerun(
    s: SupersedingEvaluationState,
  ): SupersedingEvaluationState =
    { ...s,
      baseWatchlistState: WatchlistSuperseded,
      successorPackageState: PackageSealed,
      successorPackageIntegrityVersion: 2,
      successorProfileFingerprintVersion: s.baseProfileFingerprintVersion,
      successorWatchlistState: WatchlistActive,
      lineageRecorded: true,
      deltas: coverPendingDeltas(s, 2),
      rerun: {
        ...s.rerun,
        state: RerunCompleted,
        successorPackageVersion: 2,
      } }

  pure def canReplayCompletedRerun(
    s: SupersedingEvaluationState,
    profileFingerprintVersion: int,
    requestFingerprintVersion: int,
  ): bool = and {
    s.rerun.state == RerunCompleted,
    profileFingerprintVersion == s.rerun.profileFingerprintVersion,
    requestFingerprintVersion == s.rerun.requestFingerprintVersion,
    not(s.replayObserved),
  }

  pure def applyReplayCompletedRerun(
    s: SupersedingEvaluationState,
  ): SupersedingEvaluationState =
    { ...s, replayObserved: true }

  action init: bool = {
    state' = {
      basePackageState: PackageSealed,
      basePackageIntegrityVersion: 1,
      baseProfileFingerprintVersion: 1,
      baseWatchlistState: WatchlistActive,
      successorPackageState: PackageMissing,
      successorPackageIntegrityVersion: 0,
      successorProfileFingerprintVersion: 0,
      successorWatchlistState: WatchlistNone,
      lineageRecorded: false,
      deltas: DELTA_IDS.mapBy(id => if (id == 1) {
        {
          state: DeltaPending,
          cursor: 1,
          coveredBySuccessorVersion: 0,
        }
      } else absentDelta),
      rerun: emptyRerun,
      claimGeneration: 0,
      staleConflictObserved: false,
      replayObserved: false,
    }
  }

  action materializeAdditionalDelta: bool = all {
    canMaterializeAdditionalDelta(state),
    state' = applyMaterializeAdditionalDelta(state),
  }

  action claimRerun(
    exactPackageAuthorized: bool,
    profileFingerprintVersion: int,
    requestFingerprintVersion: int,
    submittedDeltaCount: int,
    submittedThroughCursor: int,
  ): bool = all {
    canClaimRerun(
      state,
      exactPackageAuthorized,
      profileFingerprintVersion,
      requestFingerprintVersion,
      submittedDeltaCount,
      submittedThroughCursor,
    ),
    state' = applyClaimRerun(
      state,
      profileFingerprintVersion,
      requestFingerprintVersion,
      submittedDeltaCount,
      submittedThroughCursor,
    ),
  }

  action observeStaleCompletionConflict: bool = all {
    canObserveStaleCompletionConflict(state),
    state' = applyObserveStaleCompletionConflict(state),
  }

  action refreshRerunClaim(requestFingerprintVersion: int): bool = all {
    canRefreshRerunClaim(state, requestFingerprintVersion),
    state' = applyRefreshRerunClaim(state, requestFingerprintVersion),
  }

  action completeRerun: bool = all {
    canCompleteRerun(state),
    state' = applyCompleteRerun(state),
  }

  action replayCompletedRerun(
    profileFingerprintVersion: int,
    requestFingerprintVersion: int,
  ): bool = all {
    canReplayCompletedRerun(
      state,
      profileFingerprintVersion,
      requestFingerprintVersion,
    ),
    state' = applyReplayCompletedRerun(state),
  }

  val additionalDeltaMaterializedWitness: bool =
    state.deltas.get(2).state == DeltaPending

  val rerunClaimedWitness: bool = state.rerun.state == RerunClaimed
  val staleCompletionConflictWitness: bool = state.staleConflictObserved
  val refreshedRerunClaimWitness: bool = state.claimGeneration > 1
  val rerunCompletedWitness: bool = state.rerun.state == RerunCompleted
  val atomicWatchlistHandoffWitness: bool = and {
    state.baseWatchlistState == WatchlistSuperseded,
    state.successorWatchlistState == WatchlistActive,
  }
  val completedReplayWitness: bool = state.replayObserved

  val historicalPackageIsNeverMutated: bool = and {
    state.basePackageState == PackageSealed,
    state.basePackageIntegrityVersion == 1,
    state.baseProfileFingerprintVersion == 1,
  }

  val claimedRerunWasExplicitlyAuthorizedAndProfileMatched: bool =
    state.rerun.state != RerunAbsent implies and {
      state.rerun.exactPackageAuthorized,
      state.rerun.profileFingerprintVersion
        == state.baseProfileFingerprintVersion,
      state.rerun.requestFingerprintVersion > 0,
      state.rerun.submittedDeltaCount > 0,
      state.rerun.submittedThroughCursor > 0,
      state.claimGeneration > 0,
    }

  val noAutomaticSuccessor: bool =
    state.rerun.state != RerunCompleted implies and {
      state.successorPackageState == PackageMissing,
      state.successorWatchlistState == WatchlistNone,
      not(state.lineageRecorded),
    }

  val staleSnapshotCannotProduceSuccessor: bool =
    (state.rerun.state == RerunClaimed
      and not(currentSnapshotMatchesClaim(state))) implies and {
        state.successorPackageState == PackageMissing,
        state.baseWatchlistState == WatchlistActive,
        state.successorWatchlistState == WatchlistNone,
        not(state.lineageRecorded),
      }

  val refreshedClaimUsesCompleteCurrentSnapshot: bool =
    state.claimGeneration > 1 implies and {
      state.staleConflictObserved,
      state.rerun.requestFingerprintVersion > 1,
      state.rerun.state == RerunClaimed implies
        currentSnapshotMatchesClaim(state),
    }

  val successorRequiresAtomicLineageAndHandoff: bool =
    state.successorPackageState == PackageSealed implies and {
      state.rerun.state == RerunCompleted,
      state.rerun.successorPackageVersion == 2,
      state.lineageRecorded,
      state.baseWatchlistState == WatchlistSuperseded,
      state.successorWatchlistState == WatchlistActive,
    }

  val coveredDeltasRequireSuccessorLineage: bool =
    coveredDeltaCount(state) > 0 implies and {
      state.successorPackageState == PackageSealed,
      state.lineageRecorded,
      DELTA_IDS.forall(id =>
        state.deltas.get(id).state == DeltaCovered implies
          state.deltas.get(id).coveredBySuccessorVersion == 2),
    }

  val completedRerunCoveredExactPendingSnapshot: bool =
    state.rerun.state == RerunCompleted implies and {
      pendingDeltaCount(state) == 0,
      coveredDeltaCount(state) == state.rerun.submittedDeltaCount,
      DELTA_IDS.forall(id =>
        state.deltas.get(id).state != DeltaAbsent implies
          state.deltas.get(id).state == DeltaCovered),
    }

  val successorProfileMatchesBase: bool =
    state.successorPackageState == PackageSealed implies
      state.successorProfileFingerprintVersion
        == state.baseProfileFingerprintVersion

  val supersededBaseIsClosedToNewDeltas: bool =
    state.baseWatchlistState == WatchlistSuperseded implies and {
      state.rerun.state == RerunCompleted,
      pendingDeltaCount(state) == 0,
      state.successorWatchlistState == WatchlistActive,
    }

  val completedReplayPreservesSuccessorIdentity: bool =
    state.replayObserved implies and {
      state.rerun.state == RerunCompleted,
      state.rerun.successorPackageVersion == 2,
      state.successorPackageIntegrityVersion == 2,
      state.basePackageIntegrityVersion == 1,
      state.claimGeneration > 0,
    }

  action step: bool = {
    nondet exactPackageAuthorized = Set(true, false).oneOf()
    nondet profileFingerprintVersion = Set(1, 2).oneOf()
    nondet requestFingerprintVersion = Set(1, 2).oneOf()
    nondet submittedDeltaCount = Set(1, 2).oneOf()
    nondet submittedThroughCursor = Set(1, 2).oneOf()
    any {
      materializeAdditionalDelta,
      claimRerun(
        exactPackageAuthorized,
        profileFingerprintVersion,
        requestFingerprintVersion,
        submittedDeltaCount,
        submittedThroughCursor,
      ),
      observeStaleCompletionConflict,
      refreshRerunClaim(requestFingerprintVersion),
      completeRerun,
      replayCompletedRerun(
        profileFingerprintVersion,
        requestFingerprintVersion,
      ),
    }
  }
}
