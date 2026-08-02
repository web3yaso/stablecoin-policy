/**
 * Executable model of the Phase 2B machine-assurance lane.
 *
 * Product spec: docs/superpowers/specs/2026-07-31-stablecoin-policy-domain-api-
 * development-spec.md section 8.4 (accepted 2026-08-01). The machine ladder is
 *
 *   SOURCE_OBSERVED -> SOURCE_VALIDATED -> AI_EXTRACTED -> AI_CROSS_CHECKED
 *     -> PROVISIONAL_PUBLISHED
 *
 * HUMAN_REVIEWED is deliberately NOT a machine state: it is a separate upgrade
 * path, the only action that may set the human-review flags, and it always
 * requires a named human reviewer. `humanReviewActionTaken` exists purely so an
 * invariant can prove that no machine transition granted human review.
 *
 * The model covers one evidence unit's lifecycle. Deterministic check outcomes
 * are boolean flags the environment may degrade at any time (a source goes
 * stale, a contradiction is found, storage rights are revoked); publication
 * guards re-check everything, and `publishedChecksOk` snapshots the check state
 * at the moment of publication so the safety invariant survives later
 * degradation, which in the real system produces a change event rather than a
 * silent unpublish.
 *
 * Sanitized: no real legal claims, decision rules, or playbook actions.
 */
module machineAssurance {
  type MachineState =
    | SourceObserved
    | SourceValidated
    | AiExtracted
    | AiCrossChecked
    | ProvisionalPublished

  type EvidenceState = {
    machineState: MachineState,
    // deterministic check outcomes; false = failed or not currently holding
    identityChecksumOk: bool,
    rightsAllowStorage: bool,
    citationLocatorOk: bool,
    sourceFresh: bool,
    noContradiction: bool,
    crossCheckAgreed: bool,
    // every machine transition writes an immutable MachineAssuranceRecord
    assuranceRecordWritten: bool,
    // snapshot of allChecksPass at the moment of provisional publication
    publishedChecksOk: bool,
    // the separate human lane — only the human-review action touches these
    humanReviewed: bool,
    humanReviewerNamed: bool,
    humanReviewActionTaken: bool,
  }

  var state: EvidenceState

  // === functional layer ===

  pure def allChecksPass(s: EvidenceState): bool = and {
    s.identityChecksumOk,
    s.rightsAllowStorage,
    s.citationLocatorOk,
    s.sourceFresh,
    s.noContradiction,
    s.crossCheckAgreed,
  }

  pure def canValidateSource(s: EvidenceState): bool = and {
    s.machineState == SourceObserved,
    s.identityChecksumOk,
    s.rightsAllowStorage,
  }
  pure def applyValidateSource(s: EvidenceState): EvidenceState =
    { ...s, machineState: SourceValidated, assuranceRecordWritten: true }

  pure def canExtract(s: EvidenceState): bool = and {
    s.machineState == SourceValidated,
    s.citationLocatorOk,
  }
  pure def applyExtract(s: EvidenceState): EvidenceState =
    { ...s, machineState: AiExtracted, assuranceRecordWritten: true }

  pure def canCrossCheck(s: EvidenceState): bool = and {
    s.machineState == AiExtracted,
    s.crossCheckAgreed,
    s.noContradiction,
    s.sourceFresh,
  }
  pure def applyCrossCheck(s: EvidenceState): EvidenceState =
    { ...s, machineState: AiCrossChecked, assuranceRecordWritten: true }

  // publication re-checks every deterministic gate and the audit record
  pure def canPublishProvisional(s: EvidenceState): bool = and {
    s.machineState == AiCrossChecked,
    allChecksPass(s),
    s.assuranceRecordWritten,
  }
  pure def applyPublishProvisional(s: EvidenceState): EvidenceState =
    { ...s,
      machineState: ProvisionalPublished,
      publishedChecksOk: allChecksPass(s) }

  // the ONLY operation that may set the human-review flags; upgrade applies on
  // top of any machine state and never moves the machine ladder
  pure def canHumanReview(s: EvidenceState, namedHuman: bool): bool = namedHuman
  pure def applyHumanReview(s: EvidenceState): EvidenceState =
    { ...s,
      humanReviewed: true,
      humanReviewerNamed: true,
      humanReviewActionTaken: true }

