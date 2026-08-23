import type { BusinessProfile } from "./contracts";

const DELTA_ID = /^delta:[0-9a-f]{32}$/;
const MAX_RERUN_DELTAS = 100;

export type SupersedingEvaluationRequest = {
  profile: BusinessProfile;
  deltaIds: string[];
};

export function parseBusinessProfile(input: unknown): BusinessProfile | null {
  if (!isRecord(input)) return null;
  const allowedKeys = input.asset === undefined
    ? ["operatorJurisdiction", "targetJurisdiction", "activities"]
    : ["operatorJurisdiction", "targetJurisdiction", "activities", "asset"];
  if (
    !hasExactKeys(input, allowedKeys)
    || typeof input.operatorJurisdiction !== "string"
    || input.operatorJurisdiction.length === 0
    || input.targetJurisdiction !== "EEA"
    || !Array.isArray(input.activities)
    || input.activities.length === 0
    || !input.activities.every(
      (activity) => typeof activity === "string" && activity.length > 0,
    )
    || new Set(input.activities).size !== input.activities.length
  ) {
    return null;
  }

  let asset: BusinessProfile["asset"] = null;
  if (input.asset !== null && input.asset !== undefined) {
    if (!isRecord(input.asset)) return null;
    if (
      !hasExactKeys(input.asset, ["symbol", "networks"])
      || typeof input.asset.symbol !== "string"
      || input.asset.symbol.length === 0
      || !Array.isArray(input.asset.networks)
      || !input.asset.networks.every(
        (network) => typeof network === "string" && network.length > 0,
      )
      || new Set(input.asset.networks).size !== input.asset.networks.length
    ) {
      return null;
    }
    asset = {
      symbol: input.asset.symbol,
      networks: input.asset.networks as string[],
    };
  }
  return {
    operatorJurisdiction: input.operatorJurisdiction,
    targetJurisdiction: "EEA",
    activities: input.activities as string[],
    asset,
  };
}

export function parseSupersedingEvaluationRequest(
  input: unknown,
): SupersedingEvaluationRequest | null {
  if (!isRecord(input) || !hasExactKeys(input, ["profile", "deltaIds"])) {
    return null;
  }
  const profile = parseBusinessProfile(input.profile);
  if (
    profile === null
    || !Array.isArray(input.deltaIds)
    || input.deltaIds.length === 0
    || input.deltaIds.length > MAX_RERUN_DELTAS
    || !input.deltaIds.every(
      (deltaId) => typeof deltaId === "string" && DELTA_ID.test(deltaId),
    )
    || new Set(input.deltaIds).size !== input.deltaIds.length
  ) {
    return null;
  }
  return { profile, deltaIds: [...input.deltaIds].sort() as string[] };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasExactKeys(
  value: Record<string, unknown>,
  expected: string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expectedSorted = [...expected].sort();
  return actual.length === expectedSorted.length
    && actual.every((key, index) => key === expectedSorted[index]);
}
