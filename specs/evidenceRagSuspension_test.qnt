module evidenceRagSuspension_test {
  import evidenceRagSuspension.* from "./evidenceRagSuspension"
  run firstActivationSuspensionTest = init.then(activate(1)).then(inspect(1, 1, true))
    .then(suspend(1)).expect(lifecycle.pointers.get(1) == { active: 0, previous: 0, revision: 2 })
    .expect(not(readable(lifecycle, 1, 1))).then(unavailable(1, 1))
  run exactRetryTest = init.then(activate(1)).then(inspect(1, 1, true)).then(suspend(1))
    .then(replayOperation(1)).expect(completed == Set(1) and lifecycle.pointers.get(1).revision == 2)
  run staleAbaTest = init.then(activate(1)).then(inspect(1, 1, true)).then(activate(2))
    .then(rollback(1)).expect(not(canSuspend(lifecycle, pending.get(1)))).then(rejectOperation(1))
    .expect(lifecycle.pointers.get(1).active == 1 and completed == Set())
  run unauthorizedTest = init.then(activate(1)).then(inspect(1, 1, false))
    .expect(not(canSuspend(lifecycle, pending.get(1)))).then(rejectOperation(1)).expect(completed == Set())
  run recoveryTest = init.then(activate(1)).then(inspect(1, 1, true)).then(suspend(1))
    .expect(not(canActivate(lifecycle, 1))).then(activate(2)).expect(not(canRollback(lifecycle, 1)))
    .then(replayOperation(1)).expect(lifecycle.pointers.get(1).active == 2)
  run historyPreservedTest = init.then(activate(1)).then(query(1, 1))
    .then(inspect(1, 1, true)).then(suspend(1)).then(replayHistory(1))
    .expect(history == Set(1) and decision == 73)
  run scopeIsolationTest = init.then(activate(1)).then(activate(3))
    .then(inspect(1, 1, true)).then(suspend(1))
    .expect(lifecycle.pointers.get(2).active == 3).then(query(3, 1).fail())
  run expiredCanSuspendTest = init.then(activate(1)).then(expire(1))
    .then(inspect(1, 1, true)).then(suspend(1)).expect(suspensionAuditBound)
  run expiredCannotRecoverTest = init.then(expire(1)).then(activate(1).fail())
  run duplicateInspectRaceTest = init.then(activate(1)).then(inspect(1, 1, true))
    .then(inspect(2, 1, true)).then(suspend(1)).expect(not(canSuspend(lifecycle, pending.get(2))))
    .expect(completed == Set(1))
  run guardBindingTest = init.then(activate(1)).expect(and {
    not(canSuspend(lifecycle, { ...inspectRequest(lifecycle, 1, true), manifest: 9 })),
    not(canSuspend(lifecycle, { ...inspectRequest(lifecycle, 1, true), scope: 2 })),
  })
}
