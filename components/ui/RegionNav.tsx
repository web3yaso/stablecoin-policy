"use client";

import { REGION_LABEL, REGION_ORDER, type Region } from "@/types";

interface RegionNavProps {
  region: Region;
  onChange: (region: Region) => void;
}

/**
 * Top-right arrow pair that pans between regions (NA → EU → Asia).
 * Mirrors the touch / wheel swipe gestures with a click affordance and
 * sits alongside the bottom DepthStepper region picker. Replaces the
 * older HistoryNav, since browser back / swipe-back already handle
 * drill history.
 */
export default function RegionNav({ region, onChange }: RegionNavProps) {
  const len = REGION_ORDER.length;
  const idx = REGION_ORDER.indexOf(region);
  // Wrap-around carousel: prev on the first region jumps to the last,
  // next on the last region jumps to the first.
  const prev = REGION_ORDER[(idx - 1 + len) % len];
  const next = REGION_ORDER[(idx + 1) % len];

  return (
    <div className="hidden lg:inline-flex fixed top-6 right-6 z-30 items-center gap-1 px-1.5 py-1.5 rounded-full bg-white/85 backdrop-blur-2xl shadow-[0_8px_32px_rgba(0,0,0,0.08),0_2px_8px_rgba(0,0,0,0.04)] border border-black/[.04]">
      <button
        type="button"
        onClick={() => onChange(prev)}
        aria-label={`Go to ${REGION_LABEL[prev]}`}
        title={REGION_LABEL[prev]}
        className="w-7 h-7 flex items-center justify-center rounded-full text-muted hover:text-ink hover:bg-black/[.04] transition-colors"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path
            d="M7.5 2L3.5 6L7.5 10"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <span className="text-[11px] font-medium text-ink tracking-tight px-2 whitespace-nowrap select-none">
        {REGION_LABEL[region]}
      </span>
      <button
        type="button"
        onClick={() => onChange(next)}
        aria-label={`Go to ${REGION_LABEL[next]}`}
        title={REGION_LABEL[next]}
        className="w-7 h-7 flex items-center justify-center rounded-full text-muted hover:text-ink hover:bg-black/[.04] transition-colors"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path
            d="M4.5 2L8.5 6L4.5 10"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
