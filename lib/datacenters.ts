import type { DataCenter } from "@/types";

export const ALL_FACILITIES: DataCenter[] = [];
export const US_FACILITIES: DataCenter[] = [];
export const EU_FACILITIES: DataCenter[] = [];
export const ASIA_FACILITIES: DataCenter[] = [];
export const EPOCH_ATTRIBUTION = "";

export function facilitiesForEntity(entity: {
  level: string;
  region: string;
  name: string;
}): { facilities: DataCenter[]; groupBy: "state" | "country" | null } {
  return { facilities: [], groupBy: null };
}
