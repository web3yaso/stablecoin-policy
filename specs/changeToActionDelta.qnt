/**
 * Executable model of the first Phase 6 Change-to-Action Delta slice.
 *
 * Scope: one completed immutable PlaybookPackage, one immutable ACTIVE
 * watchlist, two reviewed regulatory events, atomic materialization of an
 * immutable delta snapshot, deterministic one-item cursor pages, and replay.
 * The two-event abstraction checks cursor ordering; relational multiplicity
 * and page limits are covered by pgTAP and TypeScript tests.
 *
 * Requirements coverage:
 * - Master Plan Phase 6: at-least-once cursor semantics and deduplication.
 * - Formal Spec Phase 6: published/reviewed impacts can produce an
 *   evidence-backed change-to-action delta without mutating old packages.
 * - Approved 2026-08-16 contract: REVIEW_REQUIRED plus fixed operational
 *   review/rerun actions; no new legal conclusion is inferred.
 *
 * Assumptions: the domain service is one actor coordinating through shared
 * PostgreSQL state, so plain Quint is used rather than Choreo. Event publish
 * and delta materialization commit atomically. Published event impacts and
 * delta snapshots are immutable. Cursor serialization and HTTP retries are
 * implementation details outside the model.
 *
 * Out of scope: webhook/email delivery, automatic reruns, customer identity,
 * entitlement persistence, package mutation, superseding evaluations,
 * notification throttling, and counsel-threshold decisions.
 *
 * Update this model before changing migration 0033 materialization or cursor
 * semantics. The model is the ground truth for that implementation boundary.
 */
module changeToActionDelta {
  type EventState = EventCandidate | EventReviewed | EventPublished
  type DeltaStatus = DeltaAbsent | ReviewRequired
  type DeltaActions = NoActions | ReviewEvidenceAndRequestRerun
  type CustomerResponse = NoResponse | AcknowledgeAndRerun

  type EventRecord = {
    state: EventState,
    impactReviewed: bool,
    exactDependency: bool,
  }

  type DeltaRecord = {
    status: DeltaStatus,
    cursor: int,
    packageIntegrityVersion: int,
    evidenceSnapshotVersion: int,
    actions: DeltaActions,
    customerResponse: CustomerResponse,
  }

  type PollRecord = {
    performed: bool,
    accepted: bool,
    afterCursor: int,
    returnedCursor: int,
    returnedCount: int,
    nextCursor: int,
    hasMore: bool,
  }

  type ChangeToActionState = {
    packageCompleted: bool,
    packageIntegrityVersion: int,
    watchlistActive: bool,
    events: int -> EventRecord,
    deltas: int -> DeltaRecord,
    nextSequence: int,
    materializationAttempts: int,
    replayObserved: bool,
    poll: PollRecord,
    pollReplayObserved: bool,
    crossWatchlistCursorRejected: bool,
  }

  pure val EVENT_IDS = Set(1, 2)

  pure val emptyEvent: EventRecord = {
    state: EventCandidate,
    impactReviewed: false,
    exactDependency: false,
  }

  pure val emptyDelta: DeltaRecord = {
    status: DeltaAbsent,
    cursor: 0,
    packageIntegrityVersion: 0,
    evidenceSnapshotVersion: 0,
    actions: NoActions,
    customerResponse: NoResponse,
  }

  pure val emptyPoll: PollRecord = {
    performed: false,
    accepted: false,
    afterCursor: 0,
    returnedCursor: 0,
    returnedCount: 0,
    nextCursor: 0,
    hasMore: false,
  }

  var state: ChangeToActionState

  pure def canReviewEvent(s: ChangeToActionState, eventId: int): bool =
    s.events.get(eventId).state == EventCandidate

  pure def applyReviewEvent(
    s: ChangeToActionState,
    eventId: int,
    exactDependency: bool,
  ): ChangeToActionState = {
    val reviewed = {
      state: EventReviewed,
      impactReviewed: true,
      exactDependency: exactDependency,
    }
    { ...s, events: s.events.set(eventId, reviewed) }
  }

  pure def canPublishEvent(s: ChangeToActionState, eventId: int): bool = and {
    s.events.get(eventId).state == EventReviewed,
    s.events.get(eventId).impactReviewed,
  }

  pure def shouldMaterialize(
    s: ChangeToActionState,
    eventId: int,
  ): bool = and {
    s.packageCompleted,
    s.watchlistActive,
    s.events.get(eventId).impactReviewed,
    s.events.get(eventId).exactDependency,
    s.deltas.get(eventId).status == DeltaAbsent,
  }