  // === state machine ===

  pure val cleanStart: EvidenceState = {
    machineState: SourceObserved,
    identityChecksumOk: true,
    rightsAllowStorage: true,
    citationLocatorOk: true,
    sourceFresh: true,
    noContradiction: true,
    crossCheckAgreed: true,
    assuranceRecordWritten: false,
    publishedChecksOk: false,
    humanReviewed: false,
    humanReviewerNamed: false,
    humanReviewActionTaken: false,
  }

  // deterministic clean start; every failure mode is injected during the walk
  // by the degradation actions below, so failure paths stay explorable while
  // the happy path remains reachable under random simulation
  action init = all { state' = cleanStart }

  // deterministic entry point for scenario tests
  action initFrom(s: EvidenceState): bool = all { state' = s }

  action validateSource = all {
    canValidateSource(state),
    state' = applyValidateSource(state),
  }

  action extractClaims = all {
    canExtract(state),
    state' = applyExtract(state),
  }

  action crossCheck = all {
    canCrossCheck(state),
    state' = applyCrossCheck(state),
  }

  action publishProvisional = all {
    canPublishProvisional(state),
    state' = applyPublishProvisional(state),
  }

  action humanReviewAction(namedHuman: bool): bool = all {
    canHumanReview(state, namedHuman),
    state' = applyHumanReview(state),
  }

  // environment degradation — may happen at any point in the lifecycle
  action sourceGoesStale = all {
    state.sourceFresh,
    state' = { ...state, sourceFresh: false },
  }

  action contradictionFound = all {
    state.noContradiction,
    state' = { ...state, noContradiction: false },
  }

  action rightsRevoked = all {
    state.rightsAllowStorage,
    state' = { ...state, rightsAllowStorage: false },
  }

  action checksumMismatchFound = all {
    state.identityChecksumOk,
    state' = { ...state, identityChecksumOk: false },
  }

  action locatorInvalidated = all {
    state.citationLocatorOk,
    state' = { ...state, citationLocatorOk: false },
  }

  action step = {
    nondet namedHuman = Set(true, false).oneOf()
    any {
      validateSource,
      extractClaims,
      crossCheck,
      publishProvisional,
      humanReviewAction(namedHuman),
      sourceGoesStale,
      contradictionFound,
      rightsRevoked,
      checksumMismatchFound,
      locatorInvalidated,
    }
  }

  // === invariants ===

  // machine data can never claim human review: the flags only exist together
  // and only the named-human review action can produce them
  val machineCannotClaimHumanReview: bool = and {
    state.humanReviewed implies state.humanReviewerNamed,
    state.humanReviewed implies state.humanReviewActionTaken,
    state.humanReviewerNamed implies state.humanReviewed,
  }

  // provisional publication happened only with every check passing and the
  // assurance record written at that moment
  val provisionalRequiresFullChecks: bool =
    state.machineState == ProvisionalPublished implies
      (state.publishedChecksOk and state.assuranceRecordWritten)

  // evidence whose checks currently fail cannot be sitting one step from
  // publication with a stale green light: the publish guard re-derives
  // everything from current state, never from a cached approval
  val publishGuardIsCurrent: bool =
    canPublishProvisional(state) implies allChecksPass(state)

  // the machine ladder cannot skip validation: any state beyond observation
  // has a written assurance record
  val ladderWritesAssuranceRecords: bool =
    (state.machineState != SourceObserved) implies state.assuranceRecordWritten

  // === witnesses ===

  val sourceValidatedWitness: bool = state.machineState == SourceValidated

  val crossCheckedWitness: bool = state.machineState == AiCrossChecked

  val provisionalPublishedWitness: bool =
    state.machineState == ProvisionalPublished

  val humanUpgradeAfterProvisionalWitness: bool = and {
    state.machineState == ProvisionalPublished,
    state.humanReviewed,
  }

  // cross-checked evidence degraded before publication — the blocked path
  val degradedBeforePublicationWitness: bool = and {
    state.machineState == AiCrossChecked,
    not(allChecksPass(state)),
  }
}
