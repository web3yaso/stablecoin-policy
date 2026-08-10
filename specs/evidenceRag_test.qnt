/** Deterministic scenarios for the Phase 3 Evidence RAG model. */
module evidenceRag_test {
  import evidenceRag.* from "./evidenceRag"

  run aggregateProvisionalIndexActivatesAfterMachineEvalTest =
    init
      .then(prepareBuildArtifactWith(1, Provisional, true))
      .then(buildReadyIndexWith(1))
      .then(recordEvalPassWith(1, MachineEval))
      .then(activateIndexWith(1))
      .expect(and {
        state.activeIndexId == 1,
        state.indexes.get(1).phase == Active,
        state.indexes.get(1).multipleSourceReleasesPinned,
      })

  run indexCannotBuildWithoutPreparedArtifactTest =
    init.then(buildReadyIndexWith(1).fail())

  run plannedIndexCannotActivateBeforeBuildTest =
    init
      .then(prepareBuildArtifactWith(1, Provisional, true))
      .then(activateIndexWith(1).fail())

  run indexCannotActivateWithoutEvalTest =
    init
      .then(prepareBuildArtifactWith(1, Provisional, true))
      .then(buildReadyIndexWith(1))
      .then(activateIndexWith(1).fail())

  run failedEvalCannotActivateTest =
    init
      .then(prepareBuildArtifactWith(1, Provisional, true))
      .then(buildReadyIndexWith(1))
      .then(recordEvalFailureWith(1, MachineEval))
      .then(activateIndexWith(1).fail())

  run indexWithoutRightsCannotActivateTest =
    init
      .then(prepareBuildArtifactWith(1, Provisional, true))
      .then(buildIndexWithoutRightsWith(1))
      .then(recordEvalPassWith(1, MachineEval).fail())

  run humanReviewedIndexRejectsMachineEvalTest =
    init
      .then(prepareBuildArtifactWith(1, HumanReviewed, false))
      .then(buildReadyIndexWith(1))
      .then(recordEvalPassWith(1, MachineEval))
      .then(activateIndexWith(1).fail())

  run humanReviewedIndexUsesHumanEvalTest =
    init
      .then(prepareBuildArtifactWith(1, HumanReviewed, false))
      .then(buildReadyIndexWith(1))
      .then(recordEvalPassWith(1, HumanEval))
      .then(activateIndexWith(1))
      .then(searchSuccessWith(HumanReviewed))
      .expect(state.retrieval.outcome == SearchSucceeded)

  run activationRetiresPriorIndexTest =
    init
      .then(prepareBuildArtifactWith(1, Provisional, true))
      .then(buildReadyIndexWith(1))
      .then(recordEvalPassWith(1, MachineEval))
      .then(activateIndexWith(1))
      .then(prepareBuildArtifactWith(2, Provisional, true))
      .then(buildReadyIndexWith(2))
      .then(recordEvalPassWith(2, MachineEval))
      .then(activateIndexWith(2))
      .expect(and {
        state.activeIndexId == 2,
        state.previousIndexId == 1,
        state.indexes.get(1).phase == Retired,
      })

  run rollbackRestoresPriorIndexTest =
    init
      .then(prepareBuildArtifactWith(1, Provisional, true))
      .then(buildReadyIndexWith(1))
      .then(recordEvalPassWith(1, MachineEval))
      .then(activateIndexWith(1))
      .then(prepareBuildArtifactWith(2, Provisional, true))
      .then(buildReadyIndexWith(2))
      .then(recordEvalPassWith(2, MachineEval))
      .then(activateIndexWith(2))
      .then(rollbackIndex)
      .expect(and {
        state.activeIndexId == 1,
        state.previousIndexId == 2,
        state.indexes.get(2).phase == Retired,
      })

