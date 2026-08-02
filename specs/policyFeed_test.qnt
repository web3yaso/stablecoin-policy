/**
 * Deterministic scenario tests for the /v1/policy-feed projection model.
 *
 * Each test mirrors a requirement from
 * docs/superpowers/plans/2026-08-01-citely-policy-feed.md section 9 and is the
 * source of the corresponding unit-test case in tests/policy-feed.test.ts.
 */
module policyFeed_test {
  import policyFeed.* from "./policyFeed"

  // section 6: missing active dataset => 503
  run serveWithoutDatasetIs503Test =
    init
      .then(serve)
      .expect(not(isServed(lastServe)))

  // sections 2/3/4: happy path — official items only, release time, ordering,
  // mapped playbook on item 1, no playbook on unmapped item 2
  run happyFreshServeTest =
    init
      .then(publishWith(Set(1, 2, 3), true))
      .then(serve)
      .expect(and {
        isServed(lastServe),
        servedFeed(lastServe).generatedAt == 0,
        not(servedFeed(lastServe).stale),
        servedItemIds(lastServe) == List(1, 2, 3),
        servedFeed(lastServe).items[0].playbook == Playbook(1),
        servedFeed(lastServe).items[1].playbook == NoPlaybook,
      })

  // section 4: third-party items are excluded silently, even malformed ones
  run thirdPartyExcludedTest =
    init
      .then(publishWith(Set(1, 5, 6), true))
      .then(serve)
      .expect(and {
        isServed(lastServe),
        servedItemIds(lastServe) == List(1),
      })

  // section 6: one malformed eligible item poisons the whole feed (no partial)
  run malformedOfficialPoisonsFeedTest =
    init
      .then(publishWith(Set(1, 2, 4), true))
      .then(serve)
      .expect(not(isServed(lastServe)))

  // section 5: a mapping to an unknown playbook fails the build
  run invalidPlaybookMappingPoisonsFeedTest =
    init
      .then(publishWith(Set(1, 7), true))
      .then(serve)
      .expect(not(isServed(lastServe)))

  // section 6: unsupported source dataset schema => 503
  run unsupportedSchemaIs503Test =
    init
      .then(publishWith(Set(1), false))
      .then(serve)
      .expect(not(isServed(lastServe)))

  // sections 3/6: stale serve keeps the original generatedAt and flags stale
  run staleServeKeepsGeneratedAtTest =
    init
      .then(publishWith(Set(1), true))
      .then(3.reps(_ => tick))
      .then(serve)
      .expect(and {
        isServed(lastServe),
        servedFeed(lastServe).stale,
        servedFeed(lastServe).generatedAt == 0,
        now == 3,
      })

  // section 6: an expired stale cache is no longer servable => 503
  run expiredStaleIs503Test =
    init
      .then(publishWith(Set(1), true))
      .then(6.reps(_ => tick))
      .then(serve)
      .expect(not(isServed(lastServe)))

  // section 4: ordering is date desc, then jurisdiction asc, then url asc
  // (items 1 and 2 share date 3; jurisdiction breaks the tie)
  run orderingDeterministicTest =
    init
      .then(publishWith(Set(3, 2, 1), true))
      .then(serve)
      .expect(servedItemIds(lastServe) == List(1, 2, 3))

  // section 3: republishing refreshes generatedAt to the new release's time
  run republishRefreshesGeneratedAtTest =
    init
      .then(publishWith(Set(1), true))
      .then(3.reps(_ => tick))
      .then(publishWith(Set(1), true))
      .then(serve)
      .expect(and {
        isServed(lastServe),
        not(servedFeed(lastServe).stale),
        servedFeed(lastServe).generatedAt == 3,
      })

  // section 2: an empty official selection is a valid, empty feed (not an error)
  run emptyFeedIsServableTest =
    init
      .then(publishWith(Set(5, 6), true))
      .then(serve)
      .expect(and {
        isServed(lastServe),
        servedItemIds(lastServe) == List(),
      })
}
