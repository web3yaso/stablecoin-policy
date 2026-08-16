/**
 * Executable model of the first Phase 6 package-watchlist slice.
 *
 * Scope: one representative immutable PlaybookPackage, its exact decision-
 * evidence dependency set, one immutable ACTIVE watchlist, and one reviewed
 * claim impact coordinate through shared PostgreSQL state. Watchlist creation
 * is idempotent by package and affected lookup is private and fail-closed.
 *
 * Assumptions: the domain service is one actor coordinating through shared
 * database state; package registration, watchlist creation, and each review
 * transition are atomic. Relational multiplicity is covered by pgTAP.
 *
 * Out of scope: customer and subscription identity, entitlement persistence,
 * webhook destinations, delivery retries, pause/close/reactivate transitions,
 * superseding evaluations, and dossier/rule dependency edges.
 */
module packageWatchlist {
  type PackageState = PackageMissing | PackageCompleted
  type WatchlistState = WatchlistNone | WatchlistActive
  type EventState = EventCandidate | EventReviewed | EventPublished
  type ImpactState = ImpactPending | ImpactReviewed | ImpactDismissed

  type PackageWatchlistState = {
    packageState: PackageState,
    dependencyIndexed: bool,
    dependencyCount: int,
    dependencyClaimMatches: bool,
    packageIntegrityVersion: int,
    watchlistState: WatchlistState,
    watchlistBindingVersion: int,
    watchlistCreateCount: int,
    replayObserved: bool,
    eventState: EventState,
    impactState: ImpactState,
    affectedLookupPerformed: bool,
  }

  var state: PackageWatchlistState

  pure def canRegisterPackage(s: PackageWatchlistState): bool =
    s.packageState == PackageMissing

  pure def applyRegisterPackage(
    s: PackageWatchlistState,
    hasDependencies: bool,
    claimMatches: bool,
  ): PackageWatchlistState =
    { ...s,
      packageState: PackageCompleted,
      dependencyIndexed: true,
      dependencyCount: if (hasDependencies) 1 else 0,
      dependencyClaimMatches: hasDependencies and claimMatches,
      packageIntegrityVersion: 1 }

  pure def canCreateWatchlist(s: PackageWatchlistState): bool = and {
    s.packageState == PackageCompleted,
    s.dependencyIndexed,
    s.dependencyCount > 0,
    s.watchlistState == WatchlistNone,
  }

  pure def applyCreateWatchlist(
    s: PackageWatchlistState,
  ): PackageWatchlistState =
    { ...s,
      watchlistState: WatchlistActive,
      watchlistBindingVersion: 1,
      watchlistCreateCount: 1 }

  pure def canReplayWatchlistCreation(s: PackageWatchlistState): bool = and {
    s.watchlistState == WatchlistActive,
    not(s.replayObserved),
  }

  pure def applyReplayWatchlistCreation(
    s: PackageWatchlistState,
  ): PackageWatchlistState =
    { ...s, replayObserved: true }

  pure def canReviewEvent(s: PackageWatchlistState): bool =
    s.eventState == EventCandidate

  pure def applyReviewEvent(s: PackageWatchlistState): PackageWatchlistState =
    { ...s, eventState: EventReviewed }

  pure def canReviewImpact(s: PackageWatchlistState): bool = and {
    s.eventState == EventReviewed,
    s.impactState == ImpactPending,
  }

  pure def applyReviewImpact(
    s: PackageWatchlistState,
    affectsClaim: bool,
  ): PackageWatchlistState =
    { ...s,
      impactState: if (affectsClaim) ImpactReviewed else ImpactDismissed }

  pure def canPublishEvent(s: PackageWatchlistState): bool = and {
    s.eventState == EventReviewed,
    s.impactState == ImpactReviewed,
  }

  pure def applyPublishEvent(s: PackageWatchlistState): PackageWatchlistState =
    { ...s, eventState: EventPublished }

  pure def canLookupAffectedWatchlist(s: PackageWatchlistState): bool = and {
    s.watchlistState == WatchlistActive,
    s.dependencyClaimMatches,
    s.eventState == EventPublished,
    s.impactState == ImpactReviewed,
    not(s.affectedLookupPerformed),
  }

  pure def applyLookupAffectedWatchlist(
    s: PackageWatchlistState,
  ): PackageWatchlistState =
    { ...s, affectedLookupPerformed: true }

