import Link from "next/link";
import type { Metadata } from "next";
import NuanceLegend from "@/components/sections/NuanceLegend";

export const metadata: Metadata = {
  title: "Methodology · Stablecoin Policy",
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
            This project combines normalized jurisdiction records, official
            legislation links, a versioned legal corpus, and an official-source
            update pipeline. The goal is to assemble a Stablecoin policy map
            that can be traced back to public documents.
          </p>
          <p>
            The public tracker uses four source layers: official legal and
            regulatory documents, normalized jurisdiction files, first-party
            update feeds, and map assets. Individual rules and update cards
            retain source links; paid playbooks pin versioned claims and
            evidence through the authenticated domain API.
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
            and discovered through{" "}
            <a
              href="https://openstates.org"
              target="_blank"
              rel="noopener noreferrer"
              className="text-ink underline underline-offset-2 hover:text-muted transition-colors"
            >
              Open States
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
            Editorial classifications can become stale as rules move. The
            generated timestamp and source links make that limitation visible;
            corrections are welcome.
          </p>

          <h2 className="text-xl font-semibold text-ink tracking-tight pt-4">
            How news and summaries work
          </h2>
          <p>
            The homepage overview and entity news tabs are generated from
            first-party feeds in{" "}
            <code className="text-ink">data/news/feeds.json</code> and
            government APIs configured in{" "}
            <code className="text-ink">data/news/professional-sources.json</code>.
            The poller retrieves official documents, preserves document IDs
            and versions, filters for stablecoin relevance, and writes the
            results to{" "}
            <code className="text-ink">data/news/summaries.json</code>.
          </p>
          <p>
            Regional homepage summaries are then regenerated from those
            entity news buckets, published as an immutable dataset release,
            and read through{" "}
            <code className="text-ink">
              /api/public/datasets/news-summaries
            </code>.
            News is useful for
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
          lens. The legend below shows the five dimensions and issuance color
          logic that drive the current map.
        </p>
        <NuanceLegend />
      </div>
    </main>
  );
}
