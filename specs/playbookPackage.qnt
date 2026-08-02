/**
 * Executable model of the Phase 5 MVP PlaybookPackage lifecycle.
 *
 * Requirements: master plan Phase 5 + formal spec section 9. One package
 * request flows request -> inputs confirmed -> deterministically evaluated ->
 * evidence assembled -> sealed (immutable). Capability-level conclusions,
 * never a single asset-wide answer. RAG does not exist in the MVP and is
 * deliberately absent from the model.
 *
 * Abstractions: one representative capability stands in for the matrix (the
 * per-capability rules are identical and independent); evidence quality is a
 * set of booleans the environment can degrade; version pins are booleans
 * recording that the exact release identifiers were captured at sealing.
 *
 * Safety focus:
 * - PERMITTED requires provided inputs plus direct, fresh, uncontradicted
 *   evidence; anything less degrades to CONDITIONAL / UNDETERMINED /
 *   COUNSEL_REVIEW - missing evidence can never produce certainty;
 * - a sealed package pins every version and is immutable: later evidence
 *   degradation never mutates it (monitoring supersedes instead);
 * - provisional evidence makes the whole package visibly provisional and can
 *   never be presented as human-reviewed.
 */
module playbookPackage {
  type Phase = Requested | InputsConfirmed | Evaluated | EvidenceAssembled | Sealed

  type Conclusion = NotEvaluated | Permitted | Conditional | Undetermined | CounselReview | Prohibited

  type PackageState = {
    phase: Phase,
    // capability inputs and evidence quality at evaluation time
    inputProvided: bool,
    hasDirectEvidence: bool,
    evidenceFresh: bool,
    evidenceConflicting: bool,
    evidenceProhibits: bool,
    evidenceProvisional: bool,
    conclusion: Conclusion,
    // sealing artifacts
    versionsPinned: bool,
    packageProvisional: bool,
    sealed: bool,
    supersededBy: int,
  }

  var state: PackageState

  pure def initialPackage: PackageState = {
    phase: Requested,
    inputProvided: true,
    hasDirectEvidence: true,
    evidenceFresh: true,
    evidenceConflicting: false,
    evidenceProhibits: false,
    evidenceProvisional: true,
    conclusion: NotEvaluated,
    versionsPinned: false,
    packageProvisional: false,
    sealed: false,
    supersededBy: 0,
  }

  // deterministic capability decision: the single source of conclusions
  pure def decide(s: PackageState): Conclusion =
    if (not(s.inputProvided)) Undetermined
    else if (s.evidenceConflicting) CounselReview
    else if (not(s.hasDirectEvidence)) Undetermined
    else if (s.evidenceProhibits and not(s.evidenceFresh)) CounselReview
    else if (s.evidenceProhibits) Prohibited
    else if (not(s.evidenceFresh)) Conditional
    else Permitted

  pure def canConfirmInputs(s: PackageState): bool =
    s.phase == Requested

  pure def applyConfirmInputs(s: PackageState): PackageState =
    { ...s, phase: InputsConfirmed }

  pure def canEvaluate(s: PackageState): bool =
    s.phase == InputsConfirmed

  pure def applyEvaluate(s: PackageState): PackageState =
    { ...s, phase: Evaluated, conclusion: decide(s) }

  // evidence assembly refuses to attach support to a PERMITTED conclusion the
  // current evidence no longer justifies (it degraded after evaluation)
  pure def canAssembleEvidence(s: PackageState): bool = and {
    s.phase == Evaluated,
    s.conclusion == Permitted implies decide(s) == Permitted,
  }

  pure def applyAssembleEvidence(s: PackageState): PackageState =
    { ...s, phase: EvidenceAssembled }

  pure def canSeal(s: PackageState): bool = and {
    s.phase == EvidenceAssembled,
    s.conclusion != NotEvaluated,
  }

  pure def applySeal(s: PackageState): PackageState =
    { ...s,
      phase: Sealed,
      sealed: true,
      versionsPinned: true,
      packageProvisional: s.evidenceProvisional }

  // === state machine ===

  action init = all { state' = initialPackage }

  action initFrom(s: PackageState): bool = all { state' = s }

  action confirmInputs = all {
    canConfirmInputs(state),
    state' = applyConfirmInputs(state),
  }

  action evaluate = all {
    canEvaluate(state),
    state' = applyEvaluate(state),
  }

  action assembleEvidence = all {
    canAssembleEvidence(state),
    state' = applyAssembleEvidence(state),
  }

  action seal = all {
    canSeal(state),
    state' = applySeal(state),
  }

  // environment degradation before sealing; a sealed package is immutable, so
  // degradation flips evidence flags but can never rewrite sealed results -
  // monitoring supersedes with a new package instead
  action evidenceGoesStale = all {
    state.evidenceFresh,
    state' = { ...state, evidenceFresh: false },
  }

  action conflictDiscovered = all {
    not(state.evidenceConflicting),
    state' = { ...state, evidenceConflicting: true },
  }

  action supersede = all {
    state.sealed,
    state' = { ...state, supersededBy: state.supersededBy + 1 },
  }

  action step = any {
    confirmInputs,
    evaluate,
    assembleEvidence,
    seal,
    evidenceGoesStale,
    conflictDiscovered,
    supersede,
  }

  // === invariants ===

  // certainty requires everything: inputs, direct fresh uncontradicted evidence
  val permittedRequiresFullSupport: bool =
    state.conclusion == Permitted implies and {
      state.inputProvided,
      state.hasDirectEvidence,
    }

  // a prohibition finding also demands direct evidence and inputs - stale or
  // missing evidence escalates instead of asserting a confident prohibition
  val prohibitedRequiresDirectEvidence: bool =
    state.conclusion == Prohibited implies and {
      state.inputProvided,
      state.hasDirectEvidence,
    }

  // a sealed package pinned its versions and kept its conclusion
  val sealedPackagePinsVersions: bool =
    state.sealed implies and {
      state.versionsPinned,
      state.conclusion != NotEvaluated,
    }

  // provisional evidence can never yield a non-provisional package
  val provisionalNeverHidden: bool =
    (state.sealed and state.evidenceProvisional) implies state.packageProvisional

  // conclusions only exist after deterministic evaluation
  val conclusionsComeFromEvaluation: bool =
    (state.phase == Requested or state.phase == InputsConfirmed)
      implies state.conclusion == NotEvaluated

  // === witnesses ===

  val sealedPermittedWitness: bool = and {
    state.sealed,
    state.conclusion == Permitted,
  }

  val sealedCounselReviewWitness: bool = and {
    state.sealed,
    state.conclusion == CounselReview,
  }

  val degradedBeforeAssemblyWitness: bool = and {
    state.phase == Evaluated,
    state.conclusion == Permitted,
    not(canAssembleEvidence(state)),
  }

  val supersededWitness: bool = state.supersededBy > 0
}
