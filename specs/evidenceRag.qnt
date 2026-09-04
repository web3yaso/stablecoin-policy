/**
 * Executable model of the Phase 3 Evidence RAG index and retrieval boundary.
 *
 * Requirements: formal development spec section 5.1, Phase 3, and Evidence
 * RAG acceptance criteria; master development plan Phase 3. PostgreSQL is
 * shared state, so this is plain Quint rather than a message protocol.
 *
 * The model deliberately separates retrieval from deterministic decisions:
 * RAG may improve or degrade an explanation, but every RAG transition must
 * preserve the deterministic decision fingerprint.
 */
module evidenceRag {
  type AssuranceTier = Provisional | HumanReviewed
  type IndexPhase = Missing | Planned | Draft | Active | Retired | Suspended
  type EvalAssurance = NoEvalAssurance | MachineEval | HumanEval
  type EvalOutcome = EvalMissing | EvalPassed | EvalFailed

  type RetrievalOutcome =
    | NoRetrieval
    | SearchSucceeded
    | InsufficientEvidence
    | ConflictingEvidence
    | UnauthorizedEvidence
    | StaleIndex
    | RetrievalUnavailable
    | HistoricalReplay

  type IndexRelease = {
    phase: IndexPhase,
    assuranceTier: AssuranceTier,
    corpusTier: AssuranceTier,
    corpusReleasePinned: bool,
    corpusSnapshotPinned: bool,
    sourceReleasesPinned: bool,
    membershipComplete: bool,
    membershipDeduplicated: bool,
    multipleSourceReleasesPinned: bool,
    buildArtifactPinned: bool,
    buildArtifactConsumed: bool,
    manifestComplete: bool,
    chunksPresent: bool,
    rightsAuthorized: bool,
    versionsIsolated: bool,
    lexicalConfigPinned: bool,
    vectorConfigPinned: bool,
    evalAssurance: EvalAssurance,
    evalOutcome: EvalOutcome,
    stale: bool,
  }

  type RetrievalRecord = {
    outcome: RetrievalOutcome,
    requestedTier: AssuranceTier,
    pinnedIndexId: int,
    corpusReleasePinned: bool,
    resultsAuthorized: bool,
    resultsVersionIsolated: bool,
    citationsComplete: bool,
    explanationGrounded: bool,
    materialNarrativeProduced: bool,
    resultFingerprint: int,
  }

  type EvidenceRagState = {
    indexes: int -> IndexRelease,
    activeIndexId: int,
    previousIndexId: int,
    retrieval: RetrievalRecord,
    recordedRunIndexId: int,
    recordedRunTier: AssuranceTier,
    recordedRunFingerprint: int,
    replayFingerprintMatches: bool,
    deterministicDecisionFingerprint: int,
  }

  pure val INDEX_IDS = Set(1, 2)
  pure val NO_INDEX = 0
  pure val DECISION_FINGERPRINT = 73
  pure val SEARCH_RESULT_FINGERPRINT = 101

  pure def emptyIndex: IndexRelease = {
    phase: Missing,
    assuranceTier: Provisional,
    corpusTier: Provisional,
    corpusReleasePinned: false,
    corpusSnapshotPinned: false,
    sourceReleasesPinned: false,
    membershipComplete: false,
    membershipDeduplicated: false,
    multipleSourceReleasesPinned: false,
    buildArtifactPinned: false,
    buildArtifactConsumed: false,
    manifestComplete: false,
    chunksPresent: false,
    rightsAuthorized: false,
    versionsIsolated: false,
    lexicalConfigPinned: false,
    vectorConfigPinned: false,
    evalAssurance: NoEvalAssurance,
    evalOutcome: EvalMissing,
    stale: false,
  }

  pure def emptyRetrieval: RetrievalRecord = {
    outcome: NoRetrieval,
    requestedTier: Provisional,
    pinnedIndexId: NO_INDEX,
    corpusReleasePinned: false,
    resultsAuthorized: false,
    resultsVersionIsolated: false,
    citationsComplete: false,
    explanationGrounded: false,
    materialNarrativeProduced: false,
    resultFingerprint: 0,
  }

