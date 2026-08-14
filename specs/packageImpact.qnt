/**
 * Executable model of the first Phase 6 package-impact slice.
 *
 * Scope: one representative PlaybookPackage and one representative reviewed
 * claim impact coordinate through shared PostgreSQL state. Package metadata
 * and its decision-evidence dependency are registered atomically. A lookup may
 * expose the package only after the regulatory event is published and the
 * exact claim impact is reviewed.
 *
 * Out of scope: watchlists, notification transport, delivery retries,
 * re-evaluation, dossier/rule dependency expansion, and customer profiles.
 * Sets of packages and claims are covered by SQL joins and pgTAP fixtures; the
 * model isolates the state transition applying to every package/claim pair.
 */
module packageImpact {
  type PackageState = PackageAbsent | PackageCompleted
  type EventState = EventCandidate | EventReviewed | EventPublished
  type ImpactState = ImpactPending | ImpactReviewed | ImpactDismissed

  type PackageImpactState = {
    packageState: PackageState,
    dependencyIndexed: bool,
    dependencyClaimMatches: bool,
    packageIntegrityVersion: int,
    eventState: EventState,
    impactState: ImpactState,
    affectedLookupPerformed: bool,
  }

  var state: PackageImpactState

  pure def canRegisterPackage(s: PackageImpactState): bool =
    s.packageState == PackageAbsent

  pure def applyRegisterPackage(
    s: PackageImpactState,
    claimMatches: bool,
  ): PackageImpactState =
    { ...s,
      packageState: PackageCompleted,
      dependencyIndexed: true,
      dependencyClaimMatches: claimMatches,
      packageIntegrityVersion: 1 }

  pure def canReviewEvent(s: PackageImpactState): bool =
    s.eventState == EventCandidate

  pure def applyReviewEvent(s: PackageImpactState): PackageImpactState =
    { ...s, eventState: EventReviewed }

  pure def canReviewImpact(s: PackageImpactState): bool = and {
    s.eventState == EventReviewed,
    s.impactState == ImpactPending,
  }

  pure def applyReviewImpact(
    s: PackageImpactState,
    affectsClaim: bool,
  ): PackageImpactState =
    { ...s,
      impactState: if (affectsClaim) ImpactReviewed else ImpactDismissed }

  pure def canPublishEvent(s: PackageImpactState): bool = and {
    s.eventState == EventReviewed,
    s.impactState == ImpactReviewed,
  }

  pure def applyPublishEvent(s: PackageImpactState): PackageImpactState =
    { ...s, eventState: EventPublished }

  pure def canLookupAffectedPackage(s: PackageImpactState): bool = and {
    s.packageState == PackageCompleted,
    s.dependencyIndexed,
    s.dependencyClaimMatches,
    s.eventState == EventPublished,
    s.impactState == ImpactReviewed,
    not(s.affectedLookupPerformed),
  }

  pure def applyLookupAffectedPackage(
    s: PackageImpactState,
  ): PackageImpactState =
    { ...s, affectedLookupPerformed: true }

  action init: bool = {
    state' = {
      packageState: PackageAbsent,
      dependencyIndexed: false,
      dependencyClaimMatches: false,
      packageIntegrityVersion: 0,
      eventState: EventCandidate,
      impactState: ImpactPending,
      affectedLookupPerformed: false,
    }
  }

  action registerPackage(claimMatches: bool): bool = all {
    canRegisterPackage(state),
    state' = applyRegisterPackage(state, claimMatches),
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

  action lookupAffectedPackage: bool = all {
    canLookupAffectedPackage(state),
    state' = applyLookupAffectedPackage(state),
  }

  val matchingPackageIndexedWitness: bool = and {
    state.packageState == PackageCompleted,
    state.dependencyIndexed,
    state.dependencyClaimMatches,
  }

  val unrelatedPackageIndexedWitness: bool = and {
    state.packageState == PackageCompleted,
    state.dependencyIndexed,
    not(state.dependencyClaimMatches),
  }

  val eventReviewedWitness: bool = state.eventState == EventReviewed
  val impactReviewedWitness: bool = state.impactState == ImpactReviewed
  val impactDismissedWitness: bool = state.impactState == ImpactDismissed
  val eventPublishedWitness: bool = state.eventState == EventPublished
  val affectedPackageVisibleWitness: bool = state.affectedLookupPerformed

  // @invariant
  val completedPackageHasAtomicDependencyIndex: bool =
    state.packageState == PackageCompleted implies and {
      state.dependencyIndexed,
      state.packageIntegrityVersion == 1,
    }

  // @invariant
  val affectedPackageRequiresPublishedReviewedImpact: bool =
    state.affectedLookupPerformed implies and {
      state.eventState == EventPublished,
      state.impactState == ImpactReviewed,
    }

  // @invariant
  val affectedPackageRequiresExactImmutableDependency: bool =
    state.affectedLookupPerformed implies and {
      state.packageState == PackageCompleted,
      state.dependencyIndexed,
      state.dependencyClaimMatches,
      state.packageIntegrityVersion == 1,
    }

  // @invariant
  val unpublishedEventCannotAffectPackage: bool =
    state.eventState != EventPublished implies
      not(state.affectedLookupPerformed)

  action step: bool = {
    nondet claimMatches = Set(true, false).oneOf()
    nondet affectsClaim = Set(true, false).oneOf()
    any {
      registerPackage(claimMatches),
      reviewEvent,
      reviewImpact(affectsClaim),
      publishEvent,
      lookupAffectedPackage,
    }
  }
}
