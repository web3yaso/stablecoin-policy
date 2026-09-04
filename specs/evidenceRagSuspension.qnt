/**
 * Approved 2026-09-04 suspension delta. Shared-state PostgreSQL transactions,
 * with inspection separate from commit. Complements evidenceRag.qnt's corpus,
 * eval, retrieval, and decision model; eligibility is abstracted to a boolean.
 * Corresponds to migration 0036 and retrieval admin CLI. No liveness, SQL lock,
 * cryptography, embedding quality, or in-flight cancellation proof is claimed.
 * Update this model before changing lifecycle implementation.
 */
module evidenceRagSuspension {
  import evidenceRag as R from "./evidenceRag"
  type Pointer = { active: int, previous: int, revision: int }
  type Release = { phase: R::IndexPhase, scope: int, manifest: int, eligible: bool }
  type Request = {
    scope: int, indexId: int, manifest: int, revision: int,
    authorized: bool, reason: int,
  }
  type Audit = { request: Request, revision: int }
  type Lifecycle = { indexes: int -> Release, pointers: int -> Pointer }
  pure val SCOPES = Set(1, 2)
  pure val IDS = Set(1, 2, 3)
  pure val OPS = Set(1, 2)
  pure def scopeOf(id: int): int = if (id == 3) 2 else 1
  pure val emptyRequest = {
    scope: 1, indexId: 0, manifest: 0, revision: 0, authorized: false, reason: 1,
  }
  pure val initialLifecycle = {
    indexes: IDS.mapBy(id => { phase: R::Draft, scope: scopeOf(id), manifest: id, eligible: true }),
    pointers: SCOPES.mapBy(_ => { active: 0, previous: 0, revision: 0 }),
  }
  var lifecycle: Lifecycle
  var pending: int -> Request
  var inspected: Set[int]
  var audit: int -> Audit
  var completed: Set[int]
  // Observation flags are distinct from durable lifecycle state.
  var observed: Set[str]
  var history: Set[int]
  var decision: int

