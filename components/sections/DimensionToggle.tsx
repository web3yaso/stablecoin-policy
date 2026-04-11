"use client";

import { DIMENSION_LABEL, type Dimension } from "@/types";
import { DIMENSION_PASTEL_VAR } from "@/lib/dimensions";

interface DimensionToggleProps {
  dimension: Dimension;
  onChange: (d: Dimension) => void;
}

const DIMENSIONS: Dimension[] = [
  "overall",
  "environmental",
  "energy",
  "community",
  "land-use",
];

export default function DimensionToggle({
  dimension,
  onChange,
}: DimensionToggleProps) {
  return (
    <div>
      <div className="text-[13px] font-medium text-muted tracking-tight mb-3">
        Color map by
      </div>
      <div className="flex flex-wrap gap-2">
        {DIMENSIONS.map((d) => {
          const active = d === dimension;
          const pastel =
            d === "overall" ? null : DIMENSION_PASTEL_VAR[d];
          return (
            <button
              key={d}
              type="button"
              onClick={() => onChange(d)}
              className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-medium transition-colors ${
                active
                  ? "bg-ink text-white"
                  : "border border-black/[.06] text-muted hover:text-ink"
              }`}
            >
              {active && pastel && (
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ backgroundColor: pastel }}
                />
              )}
              {DIMENSION_LABEL[d]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