  pure def applyPublishEvent(
    s: ChangeToActionState,
    eventId: int,
  ): ChangeToActionState = {
    val event = s.events.get(eventId)
    val published = { ...event, state: EventPublished }
    val materialize = shouldMaterialize(s, eventId)
    val delta = {
      status: ReviewRequired,
      cursor: s.nextSequence,
      packageIntegrityVersion: s.packageIntegrityVersion,
      evidenceSnapshotVersion: 1,
      actions: ReviewEvidenceAndRequestRerun,
      customerResponse: AcknowledgeAndRerun,
    }
    { ...s,
      events: s.events.set(eventId, published),
      deltas: if (materialize) s.deltas.set(eventId, delta) else s.deltas,
      nextSequence: if (materialize) s.nextSequence + 1 else s.nextSequence,
      materializationAttempts: s.materializationAttempts + 1,
      poll: emptyPoll,
      pollReplayObserved: false }
  }

  pure def canReplayMaterialization(
    s: ChangeToActionState,
    eventId: int,
  ): bool = and {
    s.deltas.get(eventId).status == ReviewRequired,
    not(s.replayObserved),
  }

  pure def applyReplayMaterialization(
    s: ChangeToActionState,
  ): ChangeToActionState =
    { ...s,
      materializationAttempts: s.materializationAttempts + 1,
      replayObserved: true }

  pure def deltaEligible(
    s: ChangeToActionState,
    eventId: int,
    afterCursor: int,
  ): bool = and {
    s.deltas.get(eventId).status == ReviewRequired,
    s.deltas.get(eventId).cursor > afterCursor,
  }

  pure def nextEligibleCursor(
    s: ChangeToActionState,
    afterCursor: int,
  ): int = {
    val firstEligible = deltaEligible(s, 1, afterCursor)
    val secondEligible = deltaEligible(s, 2, afterCursor)
    if (firstEligible and secondEligible) {
      if (s.deltas.get(1).cursor < s.deltas.get(2).cursor) {
        s.deltas.get(1).cursor
      } else {
        s.deltas.get(2).cursor
      }
    } else if (firstEligible) {
      s.deltas.get(1).cursor
    } else if (secondEligible) {
      s.deltas.get(2).cursor
    } else {
      afterCursor
    }
  }

  pure def hasEligibleAfter(
    s: ChangeToActionState,
    cursor: int,
  ): bool = EVENT_IDS.exists(id => deltaEligible(s, id, cursor))

  pure def canPoll(
    s: ChangeToActionState,
    correctWatchlistBinding: bool,
    afterCursor: int,
  ): bool = and {
    correctWatchlistBinding,
    afterCursor >= 0,
    afterCursor < s.nextSequence,
  }

  pure def applyPoll(
    s: ChangeToActionState,
    afterCursor: int,
  ): ChangeToActionState = {
    val returnedCursor = nextEligibleCursor(s, afterCursor)
    val returnedCount = if (returnedCursor > afterCursor) 1 else 0
    val repeated = and {
      s.poll.performed,
      s.poll.accepted,
      s.poll.afterCursor == afterCursor,
      s.poll.returnedCursor == returnedCursor,
      s.poll.returnedCount == returnedCount,
    }
    { ...s,
      poll: {
        performed: true,
        accepted: true,
        afterCursor: afterCursor,
        returnedCursor: returnedCursor,
        returnedCount: returnedCount,
        nextCursor: returnedCursor,
        hasMore: returnedCount == 1 and hasEligibleAfter(s, returnedCursor),
      },
      pollReplayObserved: s.pollReplayObserved or repeated }
  }

  pure def canRejectCrossWatchlistCursor(
    s: ChangeToActionState,
    correctWatchlistBinding: bool,
  ): bool = and {
    not(correctWatchlistBinding),
    not(s.crossWatchlistCursorRejected),
  }

  pure def applyRejectCrossWatchlistCursor(
    s: ChangeToActionState,
  ): ChangeToActionState =
    { ...s, crossWatchlistCursorRejected: true }

