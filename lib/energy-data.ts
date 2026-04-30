import type { PowerPlant, StateEnergyProfile } from "@/types";

export const ALL_PLANTS: PowerPlant[] = [];

const PLANTS_BY_STATE = new Map<string, PowerPlant[]>();

const PROFILES_BY_STATE: Record<string, StateEnergyProfile> = {};

export function plantsInState(stateName: string): PowerPlant[] {
  return PLANTS_BY_STATE.get(stateName) ?? [];
}

export function getStateProfile(stateName: string): StateEnergyProfile | null {
  return PROFILES_BY_STATE[stateName] ?? null;
}

/** Great-circle distance in miles between two lat/lng points. */
function haversineMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 3959;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Plants within `radiusMiles` of a point. */
export function plantsNearby(
  lat: number,
  lng: number,
  radiusMiles: number,
): PowerPlant[] {
  return ALL_PLANTS.filter(
    (p) => haversineMiles(lat, lng, p.lat, p.lng) <= radiusMiles,
  );
}
