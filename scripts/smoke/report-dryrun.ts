/**
 * Run generate-daily-report.ts end-to-end but DO NOT:
 *   - write data/reports/*.md.enc
 *   - upsert data/reports/index.json
 *   - touch public/reports/daily/*
 *
 * Writes JSON + markdown to /tmp/ for human inspection. Respects
 * REPORT_FORCE_FALLBACK=1. Suppresses the report module's auto-invoked
 * main() via REPORT_SKIP_AUTORUN=1 so we drive it ourselves through the
 * exported run() function (added to generate-daily-report.ts in step 2).
 */
import "../env.js";

const TMP = process.env.TMPDIR ?? "/tmp";

async function main() {
  process.env.REPORT_DRY_RUN = "1";
  process.env.REPORT_SKIP_AUTORUN = "1";
  const mod = await import("../reports/generate-daily-report.js");
  if (typeof (mod as { run?: () => Promise<void> }).run !== "function") {
    throw new Error("generate-daily-report.ts must export run()");
  }
  await (mod as { run: () => Promise<void> }).run();
  console.log(`report-dryrun: outputs in ${TMP}/report-dryrun-*.json and .md`);
}

main().catch((err) => {
  console.error("report-dryrun crashed:", err);
  process.exit(2);
});