  action init: bool = {
    state' = {
      packageCompleted: true,
      packageIntegrityVersion: 1,
      watchlistActive: true,
      events: EVENT_IDS.mapBy(_ => emptyEvent),
      deltas: EVENT_IDS.mapBy(_ => emptyDelta),
      nextSequence: 1,
      materializationAttempts: 0,
      replayObserved: false,
      poll: emptyPoll,
      pollReplayObserved: false,
      crossWatchlistCursorRejected: false,
    }
  }

  action reviewEvent(eventId: int, exactDependency: bool): bool = all {
    canReviewEvent(state, eventId),
    state' = applyReviewEvent(state, eventId, exactDependency),
  }

  action publishEvent(eventId: int): bool = all {
    canPublishEvent(state, eventId),
    state' = applyPublishEvent(state, eventId),
  }

  action replayMaterialization(eventId: int): bool = all {
    canReplayMaterialization(state, eventId),
    state' = applyReplayMaterialization(state),
  }

  action poll(correctWatchlistBinding: bool, afterCursor: int): bool = all {
    canPoll(state, correctWatchlistBinding, afterCursor),
    state' = applyPoll(state, afterCursor),
  }

  action rejectCrossWatchlistCursor(correctWatchlistBinding: bool): bool = all {
    canRejectCrossWatchlistCursor(state, correctWatchlistBinding),
    state' = applyRejectCrossWatchlistCursor(state),
  }

  val eventReviewedWitness: bool =
    EVENT_IDS.exists(id => state.events.get(id).state == EventReviewed)

  val matchingDeltaCreatedWitness: bool =
    EVENT_IDS.exists(id => state.deltas.get(id).status == ReviewRequired)

  val unrelatedEventPublishedWithoutDeltaWitness: bool =
    EVENT_IDS.exists(id => and {
      state.events.get(id).state == EventPublished,
      not(state.events.get(id).exactDependency),
      state.deltas.get(id).status == DeltaAbsent,
    })

  val materializationReplayWitness: bool = state.replayObserved

  val firstCursorPageWitness: bool = and {
    state.poll.accepted,
    state.poll.afterCursor == 0,
    state.poll.returnedCount == 1,
    state.poll.returnedCursor == 1,
  }

  val laterCursorPageWitness: bool = and {
    state.poll.accepted,
    state.poll.afterCursor > 0,
    state.poll.returnedCount == 1,
    state.poll.returnedCursor > state.poll.afterCursor,
  }

  val emptyCursorPageWitness: bool = and {
    state.poll.accepted,
    state.poll.returnedCount == 0,
    state.poll.nextCursor == state.poll.afterCursor,
  }

  val cursorPollReplayWitness: bool = state.pollReplayObserved

  val crossWatchlistCursorRejectedWitness: bool =
    state.crossWatchlistCursorRejected

  val materializedDeltaRequiresReviewedExactImpact: bool =
    EVENT_IDS.forall(id => implies(
      state.deltas.get(id).status == ReviewRequired,
      and {
        state.packageCompleted,
        state.watchlistActive,
        state.events.get(id).state == EventPublished,
        state.events.get(id).impactReviewed,
        state.events.get(id).exactDependency,
      }
    ))

  val materializedDeltaHasFixedOperationalResponse: bool =
    EVENT_IDS.forall(id => implies(
      state.deltas.get(id).status == ReviewRequired,
      and {
        state.deltas.get(id).actions == ReviewEvidenceAndRequestRerun,
        state.deltas.get(id).customerResponse == AcknowledgeAndRerun,
      }
    ))

  val historicalPackageIsNeverMutated: bool = and {
    state.packageCompleted,
    state.packageIntegrityVersion == 1,
  }

  val materializationReplayIsIdempotent: bool = and {
    EVENT_IDS.forall(id => implies(
      state.deltas.get(id).status == ReviewRequired,
      state.deltas.get(id).packageIntegrityVersion == 1
    )),
    EVENT_IDS.filter(id => state.deltas.get(id).status == ReviewRequired).size()
      == state.nextSequence - 1,
  }

  val deltaCursorsAreUniqueAndMonotonic: bool = and {
    EVENT_IDS.forall(id => implies(
      state.deltas.get(id).status == ReviewRequired,
      and {
        state.deltas.get(id).cursor > 0,
        state.deltas.get(id).cursor < state.nextSequence,
      }
    )),
    implies(
      state.deltas.get(1).status == ReviewRequired
        and state.deltas.get(2).status == ReviewRequired,
      state.deltas.get(1).cursor != state.deltas.get(2).cursor
    ),
  }

  val acceptedPollReturnsNextStableCursor: bool = implies(
    state.poll.accepted,
    and {
      state.poll.returnedCursor
        == nextEligibleCursor(state, state.poll.afterCursor),
      state.poll.returnedCount
        == (if (state.poll.returnedCursor > state.poll.afterCursor) 1 else 0),
      state.poll.nextCursor == state.poll.returnedCursor,
      state.poll.hasMore
        == (state.poll.returnedCount == 1
          and hasEligibleAfter(state, state.poll.returnedCursor)),
    }
  )

  val cursorNeverMovesBackward: bool = implies(
    state.poll.accepted,
    state.poll.nextCursor >= state.poll.afterCursor
  )

  action step: bool = {
    nondet eventId = EVENT_IDS.oneOf()
    nondet exactDependency = Set(true, false).oneOf()
    any {
      reviewEvent(eventId, exactDependency),
      publishEvent(eventId),
      replayMaterialization(eventId),
      poll(true, Set(0, 1, 2).oneOf()),
      rejectCrossWatchlistCursor(false),
    }
  }
}
