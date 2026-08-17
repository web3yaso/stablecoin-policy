/**
 * Executable model of Phase 6 Change-to-Action webhook delivery.
 *
 * The model starts with no delta. Materializing one immutable delta atomically
 * creates one PENDING outbox entry. Later revisions of this model add the
 * bounded lease/retry/audit/replay protocol before migration 0034 is written.
 *
 * Actors: one Stablecoin Policy dispatcher and one Citely receiver. The
 * protocol is deliberately modelled in plain Quint: there are two fixed actors
 * and no message ordering or distributed consensus property. HTTP transport,
 * HMAC cryptography, and relational multiplicity remain implementation tests.
 */
module changeDeltaWebhook {
  pure val MAX_ATTEMPTS = 3
  pure val LEASE_ROUNDS = 2
  pure val MAX_ROUND = 12

  type DeliveryState =
    DeliveryAbsent | DeliveryPending | DeliveryLeased |
    DeliveryDelivered | DeliveryDeadLetter

  type AttemptOutcome =
    NoAttemptOutcome | AttemptSucceeded | AttemptRetryableFailure |
    AttemptPermanentFailure | AttemptLeaseExpired

  type WebhookDeliveryState = {
    deltaReady: bool,
    packageIntegrityVersion: int,
    deliveryState: DeliveryState,
    eventIdentityVersion: int,
    payloadVersion: int,
    signatureVersion: int,
    round: int,
    nextAttemptRound: int,
    lastFailureRound: int,
    leaseExpiresRound: int,
    attemptCount: int,
    cycleAttemptCount: int,
    auditCount: int,
    successAuditCount: int,
    failureAuditCount: int,
    replayCount: int,
    citelyAcceptedCount: int,
    duplicateObserved: bool,
    lastAttemptOutcome: AttemptOutcome,
  }

  var state: WebhookDeliveryState

  pure def canMaterializeDelta(s: WebhookDeliveryState): bool =
    not(s.deltaReady) and s.deliveryState == DeliveryAbsent

  pure def applyMaterializeDelta(
    s: WebhookDeliveryState,
  ): WebhookDeliveryState =
    { ...s,
      deltaReady: true,
      packageIntegrityVersion: 1,
      deliveryState: DeliveryPending,
      eventIdentityVersion: 1,
      payloadVersion: 1,
      nextAttemptRound: s.round }

  pure def canClaimDelivery(s: WebhookDeliveryState): bool = and {
    s.deliveryState == DeliveryPending,
    s.round >= s.nextAttemptRound,
    s.attemptCount < MAX_ATTEMPTS,
  }

  pure def applyClaimDelivery(
    s: WebhookDeliveryState,
  ): WebhookDeliveryState =
    { ...s,
      deliveryState: DeliveryLeased,
      signatureVersion: 1,
      leaseExpiresRound: s.round + LEASE_ROUNDS,
      attemptCount: s.attemptCount + 1,
      cycleAttemptCount: s.cycleAttemptCount + 1,
      lastAttemptOutcome: NoAttemptOutcome }

  pure def canCompleteActiveLease(s: WebhookDeliveryState): bool = and {
    s.deliveryState == DeliveryLeased,
    s.round <= s.leaseExpiresRound,
  }

  pure def applyDeliverySuccess(
    s: WebhookDeliveryState,
  ): WebhookDeliveryState =
    { ...s,
      deliveryState: DeliveryDelivered,
      auditCount: s.auditCount + 1,
      successAuditCount: s.successAuditCount + 1,
      citelyAcceptedCount: if (s.citelyAcceptedCount == 0) 1
                           else s.citelyAcceptedCount,
      duplicateObserved: s.duplicateObserved or s.citelyAcceptedCount == 1,
      lastAttemptOutcome: AttemptSucceeded }

  pure def applyRetryableFailure(
    s: WebhookDeliveryState,
  ): WebhookDeliveryState = {
    val exhausted = s.cycleAttemptCount >= MAX_ATTEMPTS
    { ...s,
      deliveryState: if (exhausted) DeliveryDeadLetter else DeliveryPending,
      nextAttemptRound: if (exhausted) s.round
                        else s.round + s.cycleAttemptCount,
      lastFailureRound: s.round,
      leaseExpiresRound: 0,
      auditCount: s.auditCount + 1,
      failureAuditCount: s.failureAuditCount + 1,
      lastAttemptOutcome: AttemptRetryableFailure }
  }

