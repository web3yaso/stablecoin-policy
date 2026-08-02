/**
 * Executable model of the /v1/policy-feed read-only projection.
 *
 * Source requirements: docs/superpowers/plans/2026-08-01-citely-policy-feed.md
 * (sections 2, 3, 4, 5, 6). The model covers the atomic build semantics of the
 * feed; HTTP mechanics (ETag/304, CORS, headers) and text normalization are
 * deliberately abstracted and covered by unit tests instead.
 *
 * Abstractions:
 * - dates, jurisdictions, and URLs are ints so ordering is checkable;
 * - all per-item validity rules (date format, non-empty jurisdiction,
 *   normalized summary, HTTPS URL) collapse into one `wellFormed` flag,
 *   because they all have the same behavioral consequence (whole feed 503);
 * - time is an abstract counter; staleness thresholds are small ints.
 */
module policyFeed {
  // === domain types ===

  type SourceKind = OfficialSource | ThirdPartySource

  type NewsItem = {
    id: int,
    date: int,
    jur: int,
    itemUrl: int,
    kind: SourceKind,
    wellFormed: bool,
  }

  type PlaybookRef = NoPlaybook | Playbook(int)

  type FeedItem = { id: int, date: int, jur: int, itemUrl: int, playbook: PlaybookRef }

  type Feed = { generatedAt: int, stale: bool, items: List[FeedItem] }

  type Response = Served(Feed) | Error503

  type Release = { generatedAt: int, schemaSupported: bool, members: Set[int] }

  type DatasetState = NoDataset | Active(Release)

  // one serve observation: the dataset/clock the handler saw and what it returned
  type ServeRecord = { dsAtServe: DatasetState, nowAtServe: int, resp: Response }

  type LastServe = NotYetServed | Recorded(ServeRecord)

  // === fixed configuration (small domains) ===

  // fresh for FRESH_TTL ticks; servable-stale until MAX_STALE; expired after
  pure val FRESH_TTL = 2
  pure val MAX_STALE = 5

  pure val KNOWN_PLAYBOOKS = Set(1, 2)

  // item universe: exercises every inclusion/failure branch
  pure val ITEMS = Set(
    { id: 1, date: 3, jur: 1, itemUrl: 1, kind: OfficialSource, wellFormed: true },  // mapped -> playbook 1
    { id: 2, date: 3, jur: 2, itemUrl: 2, kind: OfficialSource, wellFormed: true },  // unmapped, same date as 1
    { id: 3, date: 1, jur: 1, itemUrl: 3, kind: OfficialSource, wellFormed: true },
    { id: 4, date: 0, jur: 1, itemUrl: 4, kind: OfficialSource, wellFormed: false }, // malformed official: poisons feed
    { id: 5, date: 3, jur: 1, itemUrl: 5, kind: ThirdPartySource, wellFormed: true },  // excluded silently
    { id: 6, date: 2, jur: 1, itemUrl: 6, kind: ThirdPartySource, wellFormed: false }, // excluded, harmless
    { id: 7, date: 2, jur: 1, itemUrl: 7, kind: OfficialSource, wellFormed: true }   // mapped -> unknown playbook 99
  )

  pure val ALL_IDS = ITEMS.map(x => x.id)

  // explicit subsite-owned mapping (plan section 5); id 7 maps to an invalid playbook
  pure val PLAYBOOK_MAP = Map(1 -> 1, 7 -> 99)

  // canonical presentation order of official ids: date desc, jur asc, url asc.
  // The ordering invariant re-checks this independently against the sort key.
  pure val ORDERED_OFFICIAL_IDS = List(1, 2, 7, 3, 4)

  // === functional layer ===

  pure def itemById(i: int): NewsItem = ITEMS.filter(x => x.id == i).getOnlyElement()

  pure def officialMembers(members: Set[int]): Set[int] =
    members.filter(i => itemById(i).kind == OfficialSource)

  pure def mappedPlaybook(i: int): PlaybookRef =
    if (PLAYBOOK_MAP.keys().contains(i)) Playbook(PLAYBOOK_MAP.get(i)) else NoPlaybook

