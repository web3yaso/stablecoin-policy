"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import {
  AI_DIMENSIONS,
  DATACENTER_DIMENSIONS,
  STABLECOIN_DIMENSIONS,
  DIMENSION_LABEL,
  type Dimension,
  type DimensionLens,
} from "@/types";
import { DIMENSION_COLOR, DIMENSION_TEXT } from "@/lib/dimensions";

interface DimensionToggleProps {
  dimension: Dimension;
  onChange: (d: Dimension) => void;
  lens: DimensionLens;
  onLensChange: (l: DimensionLens) => void;
}

const LENS_LABEL: Record<DimensionLens, string> = {
  datacenter: "Data Centers",
  ai: "AI Regulation",
  stablecoin: "Stablecoins",
};

const LENS_BLURB: Record<DimensionLens, string> = {
  datacenter:
    "Where data center builds face opposition, setbacks, or energy constraints — and where governments roll out the welcome mat.",
  ai: "How governments are scoping, restricting, or encouraging AI development across governance, consumer protection, and public services.",
  stablecoin:
    "Who can issue stablecoins, how reserves must be held, what rights holders have, and how governments protect monetary sovereignty.",
};

// One-liner shown under the active dimension chip explaining what the map
// coloring measures.
const DIMENSION_BLURB: Record<Dimension, string> = {
  overall:
    "Each jurisdiction's net stance across all bills we're tracking — darker red is more restrictive, green is more permissive.",
  // Data center lens
  environmental:
    "Weighted by bills touching water use, carbon emissions, environmental review, and protected land.",
  energy:
    "Weighted by bills addressing grid capacity, energy rates, and interconnection queuing for hyperscale facilities.",
  community:
    "Weighted by bills on noise, residential setbacks, local zoning, and community impact.",
  "land-use":
    "Weighted by bills on siting restrictions, protected land, and local government authority over data center approvals.",
  // AI regulation lens
  "ai-governance-dim":
    "Weighted by bills on algorithmic transparency, AI safety, and general-purpose AI oversight.",
  "ai-consumer":
    "Weighted by bills on consumer data privacy, automated decision-making, and deepfake regulation.",
  "ai-workforce":
    "Weighted by bills on AI in hiring, employment decisions, workforce displacement, and gig work.",
  "ai-public":
    "Weighted by bills on AI in healthcare, education, criminal justice, and other public services.",
  "ai-synthetic":
    "Weighted by bills on synthetic media, deepfakes, election integrity, and child safety.",
  // Stablecoin lens
  "sc-issuance":
    "Green = non-bank issuers permitted. Amber = bank-only. Red = private stablecoins banned. EU and US states shown as blocs.",
  "sc-reserve":
    "Weighted by reserve-related tags: 1:1 fiat backing, asset-backed, monthly attestation, algorithmic ban, rehypothecation rules.",
  "sc-consumer":
    "Weighted by consumer-protection tags: redemption rights, yield prohibition, insolvency priority, disclosure, AML/KYC.",
  "sc-cross-border":
    "Weighted by cross-border tags: equivalence principle, passporting, travel rule, foreign issuer requirements.",
  "sc-sovereignty":
    "Weighted by monetary-sovereignty tags: CBDC coexistence, USD stablecoin restrictions, capital flow controls, private stablecoin bans.",
};

export default function DimensionToggle({
  dimension,
  onChange,
  lens,
  onLensChange,
}: DimensionToggleProps) {
  // Lens is now controlled by the page — the same state drives which
  // dimension chips are shown here AND whether data-center dots render
  // on the map. When the user switches lens, if the current dimension
  // isn't valid for the new lens, we reset to "overall".
  const lensDimensions = useMemo<Dimension[]>(() => {
    if (lens === "stablecoin") return STABLECOIN_DIMENSIONS;
    return lens === "datacenter" ? DATACENTER_DIMENSIONS : AI_DIMENSIONS;
  }, [lens]);

  const handleLensChange = (next: DimensionLens) => {
    onLensChange(next);
    const valid: Dimension[] =
      next === "datacenter"
        ? DATACENTER_DIMENSIONS
        : next === "stablecoin"
          ? STABLECOIN_DIMENSIONS
          : AI_DIMENSIONS;
    if (dimension !== "overall" && !valid.includes(dimension)) {
      onChange(next === "stablecoin" ? "sc-issuance" : "overall");
    }
  };

  return (
    <div>
      {/* Lens toggle — Data Centers vs AI Regulation */}
      <div className="text-[13px] font-medium text-muted tracking-tight mb-2">
        Focus
      </div>
      {/* iOS-style segmented control — the white pill SLIDES between
          options instead of cross-fading. `layoutId` shares the same
          motion node across both buttons so framer interpolates its
          position with a spring. The non-active button's text color
          eases to ink on hover and on the way in. */}
      <div
        className="relative inline-flex items-center gap-1 p-1 rounded-full bg-black/[.04] mb-2"
        role="tablist"
      >
        {(Object.keys(LENS_LABEL) as DimensionLens[]).map((l) => {
          const active = l === lens;
          return (
            <button
              key={l}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => handleLensChange(l)}
              className={`relative text-xs font-medium px-3.5 py-1.5 rounded-full transition-colors duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.97] ${
                active ? "text-ink" : "text-muted hover:text-ink"
              }`}
              style={{ transitionProperty: "color, transform" }}
            >
              {active && (
                <motion.span
                  layoutId="lens-indicator"
                  className="absolute inset-0 rounded-full bg-white"
                  style={{
                    boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
                  }}
                  transition={{
                    type: "spring",
                    stiffness: 480,
                    damping: 26,
                    mass: 0.7,
                  }}
                />
              )}
              <span className="relative z-10">{LENS_LABEL[l]}</span>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted leading-relaxed max-w-prose mb-6">
        {LENS_BLURB[lens]}
      </p>

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
              className={`inline-flex items-center rounded-full border px-4 py-2 text-xs font-medium transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.97] ${
                active
                  ? "border-transparent"
                  : "border-black/[.06] text-muted hover:text-ink hover:bg-black/[.02]"
              }`}
            >
              {DIMENSION_LABEL[d]}
            </button>
          );
        })}
      </div>

      {/* Explainer for the active dimension — reserve enough vertical space
          so the layout doesn't jump when the blurb length changes. */}
      <div className="mt-4 min-h-[2.75rem]">
        <p
          key={dimension}
          className="text-xs text-muted leading-relaxed max-w-prose"
        >
          <span className="font-medium text-ink tracking-tight">
            {DIMENSION_LABEL[dimension]}.
          </span>{" "}
          {DIMENSION_BLURB[dimension]}
        </p>
      </div>
    </div>
  );
}
