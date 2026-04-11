"use client";

import { useRef, useState } from "react";
import Hero from "@/components/hero/Hero";
import MapShell from "@/components/map/MapShell";
import SummaryBar from "@/components/sections/SummaryBar";
import DimensionToggle from "@/components/sections/DimensionToggle";
import AIOverview from "@/components/sections/AIOverview";
import NuanceLegend from "@/components/sections/NuanceLegend";
import LegislationTable from "@/components/sections/LegislationTable";
import { useScrollProgress } from "@/lib/use-scroll-progress";
import type { Dimension, ViewTarget } from "@/types";

export default function Page() {
  const progress = useScrollProgress();
  const [dimension, setDimension] = useState<Dimension>("overall");
  const navigateRef = useRef<((t: ViewTarget) => void) | null>(null);

  const handleNavigateToEntity = (t: ViewTarget) => {
    navigateRef.current?.(t);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <>
      <MapShell
        revealProgress={progress}
        dimension={dimension}
        navigateRef={navigateRef}
      />
      <Hero progress={progress} />
      <div className="h-[400vh]" aria-hidden />

      <section className="relative z-10 bg-white">
        <div className="max-w-5xl mx-auto px-8 pt-16 pb-10">
          <SummaryBar />
        </div>
        <div className="max-w-5xl mx-auto px-8 pb-10">
          <DimensionToggle dimension={dimension} onChange={setDimension} />
        </div>
        <div className="max-w-5xl mx-auto px-8 pb-10">
          <AIOverview />
        </div>
        <div className="max-w-5xl mx-auto px-8 pb-10">
          <NuanceLegend />
        </div>
        <div className="max-w-5xl mx-auto px-8 pb-20">
          <LegislationTable
            dimension={dimension}
            onNavigateToEntity={handleNavigateToEntity}
          />
        </div>

        <div className="border-t border-black/[.06]">
          <div className="max-w-5xl mx-auto px-8 py-10 flex flex-wrap items-center justify-between gap-4 text-xs text-muted">
            <span>Track Policy</span>
            <div className="flex gap-6">
              <span>About</span>
              <span>Methodology</span>
              <span>Contact</span>
            </div>
            <span>
              Inspired by{" "}
              <a
                href="https://datacenterbans.com"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-ink transition-colors"
              >
                datacenterbans.com
              </a>
              <span aria-hidden> · </span>
              Icons by{" "}
              <a
                href="https://streamlinehq.com"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-ink transition-colors"
              >
                Streamline
              </a>
            </span>
          </div>
        </div>
      </section>
    </>
  );
}