  pure def mappingInvalid(i: int): bool =
    PLAYBOOK_MAP.keys().contains(i) and not(KNOWN_PLAYBOOKS.contains(PLAYBOOK_MAP.get(i)))

  pure def project(i: int): FeedItem = {
    val it = itemById(i)
    { id: it.id, date: it.date, jur: it.jur, itemUrl: it.itemUrl, playbook: mappedPlaybook(i) }
  }

  pure def isExpired(r: Release, now: int): bool = now - r.generatedAt > MAX_STALE

  pure def isStale(r: Release, now: int): bool = now - r.generatedAt > FRESH_TTL

  // any malformed eligible item or invalid mapping poisons the whole build
  pure def buildPoisoned(members: Set[int]): bool = {
    val elig = officialMembers(members)
    elig.exists(i => not(itemById(i).wellFormed)) or elig.exists(i => mappingInvalid(i))
  }

  // the atomic response computation (plan section 6)
  pure def buildResponse(ds: DatasetState, now: int): Response =
    match ds {
      | NoDataset => Error503
      | Active(r) =>
        if (not(r.schemaSupported)) Error503
        else if (isExpired(r, now)) Error503
        else if (buildPoisoned(r.members)) Error503
        else Served({
          generatedAt: r.generatedAt,
          stale: isStale(r, now),
          items: ORDERED_OFFICIAL_IDS.foldl(List(), (acc, i) =>
            if (officialMembers(r.members).contains(i)) acc.append(project(i)) else acc),
        })
    }

  // === state machine ===

  var dataset: DatasetState
  var now: int
  var lastServe: LastServe

  action init = all {
    dataset' = NoDataset,
    now' = 0,
    lastServe' = NotYetServed,
  }

  action publishWith(members: Set[int], schemaOk: bool): bool = all {
    dataset' = Active({ generatedAt: now, schemaSupported: schemaOk, members: members }),
    now' = now,
    lastServe' = lastServe,
  }

  action publish = {
    nondet members = ALL_IDS.powerset().oneOf()
    nondet schemaOk = Set(true, false).oneOf()
    publishWith(members, schemaOk)
  }

  action tick = all {
    now' = now + 1,
    dataset' = dataset,
    lastServe' = lastServe,
  }

  action serve = all {
    lastServe' = Recorded({ dsAtServe: dataset, nowAtServe: now, resp: buildResponse(dataset, now) }),
    dataset' = dataset,
    now' = now,
  }

  action dropDataset = all {
    dataset' = NoDataset,
    now' = now,
    lastServe' = lastServe,
  }

  action step = any {
    publish,
    tick,
    serve,
    dropDataset,
  }

  // === helpers for properties and tests ===

  pure def respOf(ls: LastServe): Response =
    match ls {
      | NotYetServed => Error503
      | Recorded(rec) => rec.resp
    }

  pure def isServed(ls: LastServe): bool =
    match ls {
      | NotYetServed => false
      | Recorded(rec) => match rec.resp { | Served(_) => true | Error503 => false }
    }

  pure def servedFeed(ls: LastServe): Feed =
    match respOf(ls) {
      | Served(f) => f
      | Error503 => { generatedAt: -1, stale: false, items: List() }
    }

  pure def servedItemIds(ls: LastServe): List[int] =
    servedFeed(ls).items.foldl(List(), (acc, it) => acc.append(it.id))

  pure def sortKeyBefore(a: FeedItem, b: FeedItem): bool =
    a.date > b.date
      or (a.date == b.date and a.jur < b.jur)
      or (a.date == b.date and a.jur == b.jur and a.itemUrl < b.itemUrl)

  // === invariants ===

  // plan section 3: generatedAt is the release's, never the request time
  val invGeneratedAtFromRelease: bool =
    match lastServe {
      | NotYetServed => true
      | Recorded(rec) =>
        match rec.resp {
          | Error503 => true
          | Served(f) =>
            match rec.dsAtServe {
              | NoDataset => false
              | Active(r) => f.generatedAt == r.generatedAt
            }
        }
    }

  // plan section 3/6: a stale serve keeps the old generation time visible
  val invStaleServeKeepsOldTime: bool =
    match lastServe {
      | NotYetServed => true
      | Recorded(rec) =>
        match rec.resp {
          | Error503 => true
          | Served(f) => not(f.stale) or f.generatedAt < rec.nowAtServe
        }
    }

