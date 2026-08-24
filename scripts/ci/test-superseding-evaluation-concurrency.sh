#!/usr/bin/env bash
set -euo pipefail

container="${SUPABASE_DB_CONTAINER:-supabase_db_stablecoin-policy}"
fixture_dir="scripts/ci/sql"
result_dir="$(mktemp -d)"

cleanup() {
  docker exec -i "${container}" psql -X -U postgres -d postgres \
    < "${fixture_dir}/superseding-concurrency-cleanup.sql" >/dev/null 2>&1 || true
  rm -rf "${result_dir}"
}
trap cleanup EXIT

docker exec -i "${container}" psql -X -U postgres -d postgres \
  < "${fixture_dir}/superseding-concurrency-setup.sql" >/dev/null

docker exec -i "${container}" psql -X -A -t -q -U postgres -d postgres \
  < "${fixture_dir}/superseding-concurrency-claim.sql" \
  > "${result_dir}/claim-a.txt" &
claim_a_pid=$!
docker exec -i "${container}" psql -X -A -t -q -U postgres -d postgres \
  < "${fixture_dir}/superseding-concurrency-claim.sql" \
  > "${result_dir}/claim-b.txt" &
claim_b_pid=$!

wait "${claim_a_pid}"
wait "${claim_b_pid}"

claimed_count="$(awk '$0 == "CLAIMED" { count++ } END { print count + 0 }' \
  "${result_dir}"/claim-*.txt)"
pending_count="$(awk '$0 == "PENDING" { count++ } END { print count + 0 }' \
  "${result_dir}"/claim-*.txt)"
if [[ "${claimed_count}" != "1" || "${pending_count}" != "1" ]]; then
  printf 'expected one CLAIMED and one PENDING result\n' >&2
  grep -h -E '^(CLAIMED|PENDING)$' "${result_dir}"/claim-*.txt >&2 || true
  exit 1
fi

database_counts="$(docker exec "${container}" psql -X -A -t -q -U postgres -d postgres -c \
  "select count(*) || ':' || count(distinct rerun_id) from policy.playbook_package_rerun_attempts where base_package_id = 'package:stablecoin-pre-listing:dddddddddddddddd'")"
if [[ "${database_counts}" != "1:1" ]]; then
  printf 'expected exactly one durable rerun claim, got %s\n' "${database_counts}" >&2
  exit 1
fi

printf 'concurrent rerun claim: one CLAIMED, one PENDING, one durable rerun row\n'
