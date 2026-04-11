import type { Dimension, Entity, ImpactTag } from "@/types";
import { STANCE_HEX } from "./map-utils";

/**
 * Which impact tags belong to which dimension. Used both for map recoloring
 * and for filtering the legislation table when a dimension is active.
 */
export const DIMENSION_TAGS: Record<Exclude<Dimension, "overall">, ImpactTag[]> =
  {
    environmental: [
      "national-park",
      "water",
      "emissions",
      "environmental-study",
    ],
    energy: ["grid-strain", "rate-hikes", "renewable-mandate"],
    community: ["noise", "local-control"],
    "land-use": ["agricultural-land", "national-park", "zoning"],
  };

/**
 * Pastel CSS variable per dimension. Used for UI accents (DimensionToggle
 * pill dots, NuanceLegend group dots). The map itself uses earth tones.
 */
export const DIMENSION_PASTEL_VAR: Record<
  Exclude<Dimension, "overall">,
  string
> = {
  environmental: "var(--color-stance-favorable)",
  energy: "var(--color-stance-review)",
  community: "var(--color-stance-restrictive)",
  "land-use": "var(--color-stance-concerning)",
};

/**
 * Returns an earth-tone hex (from STANCE_HEX) for a given entity under a
 * given dimension. For "overall", uses the entity's own stance. For specific
 * dimensions, buckets the entity by how many of its bills' impactTags
 * intersect the dimension's tag set.
 */
export function getEntityColorForDimension(
  entity: Entity,
  dimension: Dimension,
): string {
  if (dimension === "overall") return STANCE_HEX[entity.stance];

  const relevantTags = DIMENSION_TAGS[dimension];
  const allTags = entity.legislation.flatMap((l) => l.impactTags ?? []);
  const matchCount = allTags.filter((t) => relevantTags.includes(t)).length;

  if (matchCount === 0) return STANCE_HEX.none;
  if (matchCount <= 1) return STANCE_HEX.review;
  if (matchCount <= 3) return STANCE_HEX.restrictive;
  return STANCE_HEX.concerning;
}
