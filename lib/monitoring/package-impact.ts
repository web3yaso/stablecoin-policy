import { DataIntegrityError } from "../data/external-storage-errors";
import { SupabaseHttpClient } from "../data/supabase-client";

const EVENT_ID = /^[a-z0-9][a-z0-9._:-]{2,160}$/;
const PACKAGE_ID = /^package:[a-z0-9-]+:[0-9a-f]{16}$/;
const PLAYBOOK_ID = /^[a-z0-9][a-z0-9-]{2,80}$/;

export type PackageClaimImpact = {
  claimId: string;
  impactType: "MAY_AFFECT" | "INVALIDATES" | "SUPERSEDES" | "DEADLINE";
};

export type AffectedPlaybookPackage = {
  packageId: string;
  playbookId: string;
  evaluatedAt: string;
  assuranceReviewStatus: "PROVISIONAL" | "HUMAN_REVIEWED";
  claimImpacts: PackageClaimImpact[];
};

export type PackageImpactResponse = {
  schemaVersion: "1.0.0";
  eventId: string;
  eventState: "PUBLISHED";
  packages: AffectedPlaybookPackage[];
};

export class PackageImpactIndex {
  constructor(private readonly client: SupabaseHttpClient) {}

  async findByPublishedEvent(eventId: string): Promise<PackageImpactResponse> {
    if (!EVENT_ID.test(eventId)) {
      throw new Error("invalid regulatory event ID");
    }
    const raw = await this.client.rpc<unknown>(
      "get_affected_playbook_packages",
      { p_event_id: eventId },
    );
    const response = parsePackageImpactResponse(raw);
    if (response.eventId !== eventId) {
      throw new DataIntegrityError("package impact event identity mismatch");
    }
    return response;
  }
}

export function parsePackageImpactResponse(value: unknown): PackageImpactResponse {
  if (!isExactRecord(value, ["schemaVersion", "eventId", "eventState", "packages"])) {
    throw new DataIntegrityError("invalid package impact response shape");
  }
  if (
    value.schemaVersion !== "1.0.0"
    || typeof value.eventId !== "string"
    || !EVENT_ID.test(value.eventId)
    || value.eventState !== "PUBLISHED"
    || !Array.isArray(value.packages)
  ) {
    throw new DataIntegrityError("invalid package impact response metadata");
  }

  const packages = value.packages.map(parseAffectedPackage);
  if (new Set(packages.map((item) => item.packageId)).size !== packages.length) {
    throw new DataIntegrityError("duplicate affected playbook package");
  }
  const sorted = [...packages].sort((left, right) =>
    left.packageId.localeCompare(right.packageId));
  if (sorted.some((item, index) => item.packageId !== packages[index]?.packageId)) {
    throw new DataIntegrityError("affected playbook packages are not canonical");
  }

  return {
    schemaVersion: "1.0.0",
    eventId: value.eventId,
    eventState: "PUBLISHED",
    packages,
  };
}

function parseAffectedPackage(value: unknown): AffectedPlaybookPackage {
  if (!isExactRecord(value, [
    "packageId",
    "playbookId",
    "evaluatedAt",
    "assuranceReviewStatus",
    "claimImpacts",
  ])) {
    throw new DataIntegrityError("invalid affected playbook package shape");
  }
  if (
    typeof value.packageId !== "string"
    || !PACKAGE_ID.test(value.packageId)
    || typeof value.playbookId !== "string"
    || !PLAYBOOK_ID.test(value.playbookId)
    || typeof value.evaluatedAt !== "string"
    || !Number.isFinite(Date.parse(value.evaluatedAt))
    || (value.assuranceReviewStatus !== "PROVISIONAL"
      && value.assuranceReviewStatus !== "HUMAN_REVIEWED")
    || !Array.isArray(value.claimImpacts)
    || value.claimImpacts.length === 0
  ) {
    throw new DataIntegrityError("invalid affected playbook package metadata");
  }

  const claimImpacts = value.claimImpacts.map(parseClaimImpact);
  if (new Set(claimImpacts.map((item) => item.claimId)).size !== claimImpacts.length) {
    throw new DataIntegrityError("duplicate package claim impact");
  }
  const sorted = [...claimImpacts].sort((left, right) =>
    left.claimId.localeCompare(right.claimId));
  if (sorted.some((item, index) => item.claimId !== claimImpacts[index]?.claimId)) {
    throw new DataIntegrityError("package claim impacts are not canonical");
  }

  return {
    packageId: value.packageId,
    playbookId: value.playbookId,
    evaluatedAt: new Date(value.evaluatedAt).toISOString(),
    assuranceReviewStatus: value.assuranceReviewStatus,
    claimImpacts,
  };
}

function parseClaimImpact(value: unknown): PackageClaimImpact {
  if (!isExactRecord(value, ["claimId", "impactType"])) {
    throw new DataIntegrityError("invalid package claim impact shape");
  }
  if (
    typeof value.claimId !== "string"
    || value.claimId.length === 0
    || !isImpactType(value.impactType)
  ) {
    throw new DataIntegrityError("invalid package claim impact metadata");
  }
  return { claimId: value.claimId, impactType: value.impactType };
}

function isImpactType(value: unknown): value is PackageClaimImpact["impactType"] {
  return value === "MAY_AFFECT"
    || value === "INVALIDATES"
    || value === "SUPERSEDES"
    || value === "DEADLINE";
}

function isExactRecord(
  value: unknown,
  expectedKeys: string[],
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}
