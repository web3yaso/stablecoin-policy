module regulatoryChangePublication_test {
  import regulatoryChangePublication.* from "./regulatoryChangePublication"

  run candidateStartsUnreviewedTest =
    init
      .then(createCandidate)
      .expect(and {
        state.eventState == CandidateEvent,
        state.impactState == PendingImpact,
        not(state.eventHumanReviewRecorded),
        not(state.impactHumanReviewRecorded),
      })

  run completeHumanReviewedChangeTest =
    init
      .then(createCandidate)
      .then(reviewEvent(true))
      .then(reviewImpact(true, true))
      .then(publishEvent)
      .expect(state.eventState == PublishedEvent)

  run automatedEventReviewerIsBlockedTest =
    init.then(createCandidate).then(reviewEvent(false).fail())

  run automatedImpactReviewerIsBlockedTest =
    init
      .then(createCandidate)
      .then(reviewEvent(true))
      .then(reviewImpact(false, true).fail())

  run dismissedImpactBlocksPublicationTest =
    init
      .then(createCandidate)
      .then(reviewEvent(true))
      .then(reviewImpact(true, false))
      .then(publishEvent.fail())

  run staleManifestBlocksPublicationTest =
    init
      .then(createCandidate)
      .then(reviewEvent(true))
      .then(reviewImpact(true, true))
      .then(invalidateDiffManifest)
      .then(publishEvent.fail())

  run serviceRoleDirectPublicationIsBlockedTest =
    init.then(serviceRoleDirectEventPublication.fail())

  run domainMutationIsBlockedTest =
    init.then(mutateClaimOrCoverage.fail())
}
