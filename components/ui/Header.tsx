"use client";

import Link from "next/link";
import { useLocale } from "@/contexts/LocaleContext";
import { t } from "@/lib/i18n";

export default function Header() {
  const { locale, setLocale } = useLocale();

  return (
    <header className="h-12 bg-white/70 backdrop-blur-xl border-b border-black/[.06] px-6 flex items-center justify-between fixed top-0 left-0 right-0 z-40">
      <Link href="/" className="text-sm font-semibold text-ink">
        STABLECOIN POLICY
      </Link>
      <nav className="flex items-center gap-5 text-xs text-muted">
        <Link href="/" className="hover:text-ink transition-colors">
          {t(locale, "nav.map")}
        </Link>
        <Link href="/bills" className="hover:text-ink transition-colors">
          {t(locale, "nav.bills")}
        </Link>
        <Link href="/politicians" className="hover:text-ink transition-colors">
          {t(locale, "nav.politicians")}
        </Link>
        <Link href="/about" className="hover:text-ink transition-colors">
          {t(locale, "nav.about")}
        </Link>
        <button
          type="button"
          onClick={() => setLocale(locale === "zh" ? "en" : "zh")}
          className="ml-1 text-xs font-medium text-ink bg-black/[.05] hover:bg-black/[.09] border border-black/[.06] rounded-full px-2.5 py-1 transition-colors"
          aria-label="Toggle language"
        >
          {t(locale, "nav.toggle")}
        </button>
      </nav>
    </header>
  );
}
