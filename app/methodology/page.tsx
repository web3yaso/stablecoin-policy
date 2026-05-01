import Link from "next/link";
import type { Metadata } from "next";
import NuanceLegend from "@/components/sections/NuanceLegend";

export const metadata: Metadata = {
  title: "Methodology · Track Policy",
};

export default function MethodologyPage() {
  return (
    <main className="min-h-screen bg-white">
      <div className="max-w-3xl mx-auto px-8 py-24">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-ink transition-colors mb-16"
        >
          ← Back
        </Link>

        <div className="text-[13px] font-medium text-muted tracking-tight mb-3">
          Methodology
        </div>
        <h1 className="text-4xl md:text-5xl font-semibold text-ink tracking-tight leading-[1.05] mb-10">
          How I build the data
        </h1>

        <div className="text-base text-ink/80 leading-relaxed space-y-5">
          <p>
            If you read something wrong,{" "}
            <a
              href="mailto:reksopuro.isabelle@gmail.com"
              className="text-ink underline underline-offset-2 hover:text-muted transition-colors"
            >
              please let me know
            </a>
            .
          </p>

          <h2 className="text-xl font-semibold text-ink tracking-tight pt-4">
            What powers this tracker
          </h2>
          <p>
            This project combines hand-reviewed jurisdiction files,
            official legislation links, public political datasets, and a
            curated RSS news pipeline. The goal is not to mirror one
            vendor feed. It is to assemble a stablecoin-policy map that
            can be traced back to public documents.
          </p>
          <p>
            At a high level, there are five source layers: US legislation,
            international country files, news feeds, politician data, and
            map/geography assets. Individual bills and news cards keep
            their own source links in the UI; this page is the rollup.
          </p>

          <h2 className="text-xl font-semibold text-ink tracking-tight pt-4">
            Where legislation comes from
          </h2>
          <p>
            US federal bills are sourced from{" "}
            <a
              href="https://www.congress.gov"
              target="_blank"
              rel="noopener noreferrer"
              className="text-ink underline underline-offset-2 hover:text-muted transition-colors"
            >
              Congress.gov
            </a>
            . US state bills are sourced from official legislature links
            and normalized through{" "}
            <a
              href="https://legiscan.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-ink underline underline-offset-2 hover:text-muted transition-colors"
            >
              LegiScan
            </a>
            {" "}when available. International stablecoin frameworks are
            stored country by country in{" "}
            <code className="text-ink">data/international/*.json</code>,
            and each file includes primary legal or regulator links for
            the measures described there.
          </p>

          <h2 className="text-xl font-semibold text-ink tracking-tight pt-4">
            How bills get tagged
          </h2>
          <p>
            Each bill gets a set of{" "}
            <strong className="text-ink font-semibold">impact tags</strong>
            . For the stablecoin lens, the main dimensions are issuance,
            reserve backing, consumer protection, cross-border treatment,
            and monetary sovereignty. Tags describe what a measure does.
            They do not say whether it is normatively good or bad.
          </p>
          <p>
            Tagging is done with Claude Sonnet 4.6. The model reads each
            bill&rsquo;s summary and picks applicable tags from a fixed
            taxonomy. I spot-check the output, but I do not claim every
            tag is hand-labeled.
          </p>

          <h2 className="text-xl font-semibold text-ink tracking-tight pt-4">
            How stance gets picked
          </h2>
          <p>
            A jurisdiction&rsquo;s{" "}
            <strong className="text-ink font-semibold">stance</strong> can
            be favorable, review, restrictive, or none depending on the
            lens. For stablecoin policy, the most visible map coloring is
            the issuance outcome: non-bank permitted, bank-only, private
            stablecoin banned, or unclear / in progress.
          </p>
          <p>
            Those judgments come from the current legal position and the
            weight of active measures. Enacted rules count more than floor
            passage; floor passage counts more than committee movement;
            committee counts more than filed bills.
          </p>
          <p>
            Some of these classifications will age badly as rules move. If
            you work on one of these jurisdictions and think the read is
            off, please reach out.
          </p>

          <h2 className="text-xl font-semibold text-ink tracking-tight pt-4">
            How news and summaries work
          </h2>
          <p>
            The homepage overview and entity news tabs are generated from
            curated RSS feeds in{" "}
            <code className="text-ink">data/news/feeds.json</code>. The
            poller fetches feed items, filters for stablecoin relevance,
            summarizes article text, and writes the results to{" "}
            <code className="text-ink">data/news/summaries.json</code>.
          </p>
          <p>
            Regional homepage summaries are then regenerated from those
            entity news buckets and copied to{" "}
            <code className="text-ink">public/news-summaries.json</code>,
            which the homepage reads at runtime. News is useful for
            recency, but it is not the authoritative legal source for a
            jurisdiction&rsquo;s status.
          </p>
        </div>

        <div className="mt-16 mb-3 text-[13px] font-medium text-muted tracking-tight">
          Impact tags by dimension
        </div>
        <h2 className="text-2xl md:text-3xl font-semibold text-ink tracking-tight leading-[1.1] mb-6">
          The full tag taxonomy
        </h2>
        <p className="text-base text-ink/80 leading-relaxed mb-8">
          The primary taxonomy in this project is the stablecoin-policy
          lens. The legend below shows the dimensions and issuance color
          logic that drive the current map. Some legacy data-center and AI
          tags still exist in the codebase, but they are no longer the
          main analytical frame of the site.
        </p>
        <NuanceLegend />
      </div>
    </main>
  );
}
