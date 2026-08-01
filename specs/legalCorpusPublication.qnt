/**
 * Executable model of the Phase 2 reviewed-evidence publication workflow.
 *
 * This model intentionally covers the public legal-corpus lifecycle only. It
 * does not model private DecisionRule or PlaybookAction data.
 */
module legalCorpusPublication {
  type SourceState = Observed | Verified
  type ClaimState = DraftClaim | ClaimInReview | ReviewedClaim
  type ReleaseState = NoRelease | DraftRelease | ReleaseInReview | ReviewedRelease | PublishedRelease
  type CoverageState = CoverageInProgress | ReviewedCoverage

  type PublicationState = {
    sourceState: SourceState,
    sourceRightsReviewed: bool,
    sourceHasProvisions: bool,
    sourcePermissionsKnown: bool,
    sourceManifestFresh: bool,
    sourceHumanReviewRecorded: bool,

    claimState: ClaimState,
    claimHasCitations: bool,
    claimHasDirectSupport: bool,
    claimHasNoConflict: bool,
    claimManifestFresh: bool,
    claimHumanReviewRecorded: bool,

    releaseState: ReleaseState,
    releaseHasMembership: bool,
    releaseWithinCutoff: bool,
    releaseManifestFresh: bool,
    releaseHumanReviewRecorded: bool,

    checklistComplete: bool,
    sourcesFreshAtCutoff: bool,
    coverageManifestFresh: bool,
    coverageState: CoverageState,
    coverageHumanReviewRecorded: bool,
  }

  var state: PublicationState

  pure def canVerifySource(s: PublicationState, humanReviewer: bool): bool = and {
    s.sourceState == Observed,
    humanReviewer,
    s.sourceRightsReviewed,
    s.sourceHasProvisions,
    s.sourcePermissionsKnown,
    s.sourceManifestFresh,
  }

  pure def applyVerifySource(s: PublicationState): PublicationState =
    { ...s, sourceState: Verified, sourceHumanReviewRecorded: true }

  pure def canSubmitClaim(s: PublicationState): bool = and {
    s.claimState == DraftClaim,
    s.claimHasCitations,
  }

  pure def applySubmitClaim(s: PublicationState): PublicationState =
    { ...s, claimState: ClaimInReview }

  pure def canReviewClaim(s: PublicationState, humanReviewer: bool): bool = and {
    s.claimState == ClaimInReview,
    humanReviewer,
    s.sourceState == Verified,
    s.sourceHumanReviewRecorded,
    s.claimHasCitations,
    s.claimHasDirectSupport,
    s.claimHasNoConflict,
    s.claimManifestFresh,
  }

  pure def applyReviewClaim(s: PublicationState): PublicationState =
    { ...s, claimState: ReviewedClaim, claimHumanReviewRecorded: true }

  pure def canCreateRelease(s: PublicationState): bool =
    s.releaseState == NoRelease

  pure def applyCreateRelease(s: PublicationState): PublicationState =
    { ...s, releaseState: DraftRelease }

  pure def canSubmitRelease(s: PublicationState): bool = and {
    s.releaseState == DraftRelease,
    s.releaseHasMembership,
  }

  pure def applySubmitRelease(s: PublicationState): PublicationState =
    { ...s, releaseState: ReleaseInReview }

  pure def canReviewRelease(s: PublicationState, humanReviewer: bool): bool = and {
    s.releaseState == ReleaseInReview,
    humanReviewer,
    s.claimState == ReviewedClaim,
    s.claimHumanReviewRecorded,
    s.releaseHasMembership,
    s.releaseWithinCutoff,
    s.releaseManifestFresh,
  }

  pure def applyReviewRelease(s: PublicationState): PublicationState =
    { ...s, releaseState: ReviewedRelease, releaseHumanReviewRecorded: true }

  pure def canPublishRelease(s: PublicationState): bool = and {
    s.releaseState == ReviewedRelease,
    s.releaseHumanReviewRecorded,
    s.claimState == ReviewedClaim,
    s.claimHumanReviewRecorded,
    s.releaseManifestFresh,
  }

  pure def applyPublishRelease(s: PublicationState): PublicationState =
    { ...s, releaseState: PublishedRelease }

  pure def canReviewCoverage(s: PublicationState, humanReviewer: bool): bool = and {
    s.coverageState == CoverageInProgress,
    humanReviewer,
    s.releaseState == PublishedRelease,
    s.releaseHumanReviewRecorded,
    s.checklistComplete,
    s.sourcesFreshAtCutoff,
    s.coverageManifestFresh,
  }

  pure def applyReviewCoverage(s: PublicationState): PublicationState =
    { ...s, coverageState: ReviewedCoverage, coverageHumanReviewRecorded: true }

  pure val serviceRoleCanDirectlyMutateCoverage: bool = false

