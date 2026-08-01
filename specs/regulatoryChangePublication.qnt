/**
 * Executable model of the Phase 2 regulatory-change publication workflow.
 * Automated analysis may create candidates only. Named humans review the
 * event and every suggested claim impact before publication.
 */
module regulatoryChangePublication {
  type EventState = NoEvent | CandidateEvent | ReviewedEvent | PublishedEvent
  type ImpactState = NoImpact | PendingImpact | ReviewedImpact | DismissedImpact

  type ChangeState = {
    beforeVersionVerified: bool,
    afterVersionVerified: bool,
    versionsBelongToSameDocument: bool,
    diffManifestFresh: bool,
    eventState: EventState,
    eventHumanReviewRecorded: bool,
    impactState: ImpactState,
    impactHumanReviewRecorded: bool,
    claimOrCoverageMutated: bool,
  }

  var state: ChangeState

  pure def canCreateCandidate(s: ChangeState): bool = and {
    s.eventState == NoEvent,
    s.beforeVersionVerified,
    s.afterVersionVerified,
    s.versionsBelongToSameDocument,
    s.diffManifestFresh,
  }

  pure def canReviewEvent(s: ChangeState, humanReviewer: bool): bool = and {
    s.eventState == CandidateEvent,
    humanReviewer,
    s.beforeVersionVerified,
    s.afterVersionVerified,
    s.versionsBelongToSameDocument,
    s.diffManifestFresh,
  }

  pure def canReviewImpact(s: ChangeState, humanReviewer: bool): bool = and {
    s.eventState == ReviewedEvent,
    s.impactState == PendingImpact,
    humanReviewer,
    s.diffManifestFresh,
  }

  pure def canPublishEvent(s: ChangeState): bool = and {
    s.eventState == ReviewedEvent,
    s.eventHumanReviewRecorded,
    s.impactState == ReviewedImpact,
    s.impactHumanReviewRecorded,
    s.beforeVersionVerified,
    s.afterVersionVerified,
    s.versionsBelongToSameDocument,
    s.diffManifestFresh,
    not(s.claimOrCoverageMutated),
  }

  pure val serviceRoleCanDirectlyPublishEvent: bool = false
  pure val pipelineCanMutateClaimOrCoverage: bool = false

  action init: bool = {
    state' = {
      beforeVersionVerified: true,
      afterVersionVerified: true,
      versionsBelongToSameDocument: true,
      diffManifestFresh: true,
      eventState: NoEvent,
      eventHumanReviewRecorded: false,
      impactState: NoImpact,
      impactHumanReviewRecorded: false,
      claimOrCoverageMutated: false,
    }
  }

  action createCandidate: bool = all {
    canCreateCandidate(state),
    state' = { ...state, eventState: CandidateEvent, impactState: PendingImpact },
  }

  action reviewEvent(humanReviewer: bool): bool = all {
    canReviewEvent(state, humanReviewer),
    state' = { ...state, eventState: ReviewedEvent, eventHumanReviewRecorded: true },
  }

  action reviewImpact(humanReviewer: bool, affects: bool): bool = all {
    canReviewImpact(state, humanReviewer),
    state' = {
      ...state,
      impactState: if (affects) ReviewedImpact else DismissedImpact,
      impactHumanReviewRecorded: true,
    },
  }

  action publishEvent: bool = all {
    canPublishEvent(state),
    state' = { ...state, eventState: PublishedEvent },
  }

  action invalidateDiffManifest: bool = all {
    state.eventState != PublishedEvent,
    state' = { ...state, diffManifestFresh: false },
  }

  action serviceRoleDirectEventPublication: bool = all {
    serviceRoleCanDirectlyPublishEvent,
    state' = { ...state, eventState: PublishedEvent },
  }

  action mutateClaimOrCoverage: bool = all {
    pipelineCanMutateClaimOrCoverage,
    state' = { ...state, claimOrCoverageMutated: true },
  }

  // @invariant
  val publishedEventHasVerifiedVersionsAndHumanReview: bool =
    state.eventState == PublishedEvent implies and {
      state.beforeVersionVerified,
      state.afterVersionVerified,
      state.versionsBelongToSameDocument,
      state.diffManifestFresh,
      state.eventHumanReviewRecorded,
      state.impactState == ReviewedImpact,
      state.impactHumanReviewRecorded,
    }

  // @invariant
  val reviewedImpactHasNamedHumanReview: bool =
    state.impactState == ReviewedImpact implies state.impactHumanReviewRecorded

  // @invariant
  val changePipelineCannotMutateClaimOrCoverage: bool =
    and { not(pipelineCanMutateClaimOrCoverage), not(state.claimOrCoverageMutated) }

  // @invariant
  val serviceRoleHasNoDirectEventPublication: bool =
    not(serviceRoleCanDirectlyPublishEvent)

  val candidateCreatedWitness: bool = state.eventState == CandidateEvent
  val eventPublishedWitness: bool = state.eventState == PublishedEvent

  action step: bool = {
    nondet humanReviewer = Set(true, false).oneOf()
    nondet affects = Set(true, false).oneOf()
    any {
      createCandidate,
      reviewEvent(humanReviewer),
      reviewImpact(humanReviewer, affects),
      publishEvent,
      serviceRoleDirectEventPublication,
      mutateClaimOrCoverage,
    }
  }
}
