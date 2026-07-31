/**
 * Read-only health check for structured first-party source adapters.
 *
 * It never writes summaries or calls the LLM. Optional keyed sources are
 * reported as skipped when no key is configured.
 */
import "../env.js";
import { runProfessionalSources } from "../sync/news-professional-sources.js";

async function main() {
  const run = await runProfessionalSources();

  console.log(`professional-sources: ${run.candidates.length} merged candidate(s)`);
  for (const result of run.results) {
    console.log(
      `  ${result.status.padEnd(7)} ${result.sourceId.padEnd(22)} ` +
        `raw=${String(result.rawItemCount).padStart(3)} ` +
        `candidates=${String(result.candidateCount).padStart(3)} ` +
        `merged=${String(result.mergedIntoOtherSources).padStart(2)} ` +
        `${result.durationMs}ms${result.note ? ` — ${result.note}` : ""}`,
    );
    for (const error of result.errors) console.log(`    error: ${error}`);
  }

  for (const candidate of run.candidates.slice(0, 12)) {
    console.log(
      `  • [${candidate.feed.sourceId}] ${candidate.parsed.officialDocumentId ?? "no-id"} ` +
        `${candidate.parsed.pubDate} ${candidate.parsed.title.slice(0, 100)}`,
    );
  }

  const required = new Set(["federal-register", "uk-legislation"]);
  const requiredFailures = run.results.filter(
    (result) => required.has(result.sourceId) && result.status === "failed",
  );
  if (requiredFailures.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("professional-sources smoke crashed:", error);
  process.exit(2);
});
