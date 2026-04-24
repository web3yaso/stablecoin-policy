import type { Dimension, DimensionLens, Entity, ImpactTag, StablecoinTag } from "@/types";
import { STANCE_HEX } from "./map-utils";
import { STABLECOIN_DIMENSION_TAGS, getIssuanceColor } from "./stablecoin-tags";

/**
 * Which impact tags belong to which dimension. Used both for map recoloring
 * and for filtering the legislation table when a dimension is active.
 */
/** Impact-tag sets for DC and AI dimensions only.
 *  Stablecoin dimensions use STABLECOIN_DIMENSION_TAGS in stablecoin-tags.ts. */
export const DIMENSION_TAGS: Record<
  Exclude<Dimension, "overall" | `sc-${string}`>,
  ImpactTag[]
> = {
    // ─── Data Center lens ────────────────────────────────────────────
    environmental: [
      "water-consumption",
      "carbon-emissions",
      "protected-land",
      "environmental-review",
      "renewable-energy",
    ],
    energy: ["grid-capacity", "energy-rates", "water-infrastructure"],
    community: [
      "noise-vibration",
      "local-zoning",
      "local-control",
      "residential-proximity",
      "property-values",
    ],
    "land-use": [
      "protected-land",
      "local-zoning",
      "residential-proximity",
      "property-values",
    ],
    // ─── AI Regulation lens ──────────────────────────────────────────
    "ai-governance-dim": ["algorithmic-transparency", "ai-safety"],
    "ai-consumer": ["data-privacy", "child-safety"],
    "ai-workforce": ["ai-in-employment"],
    "ai-public": ["ai-in-healthcare", "ai-in-education"],
    "ai-synthetic": ["deepfake-regulation"],
  };

/**
 * One representative color per dimension — used for the active state of the
 * DimensionToggle pill and the dot in the NuanceLegend.
 */
export const DIMENSION_COLOR: Record<
  Exclude<Dimension, "overall">,
  string
> = {
  // Data Center lens
  environmental: "#4F8B58",
  energy: "#E8C57E",
  community: "#7090C8",
  "land-use": "#C8534A",
  // AI Regulation lens
  "ai-governance-dim": "#9B6BC5",
  "ai-consumer": "#D67AA4",
  "ai-workforce": "#C89554",
  "ai-public": "#5AA5A5",
  "ai-synthetic": "#D65AA8",
  // Stablecoin lens
  "sc-issuance": "#34C759",
  "sc-reserve": "#007AFF",
  "sc-consumer": "#5856D6",
  "sc-cross-border": "#FF9500",
  "sc-sovereignty": "#FF3B30",
};

/**
 * Foreground text color to pair with each DIMENSION_COLOR background. Picked
 * by hand to keep readable contrast on each pastel.
 */
export const DIMENSION_TEXT: Record<
  Exclude<Dimension, "overall">,
  string
> = {
  environmental: "#FFFFFF",
  energy: "#1D1D1F",
  community: "#FFFFFF",
  "land-use": "#FFFFFF",
  "ai-governance-dim": "#FFFFFF",
  "ai-consumer": "#FFFFFF",
  "ai-workforce": "#1D1D1F",
  "ai-public": "#FFFFFF",
  "ai-synthetic": "#FFFFFF",
  "sc-issuance": "#FFFFFF",
  "sc-reserve": "#FFFFFF",
  "sc-consumer": "#FFFFFF",
  "sc-cross-border": "#FFFFFF",
  "sc-sovereignty": "#FFFFFF",
};

/**
 * Per-dimension gradient — `from` is the score=0 (lowest intensity) end, `to`
 * is the score=1 (highest intensity) end. The map interpolates between them
 * based on each entity's tag-density score for the active dimension.
 */
export const DIMENSION_GRADIENT: Record<
  Exclude<Dimension, "overall">,
  { from: string; to: string }