  pure def initialState: EvidenceRagState = {
    indexes: INDEX_IDS.mapBy(_ => emptyIndex),
    activeIndexId: NO_INDEX,
    previousIndexId: NO_INDEX,
    retrieval: emptyRetrieval,
    recordedRunIndexId: NO_INDEX,
    recordedRunTier: Provisional,
    recordedRunFingerprint: 0,
    replayFingerprintMatches: false,
    deterministicDecisionFingerprint: DECISION_FINGERPRINT,
  }

  pure def structurallySafe(index: IndexRelease): bool = and {
    index.corpusReleasePinned,
    index.corpusSnapshotPinned,
    index.sourceReleasesPinned,
    index.membershipComplete,
    index.membershipDeduplicated,
    index.buildArtifactPinned,
    index.buildArtifactConsumed,
    index.manifestComplete,
    index.chunksPresent,
    index.rightsAuthorized,
    index.versionsIsolated,
    index.lexicalConfigPinned,
    index.vectorConfigPinned,
    index.assuranceTier == index.corpusTier,
  }

  pure def evalAuthorizes(index: IndexRelease): bool = and {
    index.evalOutcome == EvalPassed,
    index.evalAssurance != NoEvalAssurance,
    index.assuranceTier == Provisional or index.evalAssurance == HumanEval,
  }

  pure def activationEligible(index: IndexRelease): bool = and {
    index.phase == Draft,
    structurallySafe(index),
    evalAuthorizes(index),
    not(index.stale),
  }

  pure def tierAuthorized(indexTier: AssuranceTier, requestedTier: AssuranceTier): bool =
    requestedTier == Provisional or indexTier == HumanReviewed

  pure def prepareBuildArtifact(
    index: IndexRelease,
    tier: AssuranceTier,
    multipleSourceReleases: bool
  ): IndexRelease = {
    ...index,
    phase: Planned,
    assuranceTier: tier,
    corpusTier: tier,
    corpusReleasePinned: true,
    corpusSnapshotPinned: true,
    sourceReleasesPinned: true,
    membershipComplete: true,
    membershipDeduplicated: true,
    multipleSourceReleasesPinned: multipleSourceReleases,
    buildArtifactPinned: true,
    buildArtifactConsumed: false,
    evalAssurance: NoEvalAssurance,
    evalOutcome: EvalMissing,
  }

  pure def buildReady(index: IndexRelease): IndexRelease = {
    ...index,
    phase: Draft,
    buildArtifactConsumed: true,
    manifestComplete: true,
    chunksPresent: true,
    rightsAuthorized: true,
    versionsIsolated: true,
    lexicalConfigPinned: true,
    vectorConfigPinned: true,
    stale: false,
  }

  pure def buildWithoutRights(index: IndexRelease): IndexRelease = {
    ...buildReady(index),
    rightsAuthorized: false,
  }

  pure def canPrepare(s: EvidenceRagState, indexId: int): bool = and {
    INDEX_IDS.contains(indexId),
    s.indexes.get(indexId).phase == Missing,
  }

  pure def canBuild(s: EvidenceRagState, indexId: int): bool = and {
    INDEX_IDS.contains(indexId),
    s.indexes.get(indexId).phase == Planned,
    s.indexes.get(indexId).corpusSnapshotPinned,
    s.indexes.get(indexId).sourceReleasesPinned,
    s.indexes.get(indexId).membershipComplete,
    s.indexes.get(indexId).membershipDeduplicated,
    s.indexes.get(indexId).buildArtifactPinned,
    not(s.indexes.get(indexId).buildArtifactConsumed),
  }

  pure def applyPrepareBuildArtifact(
    s: EvidenceRagState,
    indexId: int,
    tier: AssuranceTier,
    multipleSourceReleases: bool
  ): EvidenceRagState =
    { ...s, indexes: s.indexes.put(
      indexId,
      prepareBuildArtifact(s.indexes.get(indexId), tier, multipleSourceReleases)
    ) }

  pure def applyBuildReady(
    s: EvidenceRagState,
    indexId: int
  ): EvidenceRagState =
    { ...s, indexes: s.indexes.put(indexId, buildReady(s.indexes.get(indexId))) }