  action init: bool = {
    state' = {
      packageState: PackageMissing,
      dependencyIndexed: false,
      dependencyCount: 0,
      dependencyClaimMatches: false,
      packageIntegrityVersion: 0,
      watchlistState: WatchlistNone,
      watchlistBindingVersion: 0,
      watchlistCreateCount: 0,
      replayObserved: false,
      eventState: EventCandidate,
      impactState: ImpactPending,
      affectedLookupPerformed: false,
    }
  }

  action registerPackage(hasDependencies: bool, claimMatches: bool): bool = all {
    canRegisterPackage(state),
    state' = applyRegisterPackage(state, hasDependencies, claimMatches),
  }

  action createWatchlist: bool = all {
    canCreateWatchlist(state),
    state' = applyCreateWatchlist(state),
  }

  action replayWatchlistCreation: bool = all {
    canReplayWatchlistCreation(state),
    state' = applyReplayWatchlistCreation(state),
  }

  action reviewEvent: bool = all {
    canReviewEvent(state),
    state' = applyReviewEvent(state),
  }

  action reviewImpact(affectsClaim: bool): bool = all {
    canReviewImpact(state),
    state' = applyReviewImpact(state, affectsClaim),
  }

  action publishEvent: bool = all {
    canPublishEvent(state),
    state' = applyPublishEvent(state),
  }

  action lookupAffectedWatchlist: bool = all {
    canLookupAffectedWatchlist(state),
    state' = applyLookupAffectedWatchlist(state),
  }

  val packageWithDependenciesWitness: bool = and {
    state.packageState == PackageCompleted,
    state.dependencyCount > 0,
  }
  val packageWithoutDependenciesWitness: bool = and {
    state.packageState == PackageCompleted,
    state.dependencyCount == 0,
  }
  val activeWatchlistWitness: bool =
    state.watchlistState == WatchlistActive
  val idempotentReplayWitness: bool = state.replayObserved
  val eventReviewedWitness: bool = state.eventState == EventReviewed
  val impactReviewedWitness: bool = state.impactState == ImpactReviewed
  val impactDismissedWitness: bool = state.impactState == ImpactDismissed
  val eventPublishedWitness: bool = state.eventState == EventPublished
  val affectedWatchlistVisibleWitness: bool = state.affectedLookupPerformed

  // @invariant
  val activeWatchlistRequiresCompletedDependency: bool =
    state.watchlistState == WatchlistActive implies and {
      state.packageState == PackageCompleted,
      state.dependencyIndexed,
      state.dependencyCount > 0,
      state.packageIntegrityVersion == 1,
    }

  // @invariant
  val oneWatchlistPerPackageAndStableBinding: bool = and {
    state.watchlistCreateCount >= 0,
    state.watchlistCreateCount <= 1,
    state.watchlistState == WatchlistActive implies and {
      state.watchlistCreateCount == 1,
      state.watchlistBindingVersion == 1,
    },
    state.replayObserved implies and {
      state.watchlistCreateCount == 1,
      state.watchlistBindingVersion == 1,
    },
  }

  // @invariant
  val affectedWatchlistRequiresPublishedReviewedImpact: bool =
    state.affectedLookupPerformed implies and {
      state.eventState == EventPublished,
      state.impactState == ImpactReviewed,
    }

  // @invariant
  val affectedWatchlistRequiresExactDependency: bool =
    state.affectedLookupPerformed implies and {
      state.watchlistState == WatchlistActive,
      state.packageState == PackageCompleted,
      state.dependencyIndexed,
      state.dependencyCount > 0,
      state.dependencyClaimMatches,
      state.packageIntegrityVersion == 1,
      state.watchlistBindingVersion == 1,
    }

  // @invariant
  val unpublishedEventCannotExposeWatchlist: bool =
    state.eventState != EventPublished implies
      not(state.affectedLookupPerformed)

  action step: bool = {
    nondet hasDependencies = Set(true, false).oneOf()
    nondet claimMatches = Set(true, false).oneOf()
    nondet affectsClaim = Set(true, false).oneOf()
    any {
      registerPackage(hasDependencies, claimMatches),
      createWatchlist,
      replayWatchlistCreation,
      reviewEvent,
      reviewImpact(affectsClaim),
      publishEvent,
      lookupAffectedWatchlist,
    }
  }
}
