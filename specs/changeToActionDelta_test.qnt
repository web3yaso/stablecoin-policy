module changeToActionDelta_test {
  import changeToActionDelta.* from "./changeToActionDelta"

  run matchingPublishedImpactCreatesFixedDeltaTest =
    init
      .then(reviewEvent(1, true))
      .then(publishEvent(1))
      .expect(and {
        state.deltas.get(1).status == ReviewRequired,
        state.deltas.get(1).cursor == 1,
        state.deltas.get(1).actions == ReviewEvidenceAndRequestRerun,
        state.deltas.get(1).customerResponse == AcknowledgeAndRerun,
      })

  run reviewedButUnpublishedImpactCreatesNoDeltaTest =
    init
      .then(reviewEvent(1, true))
      .expect(state.deltas.get(1).status == DeltaAbsent)

  run unrelatedPublishedImpactCreatesNoDeltaTest =
    init
      .then(reviewEvent(1, false))
      .then(publishEvent(1))
      .expect(and {
        state.events.get(1).state == EventPublished,
        state.deltas.get(1).status == DeltaAbsent,
        state.nextSequence == 1,
      })

  run materializationReplayKeepsIdentityTest =
    init
      .then(reviewEvent(1, true))
      .then(publishEvent(1))
      .then(replayMaterialization(1))
      .expect(and {
        state.deltas.get(1).cursor == 1,
        state.nextSequence == 2,
        EVENT_IDS.filter(id =>
          state.deltas.get(id).status == ReviewRequired).size() == 1,
        state.replayObserved,
      })

  run twoDeltasReceivePublicationOrderCursorsTest =
    init
      .then(reviewEvent(2, true))
      .then(publishEvent(2))
      .then(reviewEvent(1, true))
      .then(publishEvent(1))
      .expect(and {
        state.deltas.get(2).cursor == 1,
        state.deltas.get(1).cursor == 2,
        state.nextSequence == 3,
      })

  run cursorPagesAdvanceOneDeltaAtATimeTest =
    init
      .then(reviewEvent(1, true))
      .then(publishEvent(1))
      .then(reviewEvent(2, true))
      .then(publishEvent(2))
      .then(poll(true, 0))
      .expect(and {
        state.poll.returnedCursor == 1,
        state.poll.nextCursor == 1,
        state.poll.hasMore,
      })
      .then(poll(true, 1))
      .expect(and {
        state.poll.returnedCursor == 2,
        state.poll.nextCursor == 2,
        not(state.poll.hasMore),
      })
      .then(poll(true, 2))
      .expect(and {
        state.poll.returnedCount == 0,
        state.poll.nextCursor == 2,
        not(state.poll.hasMore),
      })

  run sameCursorReplaysSamePageTest =
    init
      .then(reviewEvent(1, true))
      .then(publishEvent(1))
      .then(poll(true, 0))
      .then(poll(true, 0))
      .expect(and {
        state.pollReplayObserved,
        state.poll.returnedCursor == 1,
        state.poll.nextCursor == 1,
      })

  run crossWatchlistCursorCannotPollTest =
    init
      .then(poll(false, 0).fail())

  run crossWatchlistCursorRejectionIsRecordedTest =
    init
      .then(rejectCrossWatchlistCursor(false))
      .expect(state.crossWatchlistCursorRejected)

  run futureCursorIsRejectedTest =
    init
      .then(poll(true, 1).fail())

  run deltaNeverMutatesHistoricalPackageTest =
    init
      .then(reviewEvent(1, true))
      .then(publishEvent(1))
      .then(poll(true, 0))
      .expect(and {
        state.packageCompleted,
        state.packageIntegrityVersion == 1,
        state.deltas.get(1).packageIntegrityVersion == 1,
      })
}
