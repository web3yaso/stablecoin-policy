# Publish-Decision Agent — Design

> **Source-discovery note (2026-07-30):** the dynamic Google News top-up
> assumed by this historical design is no longer active. The current discovery
> architecture is documented in
> [`../../professional-source-migration.md`](../../professional-source-migration.md).
> **DO NOT EXECUTE OR RESTORE THE GOOGLE DISCOVERY STEPS BELOW.** They are
> preserved solely for historical context.

**Date:** 2026-05-30
**Scope:** New `scripts/agents/publish-decision-agent.ts` + workflow integration to gate the existing weekly sellable report on an LLM publish/skip decision; agent uses Anthropic's native `web_search` tool to verify high-impact claims before deciding.

**Builds on:** `feat/news-reports-optimization` (PR #4) — assumes the news pipeline, two-layer filter, dynamic web-search top-up, rate-limit safety guards, and `generate-daily-report.ts` per-jurisdiction prompt are already in place.

**Out of scope:** report content schema, encryption, x402 catalog upsert, sellable slug, pricing, multi-region briefs, dynamic pricing, multi-language, event-driven trigger, skip-streak escalation, news pipeline itself.

## Goals

1. Replace the unconditional "generate weekly report on every cron tick" behavior with an LLM-driven publish/skip gate.
2. Verify high-impact news claims via web search before deciding, to reduce false positives (publishing on hallucinated or stale signal).
3. Make every decision auditable: durable JSON archive plus user-facing markdown rationale (whether published or skipped).
4. Cap autonomous spend with a monthly USD hard ceiling.

## Non-goals (decided)

- Agent does not author the report (Sonnet still generates report content via existing `generate-daily-report.ts`).
- Agent does not set price, slug, language, or content shape.
- No auto-publish fallback after consecutive skips — agent has unlimited authority to skip.
- No notifications, dashboards, or email digests for now.

## Architecture

A single Sonnet call with the `web_search` tool exposed; Anthropic's native tool-use loop lets the model search 0–8 times within one logical invocation, then emit a final JSON decision. Result is parsed by the calling script, which either invokes the existing report generator (on `publish`) or writes a skip notice (on `skip`).

```
.github/workflows/news-rss.yml  (weekly Sunday 02:00 UTC)
  ├─ Poll feeds            → scripts/sync/news-rss.ts  (existing)
  └─ Decide & publish      → scripts/agents/publish-decision-agent.ts  (NEW)
                                  │
                                  ├─ Read top-30 relevance-scored news (7d)
                                  ├─ Compute legislation delta vs snapshot
                                  ├─ Load past 4 weeks of decisions
                                  ├─ Pre-flight budget check
                                  ├─ Sonnet messages.create(tools=[web_search])
                                  │     └─ tool-use loop (0–8 search calls)
                                  ├─ Parse final JSON decision
                                  ├─ Update budget + snapshot
                                  ├─ Write data/reports/decisions/<date>.json
                                  ├─ Write public/reports/decisions/<date>.md
                                  └─ If publish:
                                       └─ exec scripts/reports/generate-daily-report.ts
```

## File structure

| Path | Type | Purpose |
|---|---|---|
| `scripts/agents/publish-decision-agent.ts` | new file | Agent entry point; ~250 lines |
| `data/reports/decisions/<YYYY-MM-DD>.json` | new dir; committed | Full audit trail of every decision |
| `public/reports/decisions/<YYYY-MM-DD>.md` | new dir; committed | User-facing reasoning markdown |
| `data/reports/.agent-budget.json` | new; **gitignored** | Per-runner monthly spend ledger |
| `data/reports/.last-decision-snapshot.json` | new; **gitignored** | Legislation counts at last decision time, for delta computation |
| `scripts/smoke/agent-dryrun.ts` | new file | Zero-API agent dry-run smoke |
| `.github/workflows/news-rss.yml` | modified | Replace "Generate report" step with agent invocation |
| `.gitignore` | modified | Add `.agent-budget.json` and `.last-decision-snapshot.json` |
| `scripts/reports/generate-daily-report.ts` | **unchanged** | Report content pipeline preserved as-is |

**Date convention:** all `<YYYY-MM-DD>` filenames use UTC (`new Date().toISOString().slice(0, 10)`). The cron itself runs in UTC, so this avoids any local-timezone drift.

## Decision input

### What the LLM sees

```ts
type AgentInput = {
  generatedAt: string;
  date: string;

  // 1. Top-30 relevance-scored news items from the last 7 days.
  // Algorithm mirrors components/sections/LiveNews.tsx relevanceScore:
  // HIGH_SIGNAL × 3 + MED_SIGNAL × 1 + article-bonus × 2, multiplied by
  // 7-day-half-life recency decay.
  recentNews: Array<{
    date: string;
    entity: string;
    source: string;
    headline: string;
    url: string;
    summary?: string;
    relevanceScore: number;
  }>;

  // 2. Legislation delta vs last decision's snapshot.
  legislationDelta: {
    federal: { added: number; updated: number; recentBills: string[] };
    states: Array<{ state: string; added: number; updated: number }>;
    international: Array<{ jurisdiction: string; added: number; updated: number }>;
  };

  // 3. Last 4 weeks of decisions, for context (LLM consumes — no hardcoded
  // rule).
  recentDecisionHistory: Array<{
    date: string;
    decision: "publish" | "skip";
    reasoning: string;
  }>;
};
```

### Why top-30 and not all surviving candidates

The full 7-day candidate set can exceed 500 items (empirically observed in the dryrun smoke). Relevance-scoring narrows to the items the LLM should actually reason about. Token spend stays well within the 4K `max_tokens` budget; reasoning quality stays high.

### Legislation delta source

`data/reports/.last-decision-snapshot.json` (per-runner, gitignored) records counts at last decision time:

```json
{
  "snapshotAt": "2026-05-23T02:00:00Z",
  "federal": { "billCount": 23, "latestUpdate": "2026-05-22" },
  "states": { "CA": { "billCount": 4, "latestUpdate": "2026-05-19" }, "...": "..." },
  "international": { "european-union": { "billCount": 7, "latestUpdate": "2026-05-21" } }
}
```

First run: snapshot file absent, delta computed against zeros (everything looks new on first run; LLM will likely publish — acceptable bootstrap behavior).

### Recent decision history

Read the 4 most recent `data/reports/decisions/*.json` files by filename date (newest first). The LLM sees its own past reasoning. No code-level enforcement of skip-streak limits — the LLM judges whether to break a streak. On a weekly cadence these 4 files cover ~28 days; if cadence changes, the count still means "last 4 decisions" not "last 4 weeks".

## Sonnet invocation

```ts
const message = await client.messages.create({
  model: "claude-sonnet-4-6",
  max_tokens: 4000,
  temperature: 0.2,
  system: SYSTEM_PROMPT,
  tools: [{
    type: "web_search_20250305",
    name: "web_search",
    max_uses: 8,
  }],
  messages: [{ role: "user", content: formatAgentInput(input) }],
});
```

`max_uses: 8` is the per-call ceiling on `web_search` invocations (first guard); monthly $ cap is the second guard.

### System prompt

```
You are the publish-decision agent for the Stablecoin Policy Tracker
weekly brief. Each week you receive a digest of news and legislation
deltas; you decide whether the week's developments justify publishing
a paid $0.10 USDC brief, or whether the signal is too thin and the
brief should be skipped.

Decision criteria (your judgment, not a hard rule):
- Publish when: a major stablecoin/digital-asset bill advanced,
  passed, or was vetoed; a regulator issued enforcement, new
  guidance, or a license decision; a major issuer (Tether, Circle,
  Paxos, PayPal, MakerDAO/Sky, Ethena) announced a reserve,
  redemption, or governance change; a court ruling affecting
  stablecoin policy.
- Skip when: only routine commentary, derivative analysis, opinion
  pieces, or repeat coverage of already-published events.

You have a web_search tool. Use it to verify high-impact claims
before deciding. Examples worth verifying: "X bill passed", "Y
regulator launched action against Z", "Tether redeemed $N". Do not
search for routine items.

You can see the last 4 weeks of your own decisions. Use them as
context (e.g., if you've skipped 3 weeks in a row, be especially
careful that you're not under-reporting).

Return a single JSON object as your final response (no markdown, no
prose around it):

{
  "decision": "publish" | "skip",
  "confidence": 0.0 to 1.0,
  "key_events": [
    {
      "headline": "...",
      "verification": "verified" | "unverified" | "contradicted",
      "source_url": "..."
    }
  ],
  "reasoning": "2–4 sentences explaining the decision",
  "skip_recoverable_signal": "<only if skip — what would change your mind>"
}
```

### User message format

```
Week ending: 2026-05-31
Time generated: 2026-05-31T02:00:00Z

## Recent decision history (last 4 weeks)
- 2026-05-24: skip — "Past 7 days produced routine commentary only..."
- 2026-05-17: publish — "Senate Banking Committee marked up CLARITY Act..."
- ...

## Legislation delta vs last decision
- US Federal: 2 bills added, 1 updated. Recent: "S.123 STABLE Act amendments"
- US States: NY (1 added), CA (1 updated)
- International: EU (3 updated)

## Top news items this week (sorted by relevance)
1. [2026-05-29] Reuters (United States): "SEC charges payment-stablecoin issuer with..." (relevance 8.2)
   <summary>...
2. [2026-05-28] FT (European Union): "EBA finalizes ART reserve rules under MiCA..." (relevance 7.5)
   ...
```

## Decision output and routing

### `decision == "publish"`

1. Write `data/reports/decisions/<date>.json` with full structured archive.
2. Write `public/reports/decisions/<date>.md`:
   ```markdown
   ## Why this week's brief was published

   <reasoning paragraph>

   ### Key events verified
   - [Headline](url) — verified
   - [Headline](url) — unverified (cited in brief but not corroborated)
   ```
3. Update `.agent-budget.json` (add this decision's cost).
4. Update `.last-decision-snapshot.json` (current legislation counts).
5. `subprocess` invoke `npx tsx scripts/reports/generate-daily-report.ts`. Existing report pipeline runs unchanged — Sonnet generates, AES-256-GCM encrypts, catalog upserts, push.
6. Existing workflow's `Commit if changed` step picks up both the agent artifacts and the new report.

### `decision == "skip"`

1. Write `data/reports/decisions/<date>.json`.
2. Write `public/reports/decisions/<date>.md`:
   ```markdown
   ## No brief this week

   <reasoning>

   ### What would trigger a brief
   <skip_recoverable_signal — LLM's own answer to "what would change my mind">

   _Last published: <date of last publish decision>_
   ```
3. Update budget + snapshot.
4. **Do NOT** invoke `generate-daily-report.ts`.
5. Existing catalog entry (`data/reports/index.json` for `global-stablecoin-policy-report`) stays at the last-published version — paying subscribers can still fetch the most recent brief. No empty content shipped.

### Sellable slug semantics

`global-stablecoin-policy-report` remains a single, daily-refreshed slug. Skip weeks mean `publishedAt` is older than 7 days; that's fine. Discovery-side (x402 catalog) reflects last real publish; no "stub" entries.

## Budget guard

### Schema

`data/reports/.agent-budget.json` (gitignored):
```json
{
  "month": "2026-05",
  "spent_usd": 0.42,
  "decisions": [
    { "date": "2026-05-04", "decision": "publish", "cost": 0.18 },
    { "date": "2026-05-11", "decision": "skip", "cost": 0.06 },
    { "date": "2026-05-18", "decision": "publish", "cost": 0.18 }
  ]
}
```

### Constants

```ts
const MAX_MONTHLY_USD = Number(process.env.AGENT_MAX_MONTHLY_USD ?? 5.00);
const ESTIMATED_CALL_COST_USD = 0.30;  // conservative upper-bound; used for pre-flight
const SONNET_INPUT_USD_PER_MTOK = 3.00;
const SONNET_OUTPUT_USD_PER_MTOK = 15.00;
const WEB_SEARCH_USD_PER_CALL = 0.01;
```

### Lifecycle per run

1. **Read** `.agent-budget.json`. If `month !== currentMonth(YYYY-MM)`, reset (`spent_usd=0, decisions=[], month=currentMonth`).
2. **Pre-flight check**: if `spent_usd + ESTIMATED_CALL_COST_USD > MAX_MONTHLY_USD`, force-skip:
   - Write decision file with `decision: "skip", reasoning: "Monthly budget exhausted ($X / $Y). Agent will resume next month or after AGENT_MAX_MONTHLY_USD is raised.", reason: "budget_exhausted"`.
   - Skip the Sonnet call entirely. Do not invoke `generate-daily-report.ts`.
   - Exit 0 (not a workflow failure — the agent did its job).
3. **Run agent normally**.
4. **Post-call** update budget. `webSearchCount` is derived by counting `server_tool_use` (or `tool_use` with `name === "web_search"`) blocks across the final `message.content` plus all assistant turns recorded in `message.usage.server_tool_use?.web_search_requests` (whichever the Anthropic SDK surfaces in the current version):
   ```ts
   const webSearchCount =
     message.usage.server_tool_use?.web_search_requests ??
     message.content.filter(b => b.type === "server_tool_use" && b.name === "web_search").length;
   const cost =
     (message.usage.input_tokens / 1_000_000) * SONNET_INPUT_USD_PER_MTOK +
     (message.usage.output_tokens / 1_000_000) * SONNET_OUTPUT_USD_PER_MTOK +
     webSearchCount * WEB_SEARCH_USD_PER_CALL;
   budget.spent_usd += cost;
   budget.decisions.push({ date, decision, cost });
   writeBudget(budget);
   ```

### Recovery from budget exhaustion

User actions to recover:
- Raise `AGENT_MAX_MONTHLY_USD` in GitHub Actions secret (or env var) and re-run workflow_dispatch.
- Or wait for next month.
- Or manually delete `.agent-budget.json` (rare; resets the ledger).

## Failure modes

| Failure | Behavior | Rationale |
|---|---|---|
| `ANTHROPIC_API_KEY` missing | exit 1 (workflow fails) | Misconfigured env; fail loud |
| Sonnet API 429 / 5xx | Fallback to publish | Subscriber-safe default — better to ship than mysteriously omit |
| Sonnet returns invalid JSON or schema mismatch | Fallback to publish + warn log | Same rationale |
| `web_search` tool fails mid-loop | LLM continues with partial verification; Anthropic SDK handles tool errors gracefully | Degraded but functional |
| Monthly budget exhausted | Force skip + decision file with `reason: "budget_exhausted"` + exit 0 | Hard cap; expected behavior |
| `generate-daily-report.ts` subprocess fails | Log error, exit 1 | Matches existing workflow behavior |
| `.agent-budget.json` write fails | Warn but continue | Non-fatal; recomputed next run from history |
| `.last-decision-snapshot.json` write fails | Warn but continue | Non-fatal; first-run-like delta next week |
| First-ever run, no snapshot, no history | Delta = everything; history = empty; agent likely publishes | Acceptable bootstrap behavior |

### Fallback-to-publish rationale

The agent's failure mode favors publishing over skipping because:
- A skip when there's real signal hurts subscribers (they paid; they expect content).
- A publish when signal is thin produces a low-value brief but the existing fallback inside `generate-daily-report.ts` (the honest sparse-data fallback added in PR #4) already handles low-signal weeks gracefully.
- Therefore "fail open" toward publish is the lower-cost error.

## Observability

### Stdout single-line summary (per run)

```
agent: decision=publish confidence=0.85 web_searches=4 cost=$0.18 budget=$0.60/$5.00 (12% of month)
agent: decision=skip    confidence=0.72 web_searches=2 cost=$0.07 budget=$0.13/$5.00 reason="routine derivative coverage only"
agent: decision=skip    confidence=1.00 web_searches=0 cost=$0.00 budget=$5.02/$5.00 reason="budget_exhausted"
```

### Two-tier archive

- **Internal audit**: `data/reports/decisions/<date>.json` — full reasoning, sources consulted, tool call breakdown, cost, model version. Committed to repo.
- **Public transparency**: `public/reports/decisions/<date>.md` — human-readable reasoning. Committed. Next.js can route `/reports/decisions/<date>` to render.

### Long-term audit path

```bash
ls data/reports/decisions/        # all decisions ever
git log -- data/reports/decisions/ # when each was committed (cron timestamp)
```

## Workflow integration

`.github/workflows/news-rss.yml` — replace the existing report step:

```yaml
# BEFORE
- name: Generate & publish daily sellable report
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    REPORTS_ENCRYPTION_KEY: ${{ secrets.REPORTS_ENCRYPTION_KEY }}
  run: npx tsx scripts/reports/generate-daily-report.ts

# AFTER
- name: Decide & publish report (agent)
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    REPORTS_ENCRYPTION_KEY: ${{ secrets.REPORTS_ENCRYPTION_KEY }}
    AGENT_MAX_MONTHLY_USD: ${{ vars.AGENT_MAX_MONTHLY_USD }}  # optional; defaults to 5.00
  run: npx tsx scripts/agents/publish-decision-agent.ts
```

`Commit if changed` step expanded path list to include `data/reports/decisions/` and `public/reports/decisions/`:

```yaml
- name: Commit if changed
  run: |
    if [[ -n "$(git status --porcelain data/news/ public/news-summaries.json lib/placeholder-data.ts data/reports/ public/reports/)" ]]; then
      git config user.name "github-actions[bot]"
      git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
      git add data/news/summaries.json data/news/.rss-started public/news-summaries.json lib/placeholder-data.ts data/reports/index.json data/reports/global-stablecoin-policy-report.md.enc data/reports/daily data/reports/decisions public/reports/daily public/reports/decisions
      git commit -m "news+report: weekly refresh $(date -u +%Y-%m-%dT%H:%M:%SZ)"
      git push
    else
      echo "No changes."
    fi
```

## Cost model

Per run expected:
- Sonnet input: ~3K tokens (system + digest) × $3/M = $0.009
- Sonnet output: ~1K tokens (reasoning + JSON) × $15/M = $0.015
- Web search: 0–8 calls × $0.01 = $0.00–$0.08
- Total per decision: **$0.02–$0.10**

Plus the existing `generate-daily-report.ts` cost (Sonnet ~5K input + 3K output ≈ $0.06) only when `decision == "publish"`.

Monthly expected (weekly cron, ~4.3 runs/month):
- Best case (all skip): 4.3 × $0.04 = **$0.17/month**
- Realistic (50% publish): 4.3 × ($0.06 decide + 50% × $0.06 report) = **$0.39/month**
- Worst plausible (all publish + max search): 4.3 × ($0.10 + $0.10) = **$0.86/month**

`MAX_MONTHLY_USD = 5.00` is a ~6× safety buffer over worst plausible.

## Smoke / dry-run

New `scripts/smoke/agent-dryrun.ts`:
- Sets `AGENT_DRY_RUN=1` env, plus the existing `NEWS_RSS_SKIP_AUTORUN=1` / `REPORT_SKIP_AUTORUN=1` gates (so transitive imports of news-rss.ts / generate-daily-report.ts do not auto-execute their `main()` functions)
- Imports and calls `run()` from `publish-decision-agent.ts`

Inside `publish-decision-agent.ts`, the `AGENT_DRY_RUN === "1"` branch:
- Reads all inputs normally (top-30 news, legislation delta, recent decision history)
- Formats the system + user prompt
- Prints both to stdout under clearly-labelled fences
- **Does NOT** call Sonnet
- Synthesizes a static mock decision `{decision: "skip", confidence: 0.5, reasoning: "AGENT_DRY_RUN — no live LLM call", key_events: [], skip_recoverable_signal: "—"}`
- Writes the decision file to `${TMPDIR ?? "/tmp"}/agent-dryrun-<date>.json` (not the tracked `data/reports/decisions/` dir)
- Does NOT update `.agent-budget.json` or `.last-decision-snapshot.json`
- Does NOT invoke `generate-daily-report.ts`

This mirrors the existing `news-rss-dryrun.ts` and `report-dryrun.ts` patterns. Acceptance: agent's input-assembly logic and prompt-formatting validate end-to-end with zero API cost and zero tracked-file mutation.

## Acceptance criteria

1. `npx tsc` clean after all changes.
2. `npm run lint` no new errors.
3. `npx tsx scripts/smoke/agent-dryrun.ts` prints the assembled prompt, exits 0, writes nothing to tracked files.
4. Live run on a sample week: agent successfully produces a decision JSON, decision file lands in `data/reports/decisions/`, public markdown lands in `public/reports/decisions/`, and on `publish` decision the existing report pipeline runs to completion.
5. Force-skip on budget exhausted: set `AGENT_MAX_MONTHLY_USD=0.01`, run agent, verify it skips without calling Sonnet and writes a decision file with `reason: "budget_exhausted"`.
6. Force-fallback-to-publish on Sonnet error: temporarily override `ANTHROPIC_API_KEY` to invalid value, verify agent falls back to publish and the report still ships.

## Rollback levers

- Revert workflow yaml change to invoke `generate-daily-report.ts` directly — agent is bypassed.
- Set `AGENT_MAX_MONTHLY_USD=0` — agent force-skips every run (functionally pauses publishing without code change).
- Delete `data/reports/decisions/` + `public/reports/decisions/` — removes the transparency surface; agent itself still works.

## Risks

- **LLM may over-skip if early decisions are skip-biased and history reinforces.** Mitigation: spot-check first 4–6 decisions manually; if drift toward over-skip, tighten the system prompt's "publish when" criteria or add an explicit "≥ 3 skips in 4 weeks → publish anyway" rule (this is the deferred skip-streak feature; we can reintroduce it cheaply if needed).
- **`web_search` tool may return stale or contradictory results that mislead the LLM.** Mitigation: LLM's own `verification: "contradicted"` field surfaces conflicts to the audit log; manual review of decisions where confidence < 0.5 may be warranted.
- **Subscribers may resent skip weeks.** Mitigation: the public `decisions/<date>.md` skip notice is the primary trust-building mechanism. Make sure it renders clearly in the UI.
- **Budget exhaustion in the middle of a high-signal month** silently force-skips the rest of the month. Mitigation: emit a louder warning on the second skip-due-to-budget; consider adding a GitHub issue auto-create as a follow-up enhancement.
