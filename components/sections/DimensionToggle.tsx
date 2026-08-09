"use client";

import {
  DIMENSION_LABEL,
  STABLECOIN_DIMENSIONS,
  type Dimension,
} from "@/types";
import { DIMENSION_COLOR } from "@/lib/dimensions";

interface DimensionToggleProps {
  dimension: Dimension;
  onChange: (dimension: Dimension) => void;
}

const DIMENSION_BLURB: Record<Dimension, string> = {
  overall: "Overall jurisdiction status from the tracked Stablecoin framework.",
  "sc-issuance": "Who may issue and whether authorization is required.",
  "sc-reserve": "Reserve composition, custody, attestations, and backing rules.",
  "sc-consumer": "Redemption, disclosure, insolvency, and holder protections.",
  "sc-cross-border": "Foreign issuer, equivalence, passporting, and local-presence rules.",
  "sc-sovereignty": "Restrictions tied to currency, capital controls, and private tokens.",
};

export default function DimensionToggle({
  dimension,
  onChange,
}: DimensionToggleProps) {
  const dimensions: Dimension[] = ["overall", ...STABLECOIN_DIMENSIONS];
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {dimensions.map((item) => {
          const active = item === dimension;
          return (
            <button
              key={item}
              type="button"
              onClick={() => onChange(item)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? "border-transparent text-white"
                  : "border-black/[.08] text-muted hover:text-ink"
              }`}
              style={
                active
                  ? {
                      backgroundColor:
                        item === "overall" ? "#1D1D1F" : DIMENSION_COLOR[item],
                    }
                  : undefined
              }
            >
              {DIMENSION_LABEL[item]}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-muted">
        {DIMENSION_BLURB[dimension]}
      </p>
    </div>
  );
}
