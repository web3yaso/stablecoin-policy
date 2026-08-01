begin;

-- Migration 0013 removed direct UPDATE and DELETE, but the broad Phase 2
-- foundation grant still left INSERT available to the service role. Coverage
-- rows are a fixed reviewed registry and may only advance through the
-- named-human review RPC.
revoke insert, update, delete on table policy.coverage_scopes from service_role;
grant select on table policy.coverage_scopes to service_role;

comment on table policy.coverage_scopes is
  'Fixed jurisdiction coverage registry; service role is read-only and review_coverage_scope is the sole advancement path.';

commit;