  run successfulSearchPinsEvidenceTest =
    init
      .then(prepareBuildArtifactWith(1, Provisional, true))
      .then(buildReadyIndexWith(1))
      .then(recordEvalPassWith(1, MachineEval))
      .then(activateIndexWith(1))
      .then(searchSuccessWith(Provisional))
      .expect(and {
        state.retrieval.outcome == SearchSucceeded,
        state.retrieval.pinnedIndexId == 1,
        state.retrieval.citationsComplete,
        state.retrieval.explanationGrounded,
      })

  run humanReviewedQueryRejectsProvisionalIndexTest =
    init
      .then(prepareBuildArtifactWith(1, Provisional, true))
      .then(buildReadyIndexWith(1))
      .then(recordEvalPassWith(1, MachineEval))
      .then(activateIndexWith(1))
      .then(rejectUnauthorizedWith(HumanReviewed))
      .expect(and {
        state.retrieval.outcome == UnauthorizedEvidence,
        not(state.retrieval.materialNarrativeProduced),
      })

  run humanReviewedQueryCannotSearchProvisionalIndexTest =
    init
      .then(prepareBuildArtifactWith(1, Provisional, true))
      .then(buildReadyIndexWith(1))
      .then(recordEvalPassWith(1, MachineEval))
      .then(activateIndexWith(1))
      .then(searchSuccessWith(HumanReviewed).fail())

  run insufficientEvidenceHasNoNarrativeTest =
    init
      .then(prepareBuildArtifactWith(1, Provisional, true))
      .then(buildReadyIndexWith(1))
      .then(recordEvalPassWith(1, MachineEval))
      .then(activateIndexWith(1))
      .then(returnInsufficientWith(Provisional))
      .expect(and {
        state.retrieval.outcome == InsufficientEvidence,
        not(state.retrieval.materialNarrativeProduced),
        not(state.retrieval.explanationGrounded),
      })

  run conflictingEvidenceHasNoNarrativeTest =
    init
      .then(prepareBuildArtifactWith(1, Provisional, true))
      .then(buildReadyIndexWith(1))
      .then(recordEvalPassWith(1, MachineEval))
      .then(activateIndexWith(1))
      .then(returnConflictWith(Provisional))
      .expect(and {
        state.retrieval.outcome == ConflictingEvidence,
        not(state.retrieval.materialNarrativeProduced),
      })

  run staleIndexCannotSearchTest =
    init
      .then(prepareBuildArtifactWith(1, Provisional, true))
      .then(buildReadyIndexWith(1))
      .then(recordEvalPassWith(1, MachineEval))
      .then(activateIndexWith(1))
      .then(markActiveIndexStale)
      .then(rejectStaleIndexWith(Provisional))
      .expect(state.retrieval.outcome == StaleIndex)

  run staleIndexBlocksSuccessfulSearchTest =
    init
      .then(prepareBuildArtifactWith(1, Provisional, true))
      .then(buildReadyIndexWith(1))
      .then(recordEvalPassWith(1, MachineEval))
      .then(activateIndexWith(1))
      .then(markActiveIndexStale)
      .then(searchSuccessWith(Provisional).fail())

  run outagePreservesDecisionTest =
    init
      .then(retrievalOutageWith(Provisional))
      .expect(and {
        state.retrieval.outcome == RetrievalUnavailable,
        state.deterministicDecisionFingerprint == DECISION_FINGERPRINT,
        not(state.retrieval.materialNarrativeProduced),
      })

  run historicalReplayPinsRetiredIndexTest =
    init
      .then(prepareBuildArtifactWith(1, Provisional, true))
      .then(buildReadyIndexWith(1))
      .then(recordEvalPassWith(1, MachineEval))
      .then(activateIndexWith(1))
      .then(searchSuccessWith(Provisional))
      .then(prepareBuildArtifactWith(2, Provisional, true))
      .then(buildReadyIndexWith(2))
      .then(recordEvalPassWith(2, MachineEval))
      .then(activateIndexWith(2))
      .then(replayPinnedRun)
      .expect(and {
        state.retrieval.outcome == HistoricalReplay,
        state.retrieval.pinnedIndexId == 1,
        state.indexes.get(1).phase == Retired,
        state.replayFingerprintMatches,
      })
}
