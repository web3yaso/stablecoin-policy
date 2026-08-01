# Phase 1 Data Storage Inventory

**Inventory date:** 2026-07-31

This inventory fixes the canonical owner, duplication status, migration target, and cutover condition for Issue #14. File sizes are the Phase 1 entry snapshot and act as no-growth baselines, not permanent allowances.

## Active generated data

| Logical asset | Current canonical owner | Known duplicates/derived copies | Phase 1 target | Cutover condition |
|---|---|---|---|---|
| official-source news and regional summaries | `data/news/summaries.json` (1,119,520 bytes) | entry snapshot had identical `public/news-summaries.json` and baked entity news | `news-summaries` dataset release in Supabase Storage plus PostgreSQL active pointer | public dataset API parity in strict dual-read |
| source health checkpoint | `data/news/source-health.json` | report generator reads the working copy | `news-source-health` dataset release | publisher and paid-report source gate read the same pinned release |
| report catalog | `data/reports/index.json` | report API compatibility facade | `policy.reports` and immutable `policy.report_releases` | file/Supabase metadata equality and rollback test pass |
| encrypted paid reports | `data/reports/*.md.enc` | none intentionally; bodies remain application encrypted | private `policy-reports` bucket plus `policy.storage_objects` | checksum equality and paid-route delivery pass in dual mode |
| daily report JSON | dated and `latest.json` under `data/reports/daily/` | `latest.json` repeats the newest dated release | immutable `daily-report` dataset releases | active and historical release replay pass |
| public daily preview | dated and `latest.md` under `public/reports/daily/` | latest repeats newest dated preview | public or explicitly designated Storage artifact | a runtime preview route exists and cache behavior is verified |
| generated entity bundle | entry size 1,073,513 bytes; now about 20 KB | derived from legislation, figures, and international entities; runtime news removed | static compatibility registry plus runtime dataset overlay | completed locally; stop recurring rebuilds |

At Phase 1 entry, `data/news/summaries.json` and `public/news-summaries.json` had the same SHA-256 checksum (`25185b68d069d3da688c142b4943f95f67c9f36a1d2bab2af2248947888b713d`). The public copy and baked news were removed locally after homepage, map/sidebar, news list, and news-detail consumers moved to the runtime dataset route.

## Frozen legacy data

| Asset | Entry size | Owner/status | Phase |
|---|---:|---|---|
| `data/donors/politicians.json` | 4,807,106 bytes | unrelated legacy AI/politician surface; frozen at current size | remove/extract in Phase 7 |
| `data/politicians/us-enriched.json` | 4,317,177 bytes | unrelated legacy politician surface; frozen | remove/extract in Phase 7 |
| `data/politicians/suspicious-votes-cleaned.json` | 1,989,938 bytes | derived legacy vote data; frozen | remove/extract in Phase 7 |
| `data/crosswalk/legislators-current.json` | 1,471,448 bytes | source crosswalk for legacy politician processing; frozen | remove/extract in Phase 7 |

These files are not migrated into the stablecoin domain corpus. CI prevents them from growing while the stablecoin storage migration proceeds.

## Git-owned inputs retained

Small source registries, adapter configuration, migrations, schemas, deterministic rules, and sanitized fixtures stay in Git. Current legislation and figures JSON remain compatibility inputs until the Phase 2 legal-corpus migration assigns them canonical database identities and provision-level versions.

## Safe cutover sequence

1. Apply migrations and create private `policy-reports` and `policy-datasets` buckets.
2. Run `npm run storage:publish -- --dry-run`, then publish the initial releases.
3. Deploy with `STABLECOIN_POLICY_DATA_BACKEND=dual`; observe parity with `POLICY_DUAL_READ_STRICT=0`.
4. Resolve every mismatch, then repeat with strict dual-read enabled.
5. Switch to `supabase`, verify stale-cache and paid fail-closed behavior, and perform a previous-release restore drill.
6. Enable `POLICY_STORAGE_PUBLISH_ENABLED=1` in GitHub Actions and disable generated-data commits.
7. Set `POLICY_STORAGE_CUTOVER=1` in CI and stop tracking migrated generated files without rewriting Git history.
