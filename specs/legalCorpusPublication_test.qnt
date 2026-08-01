module legalCorpusPublication_test {
  import legalCorpusPublication.* from "./legalCorpusPublication"

  run draftImportStartsUnreviewedTest =
    init.expect(and {
      state.claimState == DraftClaim,
      not(state.claimHumanReviewRecorded),
      state.releaseState == NoRelease,
      state.coverageState == CoverageInProgress,
    })

  run completeReviewedBaselineTest =
    init
      .then(verifySource(true))
      .then(submitClaimForReview)
      .then(reviewClaim(true))
      .then(createRelease)
      .then(submitReleaseForReview)
      .then(reviewRelease(true))
      .then(publishRelease)
      .then(reviewCoverage(true))
      .expect(state.coverageState == ReviewedCoverage)

  run automatedSourceReviewerIsBlockedTest =
    init.then(verifySource(false).fail())

  run automatedClaimReviewerIsBlockedTest =
    init
      .then(verifySource(true))
      .then(submitClaimForReview)
      .then(reviewClaim(false).fail())

  run automatedReleaseReviewerIsBlockedTest =
    init
      .then(verifySource(true))
      .then(submitClaimForReview)
      .then(reviewClaim(true))
      .then(createRelease)
      .then(submitReleaseForReview)
      .then(reviewRelease(false).fail())

  run automatedCoverageReviewerIsBlockedTest =
    init
      .then(verifySource(true))
      .then(submitClaimForReview)
      .then(reviewClaim(true))
      .then(createRelease)
      .then(submitReleaseForReview)
      .then(reviewRelease(true))
      .then(publishRelease)
      .then(reviewCoverage(false).fail())

  run staleSourceFingerprintRollsBackTest =
    init
      .then(invalidateSourceManifest)
      .expect(and {
        state.sourceState == Observed,
        not(state.sourceHumanReviewRecorded),
        not(canVerifySource(state, true)),
      })

  run staleClaimFingerprintRollsBackTest =
    init
      .then(verifySource(true))
      .then(submitClaimForReview)
      .then(invalidateClaimManifest)
      .expect(and {
        state.claimState == ClaimInReview,
        not(state.claimHumanReviewRecorded),
        not(canReviewClaim(state, true)),
      })

  run staleReleaseFingerprintRollsBackTest =
    init
      .then(verifySource(true))
      .then(submitClaimForReview)
      .then(reviewClaim(true))
      .then(createRelease)
      .then(submitReleaseForReview)
      .then(invalidateReleaseManifest)
      .expect(and {
        state.releaseState == ReleaseInReview,
        not(state.releaseHumanReviewRecorded),
        not(canReviewRelease(state, true)),
      })

  run staleCoverageFingerprintRollsBackTest =
    init
      .then(verifySource(true))
      .then(submitClaimForReview)
      .then(reviewClaim(true))
      .then(createRelease)
      .then(submitReleaseForReview)
      .then(reviewRelease(true))
      .then(publishRelease)
      .then(invalidateCoverageManifest)
      .expect(and {
        state.coverageState == CoverageInProgress,
        not(state.coverageHumanReviewRecorded),
        not(canReviewCoverage(state, true)),
      })

  run coverageRequiresPublishedCorpusTest =
    init
      .expect(not(canReviewCoverage(state, true)))

  run serviceRoleDirectCoverageWriteIsBlockedTest =
    init.then(serviceRoleDirectCoverageMutation.fail())
}
