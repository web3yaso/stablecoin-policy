import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Contact · Track Policy",
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
            If I got something wrong, if a bill is missing, or if you
            disagree with a stance call, please tell me. Corrections are
            how the site gets more accurate, and I want them.
          </p>
          <p>
            Tips on things I should be tracking are also welcome. State
            committees, EU developments, or anything happening outside
            the usual legislative portals.
          </p>
        </div>

        <div className="mt-12 pt-10 border-t border-black/[.06] space-y-5">
          <div>
            <div className="text-[11px] font-medium tracking-tight text-muted mb-1.5">
              Email
            </div>
            <a
              href="mailto:reksopuro.isabelle@gmail.com"
              className="text-base text-ink underline underline-offset-2 hover:text-muted transition-colors"
            >
              reksopuro.isabelle@gmail.com
            </a>
          </div>

          <div>
            <div className="text-[11px] font-medium tracking-tight text-muted mb-1.5">
              Twitter / X
            </div>
            <a
              href="https://x.com/isareksopuro"
              target="_blank"
              rel="noopener noreferrer"
              className="text-base text-ink underline underline-offset-2 hover:text-muted transition-colors"
            >
              @isareksopuro
            </a>
            <span className="text-sm text-muted ml-2">
              DMs are open for quick tips.
            </span>
          </div>

          <div>
            <div className="text-[11px] font-medium tracking-tight text-muted mb-1.5">
              GitHub
            </div>
            <a
              href="https://github.com/isabellereks/track-policy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-base text-ink underline underline-offset-2 hover:text-muted transition-colors"
            >
              github.com/isabellereks/track-policy
            </a>
            <span className="text-sm text-muted ml-2">
              Open an issue for data corrections.
            </span>
          </div>

          <div>
            <div className="text-[11px] font-medium tracking-tight text-muted mb-1.5">
              Personal site
            </div>
            <a
              href="https://isabellereks.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-base text-ink underline underline-offset-2 hover:text-muted transition-colors"
            >
              isabellereks.com
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}