  pure def applyBuildWithoutRights(
    s: EvidenceRagState,
    indexId: int
  ): EvidenceRagState =
    { ...s,
      indexes: s.indexes.put(indexId, buildWithoutRights(s.indexes.get(indexId))) }

  pure def applyEval(
    s: EvidenceRagState,
    indexId: int,
    assurance: EvalAssurance,
    outcome: EvalOutcome
  ): EvidenceRagState =
    { ...s, indexes: s.indexes.put(indexId, {
      ...s.indexes.get(indexId),
      evalAssurance: assurance,
      evalOutcome: outcome,
    }) }

  pure def canActivate(s: EvidenceRagState, indexId: int): bool = and {
    INDEX_IDS.contains(indexId),
    activationEligible(s.indexes.get(indexId)),
  }

  pure def setIndexPhase(
    indexes: int -> IndexRelease,
    indexId: int,
    phase: IndexPhase
  ): int -> IndexRelease =
    indexes.put(indexId, { ...indexes.get(indexId), phase: phase })

  pure def retireActiveIndex(s: EvidenceRagState): int -> IndexRelease =
    if (s.activeIndexId == NO_INDEX) s.indexes
    else setIndexPhase(s.indexes, s.activeIndexId, Retired)

  pure def applyActivate(s: EvidenceRagState, indexId: int): EvidenceRagState =
    { ...s,
      indexes: setIndexPhase(retireActiveIndex(s), indexId, Active),
      previousIndexId: s.activeIndexId,
      activeIndexId: indexId }

  pure def canRollback(s: EvidenceRagState): bool = and {
    s.activeIndexId != NO_INDEX,
    s.previousIndexId != NO_INDEX,
    s.indexes.get(s.activeIndexId).phase == Active,
    s.indexes.get(s.previousIndexId).phase == Retired,
    structurallySafe(s.indexes.get(s.previousIndexId)),
    not(s.indexes.get(s.previousIndexId).stale),
  }

  pure def applyRollback(s: EvidenceRagState): EvidenceRagState =
    { ...s,
      indexes: setIndexPhase(
        setIndexPhase(s.indexes, s.activeIndexId, Retired),
        s.previousIndexId,
        Active
      ),
      activeIndexId: s.previousIndexId,
      previousIndexId: s.activeIndexId }

  pure def canSearch(s: EvidenceRagState, requestedTier: AssuranceTier): bool = and {
    s.activeIndexId != NO_INDEX,
    s.indexes.get(s.activeIndexId).phase == Active,
    structurallySafe(s.indexes.get(s.activeIndexId)),
    not(s.indexes.get(s.activeIndexId).stale),
    tierAuthorized(s.indexes.get(s.activeIndexId).assuranceTier, requestedTier),
  }

  pure def successfulRetrieval(
    requestedTier: AssuranceTier,
    indexId: int,
    outcome: RetrievalOutcome
  ): RetrievalRecord = {
    outcome: outcome,
    requestedTier: requestedTier,
    pinnedIndexId: indexId,
    corpusReleasePinned: true,
    resultsAuthorized: true,
    resultsVersionIsolated: true,
    citationsComplete: true,
    explanationGrounded: true,
    materialNarrativeProduced: true,
    resultFingerprint: SEARCH_RESULT_FINGERPRINT,
  }

  pure def nonNarrativeRetrieval(
    requestedTier: AssuranceTier,
    indexId: int,
    outcome: RetrievalOutcome,
    corpusPinned: bool
  ): RetrievalRecord = {
    outcome: outcome,
    requestedTier: requestedTier,
    pinnedIndexId: indexId,
    corpusReleasePinned: corpusPinned,
    resultsAuthorized: true,
    resultsVersionIsolated: true,
    citationsComplete: false,
    explanationGrounded: false,
    materialNarrativeProduced: false,
    resultFingerprint: 0,
  }

  // === state machine ===

  var state: EvidenceRagState

