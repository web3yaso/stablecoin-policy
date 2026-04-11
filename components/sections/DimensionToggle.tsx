"use client";

import { useMemo, useState } from "react";
import {
  AI_DIMENSIONS,
  DATACENTER_DIMENSIONS,
  DIMENSION_LABEL,
  type Dimension,
  type DimensionLens,
} from "@/types";
import { DIMENSION_COLOR, DIMENSION_TEXT } from "@/lib/dimensions";

interface DimensionToggleProps {
  dimension: Dimension;
  onChange: (d: Dimension) => void;
}

const LENS_LABEL: Record<DimensionLens, string> = {
  datacenter: "Data Centers",
  ai: "AI Regulation",
};

function inferLens(d: Dimension): DimensionLens {
  if (AI_DIMENSIONS.includes(d)) return "ai";
  return "datacenter";
}

export default function DimensionToggle({
  dimension,
  onChange,
}: DimensionToggleProps) {
  // Lens is local — it decides which dimension chips to show. When the user
  // switches lens, if the current dimension is not in the new lens, we
  // reset to "overall" (which is valid under either lens).
  const [lens, setLens] = useState<DimensionLens>(() => inferLens(dimension));

  const lensDimensions = useMemo<Dimension[]>(() => {
    return lens === "datacenter" ? DATACENTER_DIMENSIONS : AI_DIMENSIONS;
  }, [lens]);

  const handleLensChange = (next: DimensionLens) => {
    setLens(next);
    const valid: Dimension[] = next === "datacenter" ? DATACENTER_DIMENSIONS : AI_DIMENSIONS;
    if (dimension !== "overall" && !valid.includes(dimension)) {
      onChange("overall");
    }
  };

  return (
    <div>
      {/* Lens toggle — Data Centers vs AI Regulation */}
      <div className="text-[13px] font-medium text-muted tracking-tight mb-2">
        Lens
      </div>
      <div className="inline-flex items-center gap-1 p-1 rounded-full bg-black/[.04] mb-5">
        {(Object.keys(LENS_LABEL) as DimensionLens[]).map((l) => {
          const active = l === lens;
          return (
            <button
              key={l}
              type="button"
              onClick={() => handleLensChange(l)}
              className={`text-xs font-medium px-4 py-1.5 rounded-full transition-all ${
                active
                  ? "bg-white text-ink shadow-[0_1px_3px_rgba(0,0,0,0.08)]"
                  : "text-muted hover:text-ink"
              }`}
            >
              {LENS_LABEL[l]}
            </button>
          );
        })}
      </div>

      {/* Dimension chips — Overall + current lens */}
      <div className="text-[13px] font-medium text-muted tracking-tight mb-3">
        Color map by
      </div>
      <div className="flex flex-wrap gap-2">
        {(["overall", ...lensDimensions] as Dimension[]).map((d) => {
          const active = d === dimension;
          let activeStyle: React.CSSProperties | undefined;
          if (active) {
            if (d === "overall") {
              activeStyle = {
                backgroundColor: "#1D1D1F",
                borderColor: "#1D1D1F",
                color: "#FFFFFF",
              };
            } else {
              activeStyle = {
                backgroundColor: DIMENSION_COLOR[d],
                borderColor: DIMENSION_COLOR[d],
                color: DIMENSION_TEXT[d],
              };
            }
          }
          return (
            <button
              key={d}
              type="button"
              onClick={() => onChange(d)}
              style={activeStyle}
              className={`inline-flex items-center rounded-full border px-4 py-2 text-xs font-medium transition-colors ${
                active
                  ? "border-transparent"
                  : "border-black/[.06] text-muted hover:text-ink"
              }`}
            >
              {DIMENSION_LABEL[d]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
