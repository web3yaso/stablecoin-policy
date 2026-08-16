module packageWatchlist_test {
  import packageWatchlist.* from "./packageWatchlist"

  run matchingPublishedImpactFindsWatchlistTest =
    init
      .then(registerPackage(true, true))
      .then(createWatchlist)
      .then(reviewEvent)
      .then(reviewImpact(true))
      .then(publishEvent)
      .then(lookupAffectedWatchlist)
      .expect(state.affectedLookupPerformed)

  run missingPackageCannotCreateWatchlistTest =
    init
      .then(createWatchlist.fail())

  run emptyDependencyPackageCannotCreateWatchlistTest =
    init
      .then(registerPackage(false, false))
      .then(createWatchlist.fail())

  run exactRetryKeepsOneStableWatchlistTest =
    init
      .then(registerPackage(true, true))
      .then(createWatchlist)
      .then(replayWatchlistCreation)
      .expect(and {
        state.watchlistState == WatchlistActive,
        state.watchlistCreateCount == 1,
        state.watchlistBindingVersion == 1,
        state.replayObserved,
      })

  run secondWatchlistCreationIsRejectedTest =
    init
      .then(registerPackage(true, true))
      .then(createWatchlist)
      .then(createWatchlist.fail())

  run candidateEventCannotExposeWatchlistTest =
    init
      .then(registerPackage(true, true))
      .then(createWatchlist)
      .then(lookupAffectedWatchlist.fail())

  run reviewedButUnpublishedEventCannotExposeWatchlistTest =
    init
      .then(registerPackage(true, true))
      .then(createWatchlist)
      .then(reviewEvent)
      .then(reviewImpact(true))
      .then(lookupAffectedWatchlist.fail())

  run dismissedImpactCannotPublishTest =
    init
      .then(registerPackage(true, true))
      .then(createWatchlist)
      .then(reviewEvent)
      .then(reviewImpact(false))
      .then(publishEvent.fail())

  run unrelatedClaimCannotExposeWatchlistTest =
    init
      .then(registerPackage(true, false))
      .then(createWatchlist)
      .then(reviewEvent)
      .then(reviewImpact(true))
      .then(publishEvent)
      .then(lookupAffectedWatchlist.fail())
}