  action init = all { state' = initialState }

  action initFrom(s: EvidenceRagState): bool = all { state' = s }

  action prepareBuildArtifactWith(
    indexId: int,
    tier: AssuranceTier,
    multipleSourceReleases: bool
  ): bool = all {
    canPrepare(state, indexId),
    state' = applyPrepareBuildArtifact(
      state, indexId, tier, multipleSourceReleases
    ),
  }

  action prepareBuildArtifactAction = {
    nondet indexId = INDEX_IDS.oneOf()
    nondet tier = Set(Provisional, HumanReviewed).oneOf()
    nondet multipleSourceReleases = Set(true, false).oneOf()
    prepareBuildArtifactWith(indexId, tier, multipleSourceReleases)
  }

  action buildReadyIndexWith(indexId: int): bool = all {
    canBuild(state, indexId),
    state' = applyBuildReady(state, indexId),
  }

  action buildReadyIndex = {
    nondet indexId = INDEX_IDS.oneOf()
    buildReadyIndexWith(indexId)
  }

  action buildIndexWithoutRightsWith(indexId: int): bool = all {
    canBuild(state, indexId),
    state' = applyBuildWithoutRights(state, indexId),
  }

  action buildIndexWithoutRights = {
    nondet indexId = INDEX_IDS.oneOf()
    buildIndexWithoutRightsWith(indexId)
  }

  action recordEvalPassWith(indexId: int, assurance: EvalAssurance): bool = all {
    INDEX_IDS.contains(indexId),
    state.indexes.get(indexId).phase == Draft,
    structurallySafe(state.indexes.get(indexId)),
    assurance != NoEvalAssurance,
    state' = applyEval(state, indexId, assurance, EvalPassed),
  }

  action recordEvalPass = {
    nondet indexId = INDEX_IDS.oneOf()
    nondet assurance = Set(MachineEval, HumanEval).oneOf()
    recordEvalPassWith(indexId, assurance)
  }

  action recordEvalFailureWith(indexId: int, assurance: EvalAssurance): bool = all {
    INDEX_IDS.contains(indexId),
    state.indexes.get(indexId).phase == Draft,
    assurance != NoEvalAssurance,
    state' = applyEval(state, indexId, assurance, EvalFailed),
  }

  action recordEvalFailure = {
    nondet indexId = INDEX_IDS.oneOf()
    nondet assurance = Set(MachineEval, HumanEval).oneOf()
    recordEvalFailureWith(indexId, assurance)
  }

  action activateIndexWith(indexId: int): bool = all {
    canActivate(state, indexId),
    state' = applyActivate(state, indexId),
  }

  action activateIndex = {
    nondet indexId = INDEX_IDS.oneOf()
    activateIndexWith(indexId)
  }

  action rollbackIndex: bool = all {
    canRollback(state),
    state' = applyRollback(state),
  }

  action markActiveIndexStale: bool = all {
    state.activeIndexId != NO_INDEX,
    not(state.indexes.get(state.activeIndexId).stale),
    state' = ({ ...state,
      indexes: state.indexes.put(
        state.activeIndexId,
        { ...state.indexes.get(state.activeIndexId), stale: true }
      ) })
  }

  action searchSuccessWith(requestedTier: AssuranceTier): bool = all {
    canSearch(state, requestedTier),
    state' = { ...state,
      retrieval: successfulRetrieval(
        requestedTier,
        state.activeIndexId,
        SearchSucceeded
      ),
      recordedRunIndexId: state.activeIndexId,
      recordedRunTier: requestedTier,
      recordedRunFingerprint: SEARCH_RESULT_FINGERPRINT,
      replayFingerprintMatches: false }
  }

  action searchSuccess = {
    nondet requestedTier = Set(Provisional, HumanReviewed).oneOf()
    searchSuccessWith(requestedTier)
  }

  action returnInsufficientWith(requestedTier: AssuranceTier): bool = all {
    canSearch(state, requestedTier),
    state' = { ...state,
      retrieval: nonNarrativeRetrieval(
        requestedTier,
        state.activeIndexId,
        InsufficientEvidence,
        true
      ) }
  }

  action returnInsufficient = {
    nondet requestedTier = Set(Provisional, HumanReviewed).oneOf()
    returnInsufficientWith(requestedTier)
  }

  action returnConflictWith(requestedTier: AssuranceTier): bool = all {
    canSearch(state, requestedTier),
    state' = { ...state,
      retrieval: nonNarrativeRetrieval(
        requestedTier,
        state.activeIndexId,
        ConflictingEvidence,
        true
      ) }
  }

  action returnConflict = {
    nondet requestedTier = Set(Provisional, HumanReviewed).oneOf()
    returnConflictWith(requestedTier)
  }

  action rejectUnauthorizedWith(requestedTier: AssuranceTier): bool = all {
    state.activeIndexId != NO_INDEX,
    state.indexes.get(state.activeIndexId).phase == Active,
    not(tierAuthorized(
      state.indexes.get(state.activeIndexId).assuranceTier,
      requestedTier
    )),
    state' = { ...state,
      retrieval: nonNarrativeRetrieval(
        requestedTier,
        state.activeIndexId,
        UnauthorizedEvidence,
        true
      ) }
  }

  action rejectUnauthorized = {
    nondet requestedTier = Set(Provisional, HumanReviewed).oneOf()
    rejectUnauthorizedWith(requestedTier)
  }

  action rejectStaleIndexWith(requestedTier: AssuranceTier): bool = all {
    state.activeIndexId != NO_INDEX,
    state.indexes.get(state.activeIndexId).phase == Active,
    state.indexes.get(state.activeIndexId).stale,
    state' = { ...state,
      retrieval: nonNarrativeRetrieval(
        requestedTier,
        state.activeIndexId,
        StaleIndex,
        true
      ) }
  }

  action rejectStaleIndex = {
    nondet requestedTier = Set(Provisional, HumanReviewed).oneOf()
    rejectStaleIndexWith(requestedTier)
  }

  action retrievalOutageWith(requestedTier: AssuranceTier): bool = all {
    state' = { ...state,
      retrieval: nonNarrativeRetrieval(
        requestedTier,
        state.activeIndexId,
        RetrievalUnavailable,
        false
      ) }
  }

  action retrievalOutage = {
    nondet requestedTier = Set(Provisional, HumanReviewed).oneOf()
    retrievalOutageWith(requestedTier)
  }

  action replayPinnedRun: bool = all {
    state.recordedRunIndexId != NO_INDEX,
    INDEX_IDS.contains(state.recordedRunIndexId),
    state.indexes.get(state.recordedRunIndexId).phase != Missing,
    structurallySafe(state.indexes.get(state.recordedRunIndexId)),
    state' = { ...state,
      retrieval: successfulRetrieval(
        state.recordedRunTier,
        state.recordedRunIndexId,
        HistoricalReplay
      ),
      replayFingerprintMatches:
        state.recordedRunFingerprint == SEARCH_RESULT_FINGERPRINT }
  }

  action step = any {
    prepareBuildArtifactAction,
    buildReadyIndex,
    buildIndexWithoutRights,
    recordEvalPass,
    recordEvalFailure,
    activateIndex,
    rollbackIndex,
    markActiveIndexStale,
    searchSuccess,
    returnInsufficient,
    returnConflict,
    rejectUnauthorized,
    rejectStaleIndex,
    retrievalOutage,
    replayPinnedRun,
  }

  // === invariants ===

  val oneActiveIndexAndPointerAgree: bool = and {
    INDEX_IDS.filter(id => state.indexes.get(id).phase == Active).size() <= 1,
    state.activeIndexId == NO_INDEX
      iff INDEX_IDS.filter(id => state.indexes.get(id).phase == Active).size() == 0,
    state.activeIndexId == NO_INDEX
      or state.indexes.get(state.activeIndexId).phase == Active,
  }

  val activeAndRetiredIndexesAreStructurallySafe: bool =
    INDEX_IDS.forall(id => {
      val index = state.indexes.get(id)
      (index.phase == Active or index.phase == Retired) implies structurallySafe(index)
    })

  val builtIndexesConsumeOnePinnedArtifact: bool =
    INDEX_IDS.forall(id => {
      val index = state.indexes.get(id)
      (index.phase == Draft or index.phase == Active or index.phase == Retired)
        implies and { index.buildArtifactPinned, index.buildArtifactConsumed }
    })

  val activeIndexesPinCompleteSnapshots: bool =
    INDEX_IDS.forall(id => {
      val index = state.indexes.get(id)
      index.phase == Active implies and {
        index.corpusSnapshotPinned,
        index.sourceReleasesPinned,
        index.membershipComplete,
        index.membershipDeduplicated,
      }
    })

  val activeIndexesHaveTierAppropriateEval: bool =
    INDEX_IDS.forall(id => {
      val index = state.indexes.get(id)
      index.phase == Active implies evalAuthorizes(index)
    })

  val successfulRetrievalPinsAuthorizedEvidence: bool =
    (state.retrieval.outcome == SearchSucceeded
      or state.retrieval.outcome == HistoricalReplay) implies and {
      state.retrieval.pinnedIndexId != NO_INDEX,
      state.retrieval.corpusReleasePinned,
      state.retrieval.resultsAuthorized,
      state.retrieval.resultsVersionIsolated,
      state.retrieval.citationsComplete,
      state.retrieval.explanationGrounded,
    }

  val humanReviewedQueryCannotUseProvisionalIndex: bool =
    (state.retrieval.requestedTier == HumanReviewed
      and (state.retrieval.outcome == SearchSucceeded
        or state.retrieval.outcome == HistoricalReplay)) implies
      state.indexes.get(state.retrieval.pinnedIndexId).assuranceTier == HumanReviewed

  val narrativeOnlyFromGroundedSuccessfulRetrieval: bool =
    state.retrieval.materialNarrativeProduced implies and {
      state.retrieval.outcome == SearchSucceeded
        or state.retrieval.outcome == HistoricalReplay,
      state.retrieval.explanationGrounded,
      state.retrieval.citationsComplete,
      state.retrieval.resultsAuthorized,
    }

  val unsafeOutcomesProduceNoNarrative: bool =
    (state.retrieval.outcome == InsufficientEvidence
      or state.retrieval.outcome == ConflictingEvidence
      or state.retrieval.outcome == UnauthorizedEvidence
      or state.retrieval.outcome == StaleIndex
      or state.retrieval.outcome == RetrievalUnavailable) implies and {
      not(state.retrieval.materialNarrativeProduced),
      not(state.retrieval.explanationGrounded),
    }

  val historicalReplayIsStable: bool =
    state.retrieval.outcome == HistoricalReplay implies and {
      state.replayFingerprintMatches,
      state.retrieval.resultFingerprint == state.recordedRunFingerprint,
      state.retrieval.pinnedIndexId == state.recordedRunIndexId,
    }

  val ragCannotChangeDeterministicDecision: bool =
    state.deterministicDecisionFingerprint == DECISION_FINGERPRINT

  // === witnesses ===

  val activeIndexWitness: bool = state.activeIndexId != NO_INDEX
  val plannedArtifactWitness: bool =
    INDEX_IDS.exists(id => state.indexes.get(id).phase == Planned)
  val aggregateSnapshotWitness: bool =
    INDEX_IDS.exists(id => state.indexes.get(id).multipleSourceReleasesPinned)
  val machineEvalWitness: bool =
    INDEX_IDS.exists(id => state.indexes.get(id).evalAssurance == MachineEval
      and state.indexes.get(id).evalOutcome == EvalPassed)
  val failedEvalWitness: bool =
    INDEX_IDS.exists(id => state.indexes.get(id).evalOutcome == EvalFailed)
  val rollbackWitness: bool = and {
    state.activeIndexId != NO_INDEX,
    state.previousIndexId != NO_INDEX,
    state.indexes.get(state.previousIndexId).phase == Retired,
  }
  val successfulSearchWitness: bool = state.retrieval.outcome == SearchSucceeded
  val insufficientEvidenceWitness: bool = state.retrieval.outcome == InsufficientEvidence
  val conflictWitness: bool = state.retrieval.outcome == ConflictingEvidence
  val unauthorizedWitness: bool = state.retrieval.outcome == UnauthorizedEvidence
  val staleIndexWitness: bool = state.retrieval.outcome == StaleIndex
  val outageWitness: bool = state.retrieval.outcome == RetrievalUnavailable
  val replayWitness: bool = state.retrieval.outcome == HistoricalReplay
}
