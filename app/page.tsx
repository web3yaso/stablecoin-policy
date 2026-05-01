"use client";

import { useRef } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import Hero from "@/components/hero/Hero";
import Header from "@/components/ui/Header";
import MapShell from "@/components/map/MapShell";
import FadeInOnView from "@/components/ui/FadeInOnView";
import { useScrollProgress } from "@/lib/use-scroll-progress";
import { useLocale } from "@/contexts/LocaleContext";
import { t as tr } from "@/lib/i18n";

// Below-fold sections — lazy-loaded so the initial JS bundle only
// includes Hero + MapShell + Section 1. Each dynamic import creates a
// separate chunk that loads on demand as the user scrolls.
const AIOverview = dynamic(() => import("@/components/sections/AIOverview"));
const LegislationTable = dynamic(() => import("@/components/sections/LegislationTable"));
const PoliticiansOverview = dynamic(() => import("@/components/sections/PoliticiansOverview"));
const LiveNews = dynamic(() => import("@/components/sections/LiveNews"));
import type {
  Region,
  ViewTarget,
} from "@/types";

function smoothScrollToMap(duration = 1200) {
  if (typeof window === "undefined") return;
  const targetY = window.innerHeight * 2.2;
  const startY = window.scrollY;
  if (startY >= targetY - 1) return;
  const distance = targetY - startY;
  const startTime = performance.now();
  const ease = (t: number) => 1 - Math.pow(1 - t, 4);
  const step = (now: number) => {
    const elapsed = now - startTime;
    const t = Math.min(1, elapsed / duration);
    window.scrollTo(0, startY + distance * ease(t));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export default function Page() {
  const progress = useScrollProgress();
  const { locale } = useLocale();
  const navigateRef = useRef<((t: ViewTarget) => void) | null>(null);

  const handleNavigateToEntity = (t: ViewTarget) => {
    navigateRef.current?.(t);
    smoothScrollToMap();
  };

  const handleGlobeRegionClick = (region: Region) => {
    navigateRef.current?.({
      region,
      naView: "countries",
      selectedGeoId: null,
    });
    smoothScrollToMap(1800);
  };

  return (
    <>
      <Header />
      <MapShell
        revealProgress={progress}
        navigateRef={navigateRef}
      />
      <Hero progress={progress} onRegionClick={handleGlobeRegionClick} />
      <div className="h-[400vh]" aria-hidden />

      {/* Section 1 — Latest developments */}
      <section className="relative z-10 bg-bg border-t border-black/[.06]">
        <div className="max-w-5xl mx-auto px-8 py-20">
          <div className="text-[13px] font-medium text-muted tracking-tight mb-2">
            {tr(locale, "page.s1.label")}
          </div>
          <h2 className="text-3xl md:text-4xl font-semibold text-ink tracking-tight leading-[1.1] mb-10">
            {tr(locale, "page.s1.title")}
          </h2>
          <FadeInOnView>
            <AIOverview />
          </FadeInOnView>
        </div>
      </section>

      {/* Section 2 — Full legislation table */}
      <section
        id="legislation"
        className="relative z-10 bg-white border-t border-black/[.06] scroll-mt-20"
      >
        <div className="max-w-5xl mx-auto px-8 pt-20 pb-24">
          <div className="text-[13px] font-medium text-muted tracking-tight mb-2">
            {tr(locale, "page.s2.label")}
          </div>
          <h2 className="text-3xl md:text-4xl font-semibold text-ink tracking-tight leading-[1.1] mb-10">
            {tr(locale, "page.s2.title")}
          </h2>
          <FadeInOnView>
            <LegislationTable
              dimension="overall"
              onNavigateToEntity={handleNavigateToEntity}
            />
          </FadeInOnView>
        </div>
      </section>

      {/* Section 3 — Who voted how */}
      <section
        id="politicians"
        className="relative z-10 bg-bg border-t border-black/[.06] scroll-mt-20"
      >
        <div className="max-w-5xl mx-auto px-8 pt-20 pb-24">
          <div className="text-[13px] font-medium text-muted tracking-tight mb-2">
            {tr(locale, "page.s3.label")}
          </div>
          <h2 className="text-3xl md:text-4xl font-semibold text-ink tracking-tight leading-[1.1] mb-2">
            {tr(locale, "page.s3.title")}
          </h2>
          <p className="text-sm text-muted mb-10 max-w-xl">
            {tr(locale, "page.s3.sub")}
          </p>
          <FadeInOnView>
            <PoliticiansOverview />
          </FadeInOnView>
        </div>
      </section>

      {/* Section 4 — Live news feed */}
      <section
        id="news"
        className="relative z-10 bg-white border-t border-black/[.06] scroll-mt-20"
      >
        <div className="max-w-5xl mx-auto px-8 pt-20 pb-24">
          <div className="text-[13px] font-medium text-muted tracking-tight mb-2">
            {tr(locale, "page.s4.label")}
          </div>
          <h2 className="text-3xl md:text-4xl font-semibold text-ink tracking-tight leading-[1.1] mb-10 inline-flex items-center gap-3">
            {tr(locale, "page.s4.title")}
            <span
              className="live-dot"
              role="img"
              aria-label="Live feed — updated automatically"
              title="Live feed — updated automatically"
            />
          </h2>
          <FadeInOnView>
            <LiveNews />
          </FadeInOnView>
        </div>
      </section>

      {/* Footer */}
      <section className="relative z-10 bg-bg border-t border-black/[.06]">
        <div className="max-w-5xl mx-auto px-8 py-10 flex flex-wrap items-center justify-between gap-4 text-xs text-muted">
          <span>{tr(locale, "footer.brand")}</span>
          <div className="flex gap-6">
            <Link href="/about" className="hover:text-ink transition-colors">
              {tr(locale, "footer.about")}
            </Link>
            <Link href="/methodology" className="hover:text-ink transition-colors">
              {tr(locale, "footer.methodology")}
            </Link>
            <Link href="/contact" className="hover:text-ink transition-colors">
              {tr(locale, "footer.contact")}
            </Link>
          </div>
          <span>
            {tr(locale, "footer.built_by")}{" "}
            <a
              href="https://x.com/web3law_tech"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-muted/40 decoration-[0.5px] underline-offset-4 hover:decoration-ink hover:text-ink transition-colors"
            >
              @web3law_tech
            </a>
          </span>
        </div>
      </section>
    </>
  );
}
