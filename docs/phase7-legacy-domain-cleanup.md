# Phase 7 legacy-domain cleanup

Status: implementation complete; verification passed on `codex/legacy-domain-cleanup`
Tracking: [GitHub Issue #46](https://github.com/web3yaso/stablecoin-policy/issues/46)

## Boundary

This cleanup leaves Stablecoin Policy as the Stablecoin-specific Citely
subsite and domain backend. It does not move or mutate Supabase production
objects, shared legal-corpus migrations, customer data, private playbook
rules, report storage, or any public/API contract.

The legacy generated material is not copied into AI Policy. It was produced
for an earlier editorial tracker and does not satisfy the current provenance,
rights, versioning, or assurance requirements. Git history is the archive.
AI Policy owns new domain UI and analysis, and consumes reusable official
documents only through the shared `regulatory` substrate described in
`docs/citely-product-family-boundary.md`.

## Frozen pre-cleanup baseline

Measured at commit `cf612ffa25f86a0233263003ef4e98495eec7f9f` with a clean
production build on 2026-08-08.

| Metric | Before |
| --- | ---: |
| Git-tracked files | 552 |
| Git-tracked bytes | 17,756,419 |
| `data/` working-tree size | 14,844 KiB |
| Production dependencies | 19 |
| Development dependencies | 16 |
| `.next/static` | 10,324 KiB |
| `.next/server` | 65,852 KiB |
| Generated app pages | 65 |

The pre-cleanup build exposed `/datacenters`, `/datacenters/[id]`, `/globe`,
and `/politicians`; generated 52 legacy entity pages under
`/legislation/[id]`; and emitted politician-data warnings during static page
generation.

## Disposition inventory

Patterns below are exhaustive for the legacy product candidates. A pattern is
used when every tracked file below that path has the same disposition.

| Candidate | Disposition | Reason / destination |
| --- | --- | --- |
| `app/datacenters/**` | `DELETE` | Retire through tested 308 redirects before removing pages. |
| `app/politicians/**` | `DELETE` | Retire through tested 308 redirects before removing pages. |
| `app/globe/page.tsx` | `DELETE` | Data-center facility globe; retire through a tested 308 redirect. |
| Homepage politician section and AI/data-center copy | `DELETE` | Stablecoin homepage retains policy update, jurisdiction, legislation, and news surfaces. |
| `app/bills/page.tsx` | `KEEP_STABLECOIN` | Keep as a Stablecoin-only legislation index. |
| `app/legislation/[id]/page.tsx` | `KEEP_STABLECOIN` | Keep only Stablecoin entities and legislation. |
| `app/news/[id]/page.tsx` | `KEEP_STABLECOIN` | Remove AI/data-center stance presentation; keep official Stablecoin news. |
| `components/map/{NorthAmericaMap,USStatesMap,EuropeMap,AsiaMap,AfricaMap,MapShell}.tsx` | `KEEP_STABLECOIN` | Generic jurisdiction maps remain, with all facility, county, energy, and non-Stablecoin lens props removed. |
| `components/map/{CountyMap,DataCenterCard,DataCenterDots}.tsx` | `DELETE` | Data-center and EIA overlays only. |
| `components/map/sandbox/**` | `DELETE` | Experimental data-center/maplibre implementations; no production Stablecoin consumer. |
| `components/panel/{DataCentersList,EnergySection,FacilityDetail,KeyFigures}.tsx` | `DELETE` | Facility, EIA, and politician surfaces. |
| `components/panel/{StablecoinInfo,ContextBlurb,NewsSection,LegislationList,SidePanel}.tsx` | `KEEP_STABLECOIN` | Refactor to Stablecoin-only content and remove donor/facility dependencies. |
| `components/panel/BillExpanded.tsx` | `DELETE` | Donor, vote, facility, and legacy category expansion; source links move into the Stablecoin legislation list. |
| `components/politicians/**` | `DELETE` | Politician, donor, vote, and alignment product. |
| `components/sections/{DataCentersOverview,PoliticiansOverview,SummaryBar}.tsx` | `DELETE` | Legacy product sections. |
| `components/sections/AIOverview.tsx` | `DELETE` | Replace with a Stablecoin-named policy update component without AI/data-center fallback prose. |
| `components/sections/{LegislationTable,DimensionToggle,NuanceLegend}.tsx` | `KEEP_STABLECOIN` | Refactor to the Stablecoin taxonomy only. |
| `lib/{datacenters,energy-data,energy-colors,politicians-data,donor-data,municipal-data,action-facility-link}.ts` | `DELETE` | Domain loaders and relationship helpers have no Stablecoin use. |
| `lib/{dimensions,international-entities,international-researched,placeholder-data}.ts` | `KEEP_STABLECOIN` | Replace with Stablecoin-only dimensions and entity assembly; generated legacy fields are removed. |
| `lib/openai-llm.ts` and `openai` package | `KEEP_STABLECOIN` | Required by news, report, assurance, and claim-extraction workflows. |
| `lib/data/**`, `lib/legal-corpus/**`, `lib/playbooks/**`, `lib/policy-feed/**` | `SHARED_PLATFORM` or `KEEP_STABLECOIN` | Production storage, evidence, claims, packages, and Citely APIs are explicitly out of cleanup scope. |
| `data/{politicians,donors,votes,figures,crosswalk}/**` | `ARCHIVE` then `DELETE` | Git history is the recoverable archive; generated data is not copied to AI Policy. |
| `data/legislation/_irrelevant.json`, `data/raw/{congress,openstates}/**`, legacy query counters | `ARCHIVE` then `DELETE` | Legacy ingestion artifacts and counters; active Stablecoin source ingestion is externalized. |
| `data/legislation/{federal,states/**}.json` | `KEEP_STABLECOIN` | Already contains Stablecoin categories only; remove obsolete general-policy fields. |
| `data/international/**` | `KEEP_STABLECOIN` | Keep Stablecoin metadata and legislation; remove AI/data-center stances, figures, and stale embedded news. |
| `data/releases/news-summaries/**` | `KEEP_STABLECOIN` | Historical Stablecoin update corpus and active policy-feed input. Individual Stablecoin articles may mention adjacent AI topics; those references are source content, not an AI product surface. |
| `public/politicians/**` | `ARCHIVE` then `DELETE` | Portrait assets have no remaining product consumer. |
| `scripts/sync/{datacenters-*,eia-*,eu-politicians,us-politicians-ai,votes-*,water-features,crosswalk-ids,international-stance,legislation-classify,legislation-dimension-stance,legislation-ingest,legislation-reclassify,municipal,municipal-research}.ts` | `DELETE` | Legacy AI/data-center/politician/EIA/energy ingestion. |
| `scripts/cleanup/{clean-suspicious-votes,fill-impact-tags,fix-stances,flag-irrelevant-bills,refresh-blurbs,remove-irrelevant,remove-junk,rewrite-blurbs}.ts` | `DELETE` | Legacy taxonomy and prose cleanup. |
| `scripts/{build-placeholder,extract-figures}.ts`, `scripts/smoke/{donor-lookup,legiscan-ping,asia-viewport}.ts` | `DELETE` | Generated legacy entity/figure pipeline and domain-only smoke checks. |
| `scripts/sync/{bills-federal,bills-states,news-*,legal-official-sources}.ts` | `KEEP_STABLECOIN` | Active Stablecoin and official-source ingestion. |
| `types/index.ts` legacy lens, impact, municipal, politician, donor, vote, facility, and energy types | `DELETE` | Retain only Stablecoin jurisdiction, legislation, news, and shared presentation types. |
| `maplibre-gl`, `cobe`, `@number-flow/react`, `topojson-client`, `@types/topojson-client`, `react-grab` | `DELETE` | Consumers are retired routes, overlays, sandbox code, or proven dead imports. |
| `d3-geo`, `react-simple-maps`, `framer-motion` | `KEEP_STABLECOIN` | Used by retained jurisdiction/hero maps and shared UI. |
| `.github/workflows/{quality,news-rss}.yml` | `KEEP_STABLECOIN` | No legacy domain job or secret is referenced. |
| Legacy-specific environment variables | `DELETE` | None are declared in tracked environment templates or active workflows; script-only variables disappear with their scripts. |
| Strategic references to AI Policy and shared schemas in canonical docs | `SHARED_PLATFORM` | These describe the accepted Citely product-family boundary, not a legacy product surface. |

## Route retirement

The following redirects are centralized in `next.config.ts`, execute before
rendering, preserve query strings, and are permanent (HTTP 308):

| Source | Destination |
| --- | --- |
| `/datacenters` | `/` |
| `/datacenters/:path*` | `/` |
| `/politicians` | `/` |
| `/politicians/:path*` | `/` |
| `/globe` | `/` |

The `#politicians` fragment was never an HTTP route. After its homepage
section is removed, old fragment links safely resolve to the Stablecoin
homepage. `/bills` and `/legislation/[id]` are not retired; they are narrowed
to Stablecoin records.

## Verification and rollback

The cleanup is split into reviewable commits for route/UI retirement,
data/scripts/dependency removal, and final dead-code/documentation cleanup.
Each commit is revertible. Git history remains intact, and external Storage
objects are not deleted.

Final verification records the post-cleanup metrics and runs unit/contract
tests, all evals, applicable Quint specifications, database tests, lint,
typecheck, production build, repository-data checks, redirect tests, and
production API/public-page smoke checks.

## Post-cleanup result

Measured from the verified production build on 2026-08-08. The file and byte
counts include the new cleanup inventory, redirect registry, and regression
test that will become tracked when this branch is committed.

| Metric | Before | After | Change |
| --- | ---: | ---: | ---: |
| Git-tracked files | 552 | 412 | -25.4% |
| Git-tracked bytes | 17,756,419 | 3,606,439 | -79.7% |
| `data/` working-tree size | 14,844 KiB | 1,772 KiB | -88.1% |
| Production dependencies | 19 | 14 | -26.3% |
| Development dependencies | 16 | 15 | -6.3% |
| `.next/static` | 10,324 KiB | 1,224 KiB | -88.1% |
| `.next/server` | 65,852 KiB | 20,576 KiB | -68.8% |
| Generated app pages | 65 | 23 | -64.6% |

Removed product domains have no remaining tracked filename, route, component,
loader, synchronization script, asset, type, package, workflow, or environment
declaration. The only retained route-name literals are the centralized redirect
registry and its regression test. Shared machine-assurance code still uses
`AI_*` assurance-level names by design; those model-assisted Stablecoin
extraction states are not the retired AI-policy product.

## Verification record

All checks passed on 2026-08-08:

- `npm test`: 157/157 unit and contract tests;
- Phase 0, Phase 1, and Phase 2 evals: 4/4, 11/11, and 89/89;
- Quint: Phase 2 (33 scenarios), policy feed (11 tests and 8 invariants), and
  playbook (11 tests and 5 invariants);
- database: migrations `0001` through `0023`, then 8 pgTAP files with 156/156
  assertions against an isolated local Postgres container;
- `npm run lint`, `npm run typecheck`, `npm run build`, and
  `npm run data:check`;
- local production smoke: `/`, `/about`, `/bills`, `/methodology`, `/news`,
  `/api/reports`, `/v1/policy-feed`, `/v1/provisional/coverage`, and
  `/v1/playbooks` returned 200;
- redirect smoke: `/datacenters`, nested data-center URLs, `/politicians`,
  nested politician URLs, and `/globe` returned permanent 308 redirects to
  `/`.

The first Supabase CLI test attempt exposed a local Colima bind-mount issue for
paths under `~/Documents`; the isolated stack under `/tmp` applied all
migrations successfully. Supabase CLI 2.109 then truncated the pgTAP bind path,
so the same eight SQL files were streamed directly to that healthy isolated
Postgres container with `ON_ERROR_STOP`; all TAP results were `ok`. The test
stack was stopped and removed after verification.