  // plan section 4: only official, well-formed release members are served
  val invOnlyOfficialWellFormed: bool =
    match lastServe {
      | NotYetServed => true
      | Recorded(rec) =>
        match rec.resp {
          | Error503 => true
          | Served(f) =>
            match rec.dsAtServe {
              | NoDataset => false
              | Active(r) => f.items.indices().forall(ix => {
                  val it = itemById(f.items[ix].id)
                  it.kind == OfficialSource and it.wellFormed and r.members.contains(it.id)
                })
            }
        }
    }

  // plan section 6: one malformed eligible item or invalid mapping => whole 503
  val invAtomicNoPartialFeed: bool =
    match lastServe {
      | NotYetServed => true
      | Recorded(rec) =>
        match rec.dsAtServe {
          | NoDataset => true
          | Active(r) =>
            not(buildPoisoned(r.members)) or
              match rec.resp { | Error503 => true | Served(_) => false }
        }
    }

  // plan section 4: date desc, jurisdiction asc, sourceUrl asc
  val invServedOrdering: bool =
    match lastServe {
      | NotYetServed => true
      | Recorded(rec) =>
        match rec.resp {
          | Error503 => true
          | Served(f) => f.items.indices().forall(ix =>
              ix == 0 or sortKeyBefore(f.items[ix - 1], f.items[ix]))
        }
    }

  // plan section 5: playbookId only from the explicit map, must be known
  val invPlaybookFromMapOnly: bool =
    match lastServe {
      | NotYetServed => true
      | Recorded(rec) =>
        match rec.resp {
          | Error503 => true
          | Served(f) => f.items.indices().forall(ix => {
              val it = f.items[ix]
              match it.playbook {
                | NoPlaybook => not(PLAYBOOK_MAP.keys().contains(it.id))
                | Playbook(p) => and {
                    PLAYBOOK_MAP.keys().contains(it.id),
                    PLAYBOOK_MAP.get(it.id) == p,
                    KNOWN_PLAYBOOKS.contains(p),
                  }
              }
            })
        }
    }

  // plan section 6: stale flag exactly reflects release age at serve time
  val invStaleFlagCorrect: bool =
    match lastServe {
      | NotYetServed => true
      | Recorded(rec) =>
        match rec.resp {
          | Error503 => true
          | Served(f) =>
            match rec.dsAtServe {
              | NoDataset => false
              | Active(r) => f.stale == isStale(r, rec.nowAtServe)
            }
        }
    }

  // plan section 6: missing dataset, unsupported schema, expired cache => 503
  val invFailClosed: bool =
    match lastServe {
      | NotYetServed => true
      | Recorded(rec) => {
        val mustFail = match rec.dsAtServe {
          | NoDataset => true
          | Active(r) => not(r.schemaSupported) or isExpired(r, rec.nowAtServe)
        }
        not(mustFail) or match rec.resp { | Error503 => true | Served(_) => false }
      }
    }

  // === witnesses (reachability targets) ===

  val servedFreshWitness: bool =
    isServed(lastServe) and not(servedFeed(lastServe).stale)
      and servedFeed(lastServe).items.length() > 0

  val servedStaleWitness: bool =
    isServed(lastServe) and servedFeed(lastServe).stale

  val playbookMappedWitness: bool =
    servedFeed(lastServe).items.indices().exists(ix =>
      match servedFeed(lastServe).items[ix].playbook {
        | Playbook(_) => true
        | NoPlaybook => false
      })

  val poisonedRejectedWitness: bool =
    match lastServe {
      | NotYetServed => false
      | Recorded(rec) =>
        match rec.dsAtServe {
          | NoDataset => false
          | Active(r) => buildPoisoned(r.members) and r.schemaSupported
            and match rec.resp { | Error503 => true | Served(_) => false }
        }
    }

  val noDatasetRejectedWitness: bool =
    match lastServe {
      | NotYetServed => false
      | Recorded(rec) =>
        match rec.dsAtServe {
          | NoDataset => match rec.resp { | Error503 => true | Served(_) => false }
          | Active(_) => false
        }
    }
}
