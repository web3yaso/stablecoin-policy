import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "About · Stablecoin Policy",
};

export default function AboutPage() {
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
          About
        </div>
        <h1 className="text-4xl md:text-5xl font-semibold text-ink tracking-tight leading-[1.05] mb-10">
          What this site tracks
        </h1>

        <div className="text-base text-ink/80 leading-relaxed space-y-5">
          <p>
            Stablecoins are reshaping global payments, but governments are
            taking very different approaches. Some are building dedicated
            licensing regimes, some are imposing strict guardrails, and others
            are restricting private stablecoins outright. This site exists to
            answer one direct question: what is each jurisdiction actually
            doing?
          </p>
          <p>
            Answering that question usually means reading scattered
            parliamentary records, regulatory announcements, and official
            publications. I built this atlas to bring those signals together
            in one place.
          </p>
          <p>
            The map covers major jurisdictions worldwide, including US states,
            the European Union, the United Kingdom, and key Asian markets.
            Select any country or region to review legislation, regulators,
            evidence links, and recent developments. Each jurisdiction is
            rated from supportive to restrictive based on its current legal
            and regulatory posture.
          </p>
          <p>
            Stablecoin regulation is one of the fastest-moving areas of global
            financial policy. The EU has implemented MiCA, the United States
            has advanced federal payment-stablecoin legislation, and Hong Kong,
            Singapore, and Japan have developed local frameworks. Other
            jurisdictions remain more cautious. The goal is to turn fragmented
            developments into a picture that can be understood at a glance.
          </p>
          <p>
            This site does not advocate for a particular policy outcome. It
            aims to show which proposals are active, how far they have
            progressed, and what their practical effects may be, so readers can
            form their own view from verifiable information.
          </p>

          <div className="pt-5 mt-5 border-t border-black/[.06]">
            <p className="text-muted">
              Data is updated continuously. For corrections or additions,
              please{" "}
              <Link
                href="/contact"
                className="text-ink underline underline-offset-2 hover:text-muted transition-colors"
              >
                get in touch
              </Link>
              .
            </p>
          </div>
        </div>

        <div className="mt-16 pt-10 border-t border-black/[.06]">
          <div className="text-[13px] font-medium text-muted tracking-tight mb-4">
            Sources
          </div>
          <ul className="text-sm text-ink/80 leading-relaxed space-y-2">
            <li>
              This site is forked from{" "}
              <a
                href="https://github.com/web3yaso/stablecoin-policy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-ink underline underline-offset-2 hover:text-muted transition-colors"
              >
                web3yaso/stablecoin-policy
              </a>{" "}
              , an open-source Track Policy project, and refocused on
              stablecoin policy.
            </li>
            <li>
              Legislative data references official parliamentary sources,
              regulator publications, and first-party government feeds.
            </li>
            <li>
              Icons are from{" "}
              <a
                href="https://streamlinehq.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-ink underline underline-offset-2 hover:text-muted transition-colors"
              >
                Streamline
              </a>
            </li>
            <li className="pt-2 text-muted">
              See the{" "}
              <Link
                href="/methodology"
                className="text-ink underline underline-offset-2 hover:text-muted transition-colors"
              >
                methodology
              </Link>{" "}
              {" "}page for full data notes.
            </li>
          </ul>
        </div>
      </div>
    </main>
  );
}
