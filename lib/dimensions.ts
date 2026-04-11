import type { Dimension, Entity, ImpactTag } from "@/types";
import { STANCE_HEX } from "./map-utils";

/**
 * Which impact tags belong to which dimension. Used both for map recoloring
 * and for filtering the legislation table when a dimension is active.
 */
export const DIMENSION_TAGS: Record<Exclude<Dimension, "overall">, ImpactTag[]> =
  {
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
 * Score 0..1 for an entity under a given dimension — based on how many of its
 * bills' impactTags intersect the dimension's tag set, capped at 5 matches.
 */
function getDimensionScore(
  entity: Entity,
  dimension: Exclude<Dimension, "overall">,
): number {
  const relevantTags = DIMENSION_TAGS[dimension];
  const allTags = entity.legislation.flatMap((l) => l.impactTags ?? []);
  const matches = allTags.filter((t) => relevantTags.includes(t)).length;
  return Math.min(1, matches / 5);
}

/**
 * Returns the fill color for an entity under the given dimension.
 *  - "overall" → uses the entity's stance from STANCE_HEX (diverging palette).
 *  - any other → interpolates the dimension's gradient based on the entity's
 *    tag-density score (continuous, not bucketed).
 */
export function getEntityColorForDimension(
  entity: Entity,
  dimension: Dimension,
): string {
  if (dimension === "overall") return STANCE_HEX[entity.stance];
  const score = getDimensionScore(entity, dimension);
  const grad = DIMENSION_GRADIENT[dimension];
  return lerpHex(grad.from, grad.to, score);
}