  pure def applyPermanentFailure(
    s: WebhookDeliveryState,
  ): WebhookDeliveryState =
    { ...s,
      deliveryState: DeliveryDeadLetter,
      leaseExpiresRound: 0,
      auditCount: s.auditCount + 1,
      failureAuditCount: s.failureAuditCount + 1,
      lastAttemptOutcome: AttemptPermanentFailure }

  pure def canExpireLease(s: WebhookDeliveryState): bool = and {
    s.deliveryState == DeliveryLeased,
    s.round > s.leaseExpiresRound,
  }

  pure def applyExpireLease(
    s: WebhookDeliveryState,
  ): WebhookDeliveryState = {
    val exhausted = s.cycleAttemptCount >= MAX_ATTEMPTS
    { ...s,
      deliveryState: if (exhausted) DeliveryDeadLetter else DeliveryPending,
      nextAttemptRound: if (exhausted) s.round
                        else s.round + s.cycleAttemptCount,
      lastFailureRound: s.round,
      leaseExpiresRound: 0,
      auditCount: s.auditCount + 1,
      failureAuditCount: s.failureAuditCount + 1,
      lastAttemptOutcome: AttemptLeaseExpired }
  }

  pure def canAdvanceRound(s: WebhookDeliveryState): bool =
    s.round < MAX_ROUND

  pure def applyAdvanceRound(
    s: WebhookDeliveryState,
  ): WebhookDeliveryState =
    { ...s, round: s.round + 1 }

  pure def canReplayDelivery(
    s: WebhookDeliveryState,
    operatorAuthorized: bool,
  ): bool = and {
    operatorAuthorized,
    Set(DeliveryDelivered, DeliveryDeadLetter).contains(s.deliveryState),
  }

  pure def applyReplayDelivery(
    s: WebhookDeliveryState,
  ): WebhookDeliveryState =
    { ...s,
      deliveryState: DeliveryPending,
      nextAttemptRound: s.round,
      lastFailureRound: 0,
      leaseExpiresRound: 0,
      cycleAttemptCount: 0,
      replayCount: s.replayCount + 1,
      lastAttemptOutcome: NoAttemptOutcome }

