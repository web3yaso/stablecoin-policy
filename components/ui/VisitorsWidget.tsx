"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

/**
 * Small "live visitors" pill — pulsing green dot, tabular count, rotating
 * micro-label. Purely cosmetic: the count is a client-side random walk
 * seeded off the current hour, not a real visitor number. Swap the
 * effect below for a real source (edge KV, Plausible API, etc.) when
 * you're ready.
 *
 * Visual chrome matches the rest of the app — translucent white pill
 * with the same shadow recipe used by the top toolbar.
 */

const LABELS = [
  "browsing the map",
  "tracking data-center fights",
  "reading county actions",
  "watching the grid",
  "counting moratoriums",
  "drilling into states",
  "scouting local bills",
];

function seededBase(): number {
  // Deterministic baseline per hour so the number doesn't teleport every
  // render. Between ~30 and ~160, biased up through the UTC afternoon.
  const now = new Date();
  const hour = now.getUTCHours();
  const dayOfMonth = now.getUTCDate();
  const peak = 120;
  const trough = 35;
  const dist = Math.abs(hour - 15); // 15:00 UTC ~= midday US business hours
  const amplitude = ((peak - trough) * (12 - Math.min(12, dist))) / 12;
  const jitter = (dayOfMonth * 7) % 19;
  return Math.round(trough + amplitude + jitter);
}

export default function VisitorsWidget() {
  const [mounted, setMounted] = useState(false);
  const [count, setCount] = useState(0);
  const [labelIdx, setLabelIdx] = useState(0);

  // Pick a stable starting label so SSR → client hydration doesn't
  // flicker. Rotates every ~6s once mounted.
  const startingLabel = useMemo(() => Math.floor(Math.random() * LABELS.length), []);

  useEffect(() => {
    setMounted(true);
    setCount(seededBase());
    setLabelIdx(startingLabel);

    // Random walk — ±1 every 3–6s. Clamped to a sensible band so the
    // number doesn't drift to 0 or runaway during long sessions.
    const drift = window.setInterval(() => {
      setCount((c) => {
        const base = seededBase();
        const delta = Math.random() < 0.5 ? -1 : 1;
        const next = c + delta;
        const floor = Math.max(12, base - 18);
        const ceil = base + 22;
        if (next < floor) return floor;
        if (next > ceil) return ceil;
        return next;
      });
    }, 3500 + Math.random() * 2500);

    const rotate = window.setInterval(() => {
      setLabelIdx((i) => (i + 1) % LABELS.length);
    }, 6000);

    return () => {
      window.clearInterval(drift);
      window.clearInterval(rotate);
    };
  }, [startingLabel]);

  if (!mounted) return null;

  return (
    <div
      className="inline-flex items-center gap-2 rounded-full bg-white/85 backdrop-blur-2xl border border-black/[.04] px-3 py-1.5 text-[11px] tracking-tight"
      style={{
        boxShadow:
          "0 8px 32px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04)",
      }}
      aria-live="polite"
      aria-atomic="true"
      title="Approximate live visitor count"
    >
      <span className="relative flex items-center justify-center w-2 h-2 flex-shrink-0">
        <span className="absolute inset-0 rounded-full bg-stance-favorable/50 animate-ping" />
        <span className="relative w-2 h-2 rounded-full bg-stance-favorable" />
      </span>
      <span className="text-ink font-semibold tabular-nums">
        {count.toLocaleString()}
      </span>
      <span className="text-muted flex items-center">
        {count === 1 ? "person" : "people"}
        {/* Slot-machine flip: old label slides up out of frame, new one
            slides in from below. overflow-hidden clips the transitions so
            it reads as a mechanical roll rather than a crossfade. */}
        <span
          className="relative inline-block overflow-hidden ml-1"
          style={{ height: "1.15em" }}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={labelIdx}
              initial={{ y: "100%", opacity: 0 }}
              animate={{ y: "0%", opacity: 1 }}
              exit={{ y: "-110%", opacity: 0 }}
              transition={{
                type: "spring",
                stiffness: 420,
                damping: 30,
                mass: 0.6,
              }}
              className="inline-block whitespace-nowrap"
            >
              {LABELS[labelIdx]}
            </motion.span>
          </AnimatePresence>
        </span>
      </span>
    </div>
  );
}
