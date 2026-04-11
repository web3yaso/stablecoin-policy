"use client";

import { useState } from "react";
import { ENTITIES } from "@/lib/placeholder-data";
import type { Entity, StanceType } from "@/types";

interface Bucket {
  key: StanceType;
  label: string;
  pillClass: string;
}

const BUCKETS: Bucket[] = [
  { key: "restrictive", label: "Active bans", pillClass: "bg-stance-restrictive" },
  { key: "concerning", label: "Advancing", pillClass: "bg-stance-concerning" },
  { key: "review", label: "Under discussion", pillClass: "bg-stance-review" },
  { key: "none", label: "No action", pillClass: "bg-stance-none" },
  { key: "favorable", label: "Incentives", pillClass: "bg-stance-favorable" },
];

interface TooltipState {
  x: number;
  y: number;
  bucket: Bucket;
  states: Entity[];
}

export default function SummaryBar() {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const states = ENTITIES.filter(
    (e) => e.region === "na" && e.level === "state",
  );

  const grouped: Record<StanceType, Entity[]> = {
    restrictive: [],
    concerning: [],
    review: [],
    favorable: [],
    none: [],
  };
  for (const s of states) grouped[s.stance].push(s);

  const restrictingCount =
    grouped.restrictive.length +
    grouped.concerning.length +
    grouped.review.length;
  const incentivesCount = grouped.favorable.length;
  const totalStates = 50;

  return (
    <div className="relative">
      {/* Stats line */}
      <div className="flex items-end justify-between mb-6">
        <div>
          <div className="text-4xl font-semibold text-ink tracking-tight leading-none">
            {restrictingCount}
            <span className="text-muted text-2xl font-medium ml-1">
              of {totalStates} states
            </span>
          </div>
          <div className="text-sm text-muted mt-2">
            restricting or considering restrictions
          </div>
        </div>
        <div className="text-right">
          <div className="text-4xl font-semibold text-ink tracking-tight leading-none">
            {incentivesCount}
            <span className="text-muted text-2xl font-medium ml-1">states</span>
          </div>
          <div className="text-sm text-muted mt-2">with incentives</div>
        </div>
      </div>

      {/* Segmented bar */}
      <div
        className="flex h-12 rounded-full overflow-hidden gap-1"
        onMouseLeave={() => setTooltip(null)}
      >
        {BUCKETS.map((bucket) => {
          const items = grouped[bucket.key];
          const count = items.length;
          if (count === 0) return null;
          return (
            <div
              key={bucket.key}
              className={`${bucket.pillClass} flex items-center justify-center text-sm font-semibold text-ink/80 cursor-default transition-[flex-grow] duration-300`}
              style={{ flexGrow: count, flexBasis: 0 }}
              onMouseEnter={(e) =>
                setTooltip({
                  x: e.clientX,
                  y: e.clientY,
                  bucket,
                  states: items,
                })
              }
              onMouseMove={(e) =>
                setTooltip((current) =>
                  current
                    ? { ...current, x: e.clientX, y: e.clientY }
                    : current,
                )
              }
            >
              {count}
            </div>
          );
        })}
      </div>

      <p className="text-xs text-muted mt-3">
        Hover over a segment to see which states fall into each category.
      </p>

      {tooltip && (
        <div
          className="fixed z-50 bg-white/90 backdrop-blur-2xl rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.1),0_2px_8px_rgba(0,0,0,0.04)] border border-black/[.04] p-4 max-w-xs pointer-events-none"
          style={{ left: tooltip.x + 14, top: tooltip.y + 14 }}
        >
          <div className="flex items-center gap-2 mb-2">
            <span
              className={`w-2 h-2 rounded-full ${tooltip.bucket.pillClass}`}
            />
            <span className="text-xs font-semibold text-ink tracking-tight">
              {tooltip.bucket.label}
            </span>
            <span className="text-xs text-muted ml-auto">
              {tooltip.states.length}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {tooltip.states.map((s) => (
              <span
                key={s.id}
                className="text-[11px] bg-black/[.04] text-ink px-2 py-0.5 rounded-full"
              >
                {s.name}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
