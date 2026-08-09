import type { Dimension, Entity, StablecoinTag } from "@/types";
import { NEUTRAL_FILL, STANCE_HEX } from "./map-utils";
import { STABLECOIN_DIMENSION_TAGS, getIssuanceColor } from "./stablecoin-tags";

export const DIMENSION_COLOR: Record<Exclude<Dimension, "overall">, string> = {
  "sc-issuance": "#34C759",
  "sc-reserve": "#007AFF",
  "sc-consumer": "#5856D6",
  "sc-cross-border": "#FF9500",
  "sc-sovereignty": "#FF3B30",
};

export const DIMENSION_TEXT: Record<Exclude<Dimension, "overall">, string> = {
  "sc-issuance": "#FFFFFF",
  "sc-reserve": "#FFFFFF",
  "sc-consumer": "#FFFFFF",
  "sc-cross-border": "#FFFFFF",
  "sc-sovereignty": "#FFFFFF",
};

export const DIMENSION_GRADIENT: Record<
  Exclude<Dimension, "overall">,
  { from: string; to: string }
> = {
  "sc-issuance": { from: "#B8F0C8", to: "#1A7A34" },
  "sc-reserve": { from: "#A8D0F8", to: "#004899" },
  "sc-consumer": { from: "#C4C3F0", to: "#2A287A" },
  "sc-cross-border": { from: "#FFE0A8", to: "#994400" },
  "sc-sovereignty": { from: "#FFC0BC", to: "#991A14" },
};

function lerpHex(a: string, b: string, t: number): string {
  const channels = [1, 3, 5].map((offset) => {
    const start = Number.parseInt(a.slice(offset, offset + 2), 16);
    const end = Number.parseInt(b.slice(offset, offset + 2), 16);
    return Math.round(start + (end - start) * t)
      .toString(16)
      .padStart(2, "0");
  });
  return `#${channels.join("")}`;
}

function getDimensionScore(
  entity: Entity,
  dimension: Exclude<Dimension, "overall">,
): number {
  const relevantTags = STABLECOIN_DIMENSION_TAGS[dimension];
  const entityTags = entity.stablecoinMeta?.tags ?? [];
  const matches = entityTags.filter((tag) =>
    (relevantTags as readonly StablecoinTag[]).includes(tag),
  ).length;
  return Math.min(1, matches / relevantTags.length);
}

export function getEntityColorForDimension(
  entity: Entity,
  dimension: Dimension,
): string {
  if (dimension === "overall") {
    return STANCE_HEX[entity.stance ?? "none"] ?? NEUTRAL_FILL;
  }
  if (dimension === "sc-issuance") {
    if (!entity.stablecoinMeta) {
      return STANCE_HEX[entity.stance ?? "none"] ?? NEUTRAL_FILL;
    }
    return getIssuanceColor(
      entity.stablecoinMeta.tags ?? [],
      entity.stablecoinMeta.legalStatus,
    );
  }
  const gradient = DIMENSION_GRADIENT[dimension];
  return lerpHex(
    gradient.from,
    gradient.to,
    getDimensionScore(entity, dimension),
  );
}