> = {
  // Data Center lens — same gradients as before
  environmental: { from: "#3D7849", to: "#7A4F2A" },
  energy: { from: "#F5DC8A", to: "#D9893E" },
  community: { from: "#5A8FD9", to: "#7B5EA5" },
  "land-use": { from: "#C84A3F", to: "#F4C9A0" },
  // AI Regulation lens
  "ai-governance-dim": { from: "#C4A8E0", to: "#5A3F7A" },
  "ai-consumer": { from: "#E8B7CE", to: "#A04866" },
  "ai-workforce": { from: "#F0D5A0", to: "#8A5A2A" },
  "ai-public": { from: "#A8D0D0", to: "#2E6565" },
  "ai-synthetic": { from: "#E8A5CE", to: "#8B3A6E" },
  // Stablecoin lens — not used for sc-issuance (categorical); used for others
  "sc-issuance": { from: "#B8F0C8", to: "#1A7A34" },
  "sc-reserve": { from: "#A8D0F8", to: "#004899" },
  "sc-consumer": { from: "#C4C3F0", to: "#2A287A" },
  "sc-cross-border": { from: "#FFE0A8", to: "#994400" },
  "sc-sovereignty": { from: "#FFC0BC", to: "#991A14" },
};

/**
 * Linear hex interpolation. `t` ∈ [0,1].
 */
function lerpHex(a: string, b: string, t: number): string {
  const ar = parseInt(a.slice(1, 3), 16);
  const ag = parseInt(a.slice(3, 5), 16);
  const ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16);
  const bg = parseInt(b.slice(3, 5), 16);
  const bb = parseInt(b.slice(5, 7), 16);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const blue = Math.round(ab + (bb - ab) * t);
  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(blue)}`;
}

/**
 * Score 0..1 for an entity under a given dimension.
 * - For DC/AI dimensions: intersection of legislation impactTags with dimension tag set.
 * - For stablecoin dimensions: intersection of stablecoinMeta.tags with dimension tag set.
 */
function getDimensionScore(
  entity: Entity,
  dimension: Exclude<Dimension, "overall">,
): number {
  if (dimension.startsWith("sc-")) {
    const relevantTags = STABLECOIN_DIMENSION_TAGS[
      dimension as Extract<Dimension, `sc-${string}`>
    ];
    const entityTags = (entity.stablecoinMeta?.tags ?? []) as StablecoinTag[];
    const matches = entityTags.filter((t) => (relevantTags as readonly string[]).includes(t)).length;
    return Math.min(1, matches / relevantTags.length);
  }
  const relevantTags = DIMENSION_TAGS[
    dimension as Exclude<Dimension, "overall" | `sc-${string}`>
  ];
  const allTags = entity.legislation.flatMap((l) => l.impactTags ?? []);
  const matches = allTags.filter((t) => (relevantTags as ImpactTag[]).includes(t)).length;
  return Math.min(1, matches / 5);
}

/**
 * Returns the fill color for an entity under the given dimension.
 *  - "overall" → stance color from STANCE_HEX.
 *  - "sc-issuance" → categorical: green (non-bank-permitted), amber (bank-only),
 *    red (private-stablecoin-banned), gray (unknown).
 *  - other sc-* → gradient based on stablecoin tag density.
 *  - DC/AI dimensions → gradient based on impactTag density.
 */
export function getEntityColorForDimension(
  entity: Entity,
  dimension: Dimension,
  lens: DimensionLens = "datacenter",
): string {
  if (dimension === "overall") {
    const stance =
      lens === "ai"
        ? entity.stanceAI
        : lens === "stablecoin"
          ? (entity.stance ?? entity.stanceDatacenter)
          : entity.stanceDatacenter;
    return STANCE_HEX[stance];
  }
  if (dimension === "sc-issuance") {
    return getIssuanceColor((entity.stablecoinMeta?.tags ?? []) as StablecoinTag[]);
  }
  const score = getDimensionScore(entity, dimension);
  const grad = DIMENSION_GRADIENT[dimension];
  return lerpHex(grad.from, grad.to, score);
}