  action init = all {
    lifecycle' = initialLifecycle,
    pending' = OPS.mapBy(_ => emptyRequest), inspected' = Set(),
    audit' = OPS.mapBy(_ => { request: emptyRequest, revision: 0 }),
    completed' = Set(), observed' = Set(), history' = Set(), decision' = 73,
  }
  pure def canActivate(s: Lifecycle, id: int): bool =
    s.indexes.get(id).phase == R::Draft and s.indexes.get(id).eligible
  pure def applyActivate(s: Lifecycle, id: int): Lifecycle = {
    val scope = s.indexes.get(id).scope
    val pointer = s.pointers.get(scope)
    val indexes = if (pointer.active == 0) s.indexes else
      s.indexes.setBy(pointer.active, index => { ...index, phase: R::Retired })
    { indexes: indexes.setBy(id, index => { ...index, phase: R::Active }),
      pointers: s.pointers.set(scope, {
        active: id, previous: pointer.active, revision: pointer.revision + 1,
      }) }
  }
  action activate(id: int): bool = all {
    canActivate(lifecycle, id), lifecycle' = applyActivate(lifecycle, id),
    pending' = pending, inspected' = inspected, audit' = audit, completed' = completed,
    observed' = observed.union(Set("activate")).union(
      if (completed.size() > 0) Set("recover") else Set()),
    history' = history, decision' = decision,
  }
  pure def inspectRequest(s: Lifecycle, scope: int, authorized: bool): Request = {
    val pointer = s.pointers.get(scope)
    { scope: scope, indexId: pointer.active,
      manifest: s.indexes.get(pointer.active).manifest,
      revision: pointer.revision, authorized: authorized, reason: 1 }
  }
  action inspect(op: int, scope: int, authorized: bool): bool = all {
    not(inspected.contains(op)), lifecycle.pointers.get(scope).active != 0,
    lifecycle' = lifecycle,
    pending' = pending.set(op, inspectRequest(lifecycle, scope, authorized)),
    inspected' = inspected.union(Set(op)), audit' = audit, completed' = completed,
    observed' = observed.union(Set("inspect")), history' = history, decision' = decision,
  }
  pure def canSuspend(s: Lifecycle, request: Request): bool = and {
    request.authorized, request.indexId != 0,
    s.pointers.get(request.scope).active == request.indexId,
    s.pointers.get(request.scope).revision == request.revision,
    s.indexes.get(request.indexId).phase == R::Active,
    s.indexes.get(request.indexId).scope == request.scope,
    s.indexes.get(request.indexId).manifest == request.manifest,
  }
  pure def applySuspend(s: Lifecycle, request: Request): Lifecycle = {
    indexes: s.indexes.setBy(request.indexId, index => { ...index, phase: R::Suspended }),
    pointers: s.pointers.set(request.scope, {
      active: 0, previous: 0, revision: request.revision + 1,
    }),
  }
  action suspend(op: int): bool = all {
    inspected.contains(op), not(completed.contains(op)),
    canSuspend(lifecycle, pending.get(op)),
    lifecycle' = applySuspend(lifecycle, pending.get(op)),
    audit' = audit.set(op, { request: pending.get(op), revision: pending.get(op).revision + 1 }),
    completed' = completed.union(Set(op)), pending' = pending, inspected' = inspected,
    observed' = observed.union(Set("suspend")), history' = history, decision' = decision,
  }
  pure def canRollback(s: Lifecycle, scope: int): bool = {
    val p = s.pointers.get(scope)
    and { p.active != 0, p.previous != 0,
      s.indexes.get(p.active).phase == R::Active,
      s.indexes.get(p.previous).phase == R::Retired,
      s.indexes.get(p.previous).scope == scope,
      s.indexes.get(p.previous).eligible }
  }
  pure def applyRollback(s: Lifecycle, scope: int): Lifecycle = {
    val p = s.pointers.get(scope)
    { indexes: s.indexes.setBy(p.active, i => { ...i, phase: R::Retired })
        .setBy(p.previous, i => { ...i, phase: R::Active }),
      pointers: s.pointers.set(scope, {
        active: p.previous, previous: p.active, revision: p.revision + 1,
      }) }
  }
  action rollback(scope: int): bool = all {
    canRollback(lifecycle, scope), lifecycle' = applyRollback(lifecycle, scope),
    pending' = pending, inspected' = inspected, audit' = audit, completed' = completed,
    observed' = observed.union(Set("rollback")), history' = history, decision' = decision,
  }
  action replayOperation(op: int): bool = all {
    completed.contains(op), pending.get(op).authorized,
    pending.get(op) == audit.get(op).request,
    not(observed.contains("retry")),
    lifecycle' = lifecycle, pending' = pending, inspected' = inspected,
    audit' = audit, completed' = completed,
    observed' = observed.union(Set("retry")), history' = history, decision' = decision,
  }
  action rejectOperation(op: int): bool = all {
    inspected.contains(op), not(completed.contains(op)),
    not(canSuspend(lifecycle, pending.get(op))), not(observed.contains("reject")),
    lifecycle' = lifecycle, pending' = pending, inspected' = inspected,
    audit' = audit, completed' = completed,
    observed' = observed.union(Set("reject")), history' = history, decision' = decision,
  }
  pure def readable(s: Lifecycle, id: int, scope: int): bool = and {
    s.indexes.get(id).scope == scope,
    s.indexes.get(id).phase == R::Active or s.indexes.get(id).phase == R::Retired,
    s.indexes.get(id).eligible,
  }
  action query(id: int, scope: int): bool = all {
    readable(lifecycle, id, scope), not(history.contains(id)),
    lifecycle' = lifecycle, pending' = pending, inspected' = inspected,
    audit' = audit, completed' = completed,
    observed' = observed.union(Set("query")), history' = history.union(Set(id)), decision' = decision,
  }
  action unavailable(id: int, scope: int): bool = all {
    not(readable(lifecycle, id, scope)), not(observed.contains("unavailable")),
    lifecycle' = lifecycle, pending' = pending, inspected' = inspected,
    audit' = audit, completed' = completed,
    observed' = observed.union(Set("unavailable")), history' = history, decision' = decision,
  }
  action replayHistory(id: int): bool = all {
    history.contains(id), lifecycle.indexes.get(id).phase == R::Suspended,
    not(observed.contains("history")),
    lifecycle' = lifecycle, pending' = pending, inspected' = inspected,
    audit' = audit, completed' = completed,
    observed' = observed.union(Set("history")), history' = history, decision' = decision,
  }
  action expire(id: int): bool = all {
    lifecycle.indexes.get(id).eligible,
    lifecycle' = { ...lifecycle, indexes: lifecycle.indexes.setBy(id, i => { ...i, eligible: false }) },
    pending' = pending, inspected' = inspected, audit' = audit, completed' = completed,
    observed' = observed.union(Set("expire")), history' = history, decision' = decision,
  }
  action step = {
    nondet id = IDS.oneOf()
    nondet scope = SCOPES.oneOf()
    nondet op = OPS.oneOf()
    nondet authorized = Set(true, false).oneOf()
    any { activate(id), inspect(op, scope, authorized), suspend(op), rollback(scope),
      replayOperation(op), rejectOperation(op), query(id, scope), unavailable(id, scope),
      replayHistory(id), expire(id) }
  }
  val pointerAgreement = SCOPES.forall(scope => {
    val active = IDS.filter(id => lifecycle.indexes.get(id).scope == scope
      and lifecycle.indexes.get(id).phase == R::Active)
    if (lifecycle.pointers.get(scope).active == 0) active == Set()
    else active == Set(lifecycle.pointers.get(scope).active)
  })
  val activationWitness = observed.contains("activate")
  val inspectionWitness = observed.contains("inspect")
  val suspensionWitness = observed.contains("suspend")
  val rollbackWitness = observed.contains("rollback")
  val retryWitness = observed.contains("retry")
  val rejectionWitness = observed.contains("reject")
  val queryWitness = observed.contains("query")
  val unavailableWitness = observed.contains("suspend") and observed.contains("unavailable")
  val historyWitness = observed.contains("history")
  val expiryWitness = observed.contains("expire")
  val recoveryWitness = observed.contains("recover")
  val suspensionAuditBound = completed.forall(op => {
    val a = audit.get(op)
    and { a.request.authorized,
      a.revision == a.request.revision + 1,
      lifecycle.pointers.get(a.request.scope).revision >= a.revision,
      lifecycle.indexes.get(a.request.indexId).phase == R::Suspended,
      lifecycle.indexes.get(a.request.indexId).manifest == a.request.manifest,
      lifecycle.indexes.get(a.request.indexId).scope == a.request.scope }
  })
  val suspendedNeverReadable = IDS.forall(id =>
    lifecycle.indexes.get(id).phase == R::Suspended implies
      SCOPES.forall(scope => not(readable(lifecycle, id, scope))))
  val scopeIsolation = SCOPES.forall(scope => {
    val p = lifecycle.pointers.get(scope)
    and { p.active == 0 or lifecycle.indexes.get(p.active).scope == scope,
      p.previous == 0 or lifecycle.indexes.get(p.previous).scope == scope }
  })
  val immutableEvidenceAndDecision = decision == 73 and
    IDS.forall(id => lifecycle.indexes.get(id).manifest == id)
}
