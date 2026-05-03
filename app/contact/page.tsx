import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Contact · Stablecoin Policy",
};

export default function ContactPage() {
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
          Contact
        </div>
        <h1 className="text-4xl md:text-5xl font-semibold text-ink tracking-tight leading-[1.05] mb-10">
          Get in touch
        </h1>

        <div className="text-base text-ink/80 leading-relaxed space-y-5">
          <p>
            If something is wrong, if a bill is missing, or if you
            disagree with a classification call, please reach out.
            Corrections make the tracker better.
          </p>
          <p>
            Tips on stablecoin legislation, regulator notices, issuer
            developments, or country-level framework changes are also
            welcome.
          </p>
        </div>

        <div className="mt-12 pt-10 border-t border-black/[.06] space-y-5">
          <div>
            <div className="text-[11px] font-medium tracking-tight text-muted mb-1.5">
              Twitter / X
            </div>
            <a
              href="https://x.com/web3law_tech"
              target="_blank"
              rel="noopener noreferrer"
              className="text-base text-ink underline underline-offset-2 hover:text-muted transition-colors"
            >
              @web3law_tech
            </a>
            <span className="text-sm text-muted ml-2">
              DMs are open for corrections, source suggestions, and
              partnership inquiries.
            </span>
          </div>

          <div>
            <div className="text-[11px] font-medium tracking-tight text-muted mb-1.5">
              GitHub
            </div>
            <a
              href="https://github.com/web3yaso/stablecoin-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-base text-ink underline underline-offset-2 hover:text-muted transition-colors"
            >
              github.com/web3yaso/stablecoin-policy
            </a>
            <span className="text-sm text-muted ml-2">
              Open an issue or reference a commit when reporting a data
              correction.
            </span>
          </div>

          <div>
            <div className="text-[11px] font-medium tracking-tight text-muted mb-1.5">
              What to send
            </div>
            <p className="text-base text-ink/80 leading-relaxed">
              The most helpful reports include the jurisdiction, bill or
              rule name, a short note about what looks wrong, and the
              primary source link you want me to review.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