  action init: bool = {
    state' = {
      sourceState: Observed,
      sourceRightsReviewed: true,
      sourceHasProvisions: true,
      sourcePermissionsKnown: true,
      sourceManifestFresh: true,
      sourceHumanReviewRecorded: false,

      claimState: DraftClaim,
      claimHasCitations: true,
      claimHasDirectSupport: true,
      claimHasNoConflict: true,
      claimManifestFresh: true,
      claimHumanReviewRecorded: false,

      releaseState: NoRelease,
      releaseHasMembership: true,
      releaseWithinCutoff: true,
      releaseManifestFresh: true,
      releaseHumanReviewRecorded: false,

      checklistComplete: true,
      sourcesFreshAtCutoff: true,
      coverageManifestFresh: true,
      coverageState: CoverageInProgress,
      coverageHumanReviewRecorded: false,
    }
  }

  action verifySource(humanReviewer: bool): bool = all {
    canVerifySource(state, humanReviewer),
    state' = applyVerifySource(state),
  }

  action submitClaimForReview: bool = all {
    canSubmitClaim(state),
    state' = applySubmitClaim(state),
  }

  action reviewClaim(humanReviewer: bool): bool = all {
    canReviewClaim(state, humanReviewer),
    state' = applyReviewClaim(state),
  }

  action createRelease: bool = all {
    canCreateRelease(state),
    state' = applyCreateRelease(state),
  }

  action submitReleaseForReview: bool = all {
    canSubmitRelease(state),
    state' = applySubmitRelease(state),
  }

  action reviewRelease(humanReviewer: bool): bool = all {
    canReviewRelease(state, humanReviewer),
    state' = applyReviewRelease(state),
  }

  action publishRelease: bool = all {
    canPublishRelease(state),
    state' = applyPublishRelease(state),
  }

  action reviewCoverage(humanReviewer: bool): bool = all {
    canReviewCoverage(state, humanReviewer),
    state' = applyReviewCoverage(state),
  }

  action serviceRoleDirectCoverageMutation: bool = all {
    serviceRoleCanDirectlyMutateCoverage,
    state' = { ...state, coverageState: ReviewedCoverage },
  }

  action invalidateSourceManifest: bool = all {
    state.sourceState == Observed,
    state' = { ...state, sourceManifestFresh: false },
  }

  action invalidateClaimManifest: bool = all {
    state.claimState == ClaimInReview,
    state' = { ...state, claimManifestFresh: false },
  }

  action invalidateReleaseManifest: bool = all {
    state.releaseState == ReleaseInReview,
    state' = { ...state, releaseManifestFresh: false },
  }

  action invalidateCoverageManifest: bool = all {
    state.coverageState == CoverageInProgress,
    state' = { ...state, coverageManifestFresh: false },
  }

  // @invariant
  val verifiedSourceHasHumanReviewedEvidence: bool =
    state.sourceState == Verified implies and {
      state.sourceHumanReviewRecorded,
      state.sourceRightsReviewed,
      state.sourceHasProvisions,
      state.sourcePermissionsKnown,
    }

  // @invariant
  val reviewedClaimHasVerifiedDirectSupport: bool =
    state.claimState == ReviewedClaim implies and {
      state.claimHumanReviewRecorded,
      state.sourceState == Verified,
      state.sourceHumanReviewRecorded,
      state.claimHasCitations,
      state.claimHasDirectSupport,
      state.claimHasNoConflict,
    }

  // @invariant
  val publishedReleaseHasCurrentHumanApproval: bool =
    state.releaseState == PublishedRelease implies and {
      state.releaseHumanReviewRecorded,
      state.claimState == ReviewedClaim,
      state.claimHumanReviewRecorded,
      state.releaseHasMembership,
      state.releaseWithinCutoff,
      state.releaseManifestFresh,
    }

  // @invariant
  val reviewedCoverageHasCompleteReviewedBaseline: bool =
    state.coverageState == ReviewedCoverage implies and {
      state.coverageHumanReviewRecorded,
      state.releaseState == PublishedRelease,
      state.releaseHumanReviewRecorded,
      state.checklistComplete,
      state.sourcesFreshAtCutoff,
      state.coverageManifestFresh,
    }

  // @invariant
  val serviceRoleHasNoDirectCoverageWrite: bool =
    not(serviceRoleCanDirectlyMutateCoverage)

  val sourceVerifiedWitness: bool = state.sourceState == Verified
  val claimReviewedWitness: bool = state.claimState == ReviewedClaim
  val releasePublishedWitness: bool = state.releaseState == PublishedRelease
  val coverageReviewedWitness: bool = state.coverageState == ReviewedCoverage

  action step: bool = {
    nondet humanReviewer = Set(true, false).oneOf()
    any {
      verifySource(humanReviewer),
      submitClaimForReview,
      reviewClaim(humanReviewer),
      createRelease,
      submitReleaseForReview,
      reviewRelease(humanReviewer),
      publishRelease,
      reviewCoverage(humanReviewer),
      serviceRoleDirectCoverageMutation,
    }
  }
}