  action init: bool = {
    state' = {
      deltaReady: false,
      packageIntegrityVersion: 0,
      deliveryState: DeliveryAbsent,
      eventIdentityVersion: 0,
      payloadVersion: 0,
      signatureVersion: 0,
      round: 0,
      nextAttemptRound: 0,
      lastFailureRound: 0,
      leaseExpiresRound: 0,
      attemptCount: 0,
      cycleAttemptCount: 0,
      auditCount: 0,
      successAuditCount: 0,
      failureAuditCount: 0,
      replayCount: 0,
      citelyAcceptedCount: 0,
      duplicateObserved: false,
      lastAttemptOutcome: NoAttemptOutcome,
    }
  }

  action materializeDelta: bool = all {
    canMaterializeDelta(state),
    state' = applyMaterializeDelta(state),
  }

  action claimDelivery: bool = all {
    canClaimDelivery(state),
    state' = applyClaimDelivery(state),
  }

  action recordDeliverySuccess: bool = all {
    canCompleteActiveLease(state),
    state' = applyDeliverySuccess(state),
  }

  action recordRetryableFailure: bool = all {
    canCompleteActiveLease(state),
    state' = applyRetryableFailure(state),
  }

  action recordPermanentFailure: bool = all {
    canCompleteActiveLease(state),
    state' = applyPermanentFailure(state),
  }

  action expireLease: bool = all {
    canExpireLease(state),
    state' = applyExpireLease(state),
  }

  action advanceRound: bool = all {
    canAdvanceRound(state),
    state' = applyAdvanceRound(state),
  }

  action replayDelivery(operatorAuthorized: bool): bool = all {
    canReplayDelivery(state, operatorAuthorized),
    state' = applyReplayDelivery(state),
  }

  val outboxCreatedWitness: bool =
    state.deliveryState == DeliveryPending
  val deliveryLeasedWitness: bool =
    state.deliveryState == DeliveryLeased
  val deliverySucceededWitness: bool =
    state.deliveryState == DeliveryDelivered
  val retryScheduledWitness: bool = and {
    state.deliveryState == DeliveryPending,
    state.lastAttemptOutcome == AttemptRetryableFailure,
  }
  val retryExhaustedWitness: bool = and {
    state.deliveryState == DeliveryDeadLetter,
    state.lastAttemptOutcome == AttemptRetryableFailure,
  }
  val permanentFailureWitness: bool = and {
    state.deliveryState == DeliveryDeadLetter,
    state.lastAttemptOutcome == AttemptPermanentFailure,
  }
  val leaseExpiredWitness: bool =
    state.lastAttemptOutcome == AttemptLeaseExpired
  val replayScheduledWitness: bool = state.replayCount == 1
  val duplicateDeliveryWitness: bool = state.duplicateObserved

  // @invariant
  val outboxRequiresImmutableDelta: bool =
    state.deliveryState != DeliveryAbsent implies and {
      state.deltaReady,
      state.packageIntegrityVersion == 1,
      state.eventIdentityVersion == 1,
      state.payloadVersion == 1,
    }

  // @invariant
  val activeOrFinishedDeliveryHasSignedAttempt: bool =
    Set(DeliveryLeased, DeliveryDelivered, DeliveryDeadLetter)
      .contains(state.deliveryState) implies and {
        state.attemptCount > 0,
        state.signatureVersion == 1,
      }

  // @invariant
  val deliveredRequiresSuccessfulAudit: bool =
    state.deliveryState == DeliveryDelivered implies and {
      state.auditCount > 0,
      state.successAuditCount > 0,
      state.lastAttemptOutcome == AttemptSucceeded,
    }

  // @invariant
  val citelyAcceptsEventAtMostOnce: bool = and {
    state.citelyAcceptedCount >= 0,
    state.citelyAcceptedCount <= 1,
  }

  // @invariant
  val attemptAuditIsCompleteAndAppendOnly: bool = and {
    state.auditCount == state.successAuditCount + state.failureAuditCount,
    state.auditCount <= state.attemptCount,
    state.deliveryState == DeliveryLeased implies
      state.auditCount == state.attemptCount - 1,
    state.deliveryState != DeliveryLeased implies
      state.auditCount == state.attemptCount,
  }

  // @invariant
  val failureNeverMarksDelivered: bool =
    Set(
      AttemptRetryableFailure,
      AttemptPermanentFailure,
      AttemptLeaseExpired
    ).contains(state.lastAttemptOutcome) implies
      state.deliveryState != DeliveryDelivered

  // @invariant
  val retriesAreBoundedAndScheduled: bool = and {
    state.cycleAttemptCount >= 0,
    state.cycleAttemptCount <= MAX_ATTEMPTS,
    state.deliveryState == DeliveryPending
      and Set(AttemptRetryableFailure, AttemptLeaseExpired)
        .contains(state.lastAttemptOutcome) implies
          state.nextAttemptRound > state.lastFailureRound,
    state.deliveryState == DeliveryDeadLetter
      and Set(AttemptRetryableFailure, AttemptLeaseExpired)
        .contains(state.lastAttemptOutcome) implies
          state.cycleAttemptCount == MAX_ATTEMPTS,
  }

  // @invariant
  val replayPreservesIdentityAndDeduplicates: bool = and {
    state.replayCount > 0 implies and {
      state.deltaReady,
      state.packageIntegrityVersion == 1,
      state.eventIdentityVersion == 1,
      state.payloadVersion == 1,
    },
    state.duplicateObserved implies and {
      state.replayCount > 0,
      state.citelyAcceptedCount == 1,
      state.successAuditCount >= 2,
    },
  }

  // @invariant
  val historicalPackageIsNeverMutated: bool =
    state.deltaReady implies state.packageIntegrityVersion == 1

  action step: bool = {
    nondet operatorAuthorized = Set(true, false).oneOf()
    any {
      materializeDelta,
      claimDelivery,
      recordDeliverySuccess,
      recordRetryableFailure,
      recordPermanentFailure,
      expireLease,
      advanceRound,
      replayDelivery(operatorAuthorized),
    }
  }
}
