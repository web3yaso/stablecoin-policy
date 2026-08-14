module packageImpact_test {
  import packageImpact.* from "./packageImpact"

  run matchingPublishedImpactFindsPackageTest =
    init
      .then(registerPackage(true))
      .then(reviewEvent)
      .then(reviewImpact(true))
      .then(publishEvent)
      .then(lookupAffectedPackage)
      .expect(state.affectedLookupPerformed)

  run candidateEventCannotFindPackageTest =
    init
      .then(registerPackage(true))
      .then(lookupAffectedPackage.fail())

  run reviewedButUnpublishedEventCannotFindPackageTest =
    init
      .then(registerPackage(true))
      .then(reviewEvent)
      .then(reviewImpact(true))
      .then(lookupAffectedPackage.fail())

  run dismissedImpactCannotPublishTest =
    init
      .then(registerPackage(true))
      .then(reviewEvent)
      .then(reviewImpact(false))
      .then(publishEvent.fail())

  run unrelatedPackageCannotBeReturnedTest =
    init
      .then(registerPackage(false))
      .then(reviewEvent)
      .then(reviewImpact(true))
      .then(publishEvent)
      .then(lookupAffectedPackage.fail())

  run packageAndDependencyRegistrationIsAtomicTest =
    init
      .then(registerPackage(true))
      .expect(and {
        state.packageState == PackageCompleted,
        state.dependencyIndexed,
        state.packageIntegrityVersion == 1,
      })

  run completedPackageCannotBeRegisteredAgainTest =
    init
      .then(registerPackage(true))
      .then(registerPackage(false).fail())
}
