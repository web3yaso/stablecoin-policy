module changeDeltaWebhook_test {
  import changeDeltaWebhook.* from "./changeDeltaWebhook"

  run materializedDeltaCreatesPendingOutboxTest =
    init
      .then(materializeDelta)
      .expect(and {
        state.deltaReady,
        state.deliveryState == DeliveryPending,
        state.eventIdentityVersion == 1,
        state.payloadVersion == 1,
      })

  run absentDeltaCannotBeClaimedTest =
    init
      .then(claimDelivery.fail())

  run claimedDeliveryHasStableSignedIdentityTest =
    init
      .then(materializeDelta)
      .then(claimDelivery)
      .expect(and {
        state.deliveryState == DeliveryLeased,
        state.eventIdentityVersion == 1,
        state.payloadVersion == 1,
        state.signatureVersion == 1,
        state.attemptCount == 1,
      })

  run successfulDeliveryHasAttemptAuditTest =
    init
      .then(materializeDelta)
      .then(claimDelivery)
      .then(recordDeliverySuccess)
      .expect(and {
        state.deliveryState == DeliveryDelivered,
        state.auditCount == 1,
        state.successAuditCount == 1,
        state.failureAuditCount == 0,
        state.citelyAcceptedCount == 1,
      })

  run retryableFailureSchedulesFutureAttemptTest =
    init
      .then(materializeDelta)
      .then(claimDelivery)
      .then(recordRetryableFailure)
      .expect(and {
        state.deliveryState == DeliveryPending,
        state.nextAttemptRound == 1,
        state.attemptCount == 1,
        state.auditCount == 1,
        state.failureAuditCount == 1,
      })
      .then(claimDelivery.fail())

  run retryBecomesClaimableWhenDueTest =
    init
      .then(materializeDelta)
      .then(claimDelivery)
      .then(recordRetryableFailure)
      .then(advanceRound)
      .then(claimDelivery)
      .expect(and {
        state.deliveryState == DeliveryLeased,
        state.attemptCount == 2,
        state.cycleAttemptCount == 2,
      })

  run retryLimitMovesDeliveryToDeadLetterTest =
    init
      .then(materializeDelta)
      .then(claimDelivery)
      .then(recordRetryableFailure)
      .then(advanceRound)
      .then(claimDelivery)
      .then(recordRetryableFailure)
      .then(advanceRound)
      .then(advanceRound)
      .then(claimDelivery)
      .then(recordRetryableFailure)
      .expect(and {
        state.deliveryState == DeliveryDeadLetter,
        state.attemptCount == 3,
        state.auditCount == 3,
        state.failureAuditCount == 3,
      })

  run permanentFailureDeadLettersImmediatelyTest =
    init
      .then(materializeDelta)
      .then(claimDelivery)
      .then(recordPermanentFailure)
      .expect(and {
        state.deliveryState == DeliveryDeadLetter,
        state.attemptCount == 1,
        state.failureAuditCount == 1,
      })

  run expiredLeaseIsAuditedAndRetriedTest =
    init
      .then(materializeDelta)
      .then(claimDelivery)
      .then(advanceRound)
      .then(advanceRound)
      .then(advanceRound)
      .then(expireLease)
      .expect(and {
        state.deliveryState == DeliveryPending,
        state.lastAttemptOutcome == AttemptLeaseExpired,
        state.nextAttemptRound == 4,
        state.auditCount == 1,
      })

  run expiredLeaseCannotReportSuccessTest =
    init
      .then(materializeDelta)
      .then(claimDelivery)
      .then(advanceRound)
      .then(advanceRound)
      .then(advanceRound)
      .then(recordDeliverySuccess.fail())

  run unauthorizedReplayIsRejectedTest =
    init
      .then(materializeDelta)
      .then(claimDelivery)
      .then(recordDeliverySuccess)
      .then(replayDelivery(false).fail())

  run authorizedReplayPreservesIdentityAndDeduplicatesTest =
    init
      .then(materializeDelta)
      .then(claimDelivery)
      .then(recordDeliverySuccess)
      .then(replayDelivery(true))
      .then(claimDelivery)
      .then(recordDeliverySuccess)
      .expect(and {
        state.deliveryState == DeliveryDelivered,
        state.replayCount == 1,
        state.attemptCount == 2,
        state.auditCount == 2,
        state.successAuditCount == 2,
        state.citelyAcceptedCount == 1,
        state.duplicateObserved,
        state.eventIdentityVersion == 1,
        state.payloadVersion == 1,
      })

  run secondDeltaMaterializationIsRejectedTest =
    init
      .then(materializeDelta)
      .then(materializeDelta.fail())
}
