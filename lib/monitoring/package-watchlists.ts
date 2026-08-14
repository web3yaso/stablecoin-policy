import { DataIntegrityError } from "../data/external-storage-errors";
import { SupabaseHttpClient } from "../data/supabase-client";
import type { PackageClaimImpact } from "./package-impact";

const EVENT_ID = /^[a-z0-9][a-z0-9._:-]{2,160}$/;
const PACKAGE_ID = /^package:[a-z0-9-]+:[0-9a-f]{16}$/;
const PLAYBOOK_ID = /^[a-z0-9][a-z0-9-]{2,80}$/;
const WATCHLIST_ID = /^watchlist:[0-9a-f]{32}$/;

export type PlaybookPackageWatchlist = {
  schemaVersion: "1.0.0";
  watchlistId: string;
  packageId: string;
  state: "ACTIVE";
  createdAt: string;
};

export type WatchlistCreateResult =
  | { status: "CREATED" | "REPLAYED"; watchlist: PlaybookPackageWatchlist }
  | { status: "NOT_FOUND" }
  | { status: "NOT_WATCHLISTABLE"; reason: "EMPTY_DEPENDENCIES" };

export type AffectedPlaybookWatchlist = {
  watchlistId: string;
  createdAt: string;
  packageId: string;
  playbookId: string;
  evaluatedAt: string;
  assuranceReviewStatus: "PROVISIONAL" | "HUMAN_REVIEWED";
  claimImpacts: PackageClaimImpact[];
};

export type WatchlistImpactResponse = {
  schemaVersion: "1.0.0";
  eventId: string;
  eventState: "PUBLISHED";
  watchlists: AffectedPlaybookWatchlist[];
};

export class PlaybookPackageWatchlistStore {
  constructor(private readonly client: SupabaseHttpClient) {}

  async create(packageId: string): Promise<WatchlistCreateResult> {
    if (!PACKAGE_ID.test(packageId)) throw new Error("invalid playbook package ID");
    const raw = await this.client.rpc<unknown>(
      "create_playbook_package_watchlist",
      { p_package_id: packageId },
    );
    return parseWatchlistCreateResult(raw, packageId);
  }

  async findByPublishedEvent(eventId: string): Promise<WatchlistImpactResponse> {
    if (!EVENT_ID.test(eventId)) throw new Error("invalid regulatory event ID");
    const raw = await this.client.rpc<unknown>(
      "get_affected_playbook_watchlists",
      { p_event_id: eventId },
    );
    const response = parseWatchlistImpactResponse(raw);
    if (response.eventId !== eventId) {
      throw new DataIntegrityError("watchlist impact event identity mismatch");
    }
    return response;
  }
}

export function parseWatchlistCreateResult(
  value: unknown,
  requestedPackageId: string,
): WatchlistCreateResult {
  if (!isRecord(value) || typeof value.status !== "string") {
    throw new DataIntegrityError("invalid watchlist creation response");
  }
  if (value.status === "NOT_FOUND" && hasExactKeys(value, ["status"])) {
    return { status: "NOT_FOUND" };
  }
  if (
    value.status === "NOT_WATCHLISTABLE"
    && value.reason === "EMPTY_DEPENDENCIES"
    && hasExactKeys(value, ["status", "reason"])
  ) {
    return { status: "NOT_WATCHLISTABLE", reason: "EMPTY_DEPENDENCIES" };
  }
  if (
    (value.status === "CREATED" || value.status === "REPLAYED")
    && hasExactKeys(value, ["status", "watchlist"])
  ) {
    const watchlist = parseWatchlist(value.watchlist);
    if (watchlist.packageId !== requestedPackageId) {
      throw new DataIntegrityError("watchlist package identity mismatch");
    }
    return { status: value.status, watchlist };
  }
  throw new DataIntegrityError("unknown watchlist creation response");
}

export function parseWatchlistImpactResponse(
  value: unknown,
): WatchlistImpactResponse {
  if (!isExactRecord(value, ["schemaVersion", "eventId", "eventState", "watchlists"])) {
    throw new DataIntegrityError("invalid watchlist impact response shape");
  }
  if (
    value.schemaVersion !== "1.0.0"
    || typeof value.eventId !== "string"
    || !EVENT_ID.test(value.eventId)
    || value.eventState !== "PUBLISHED"
    || !Array.isArray(value.watchlists)
  ) {
    throw new DataIntegrityError("invalid watchlist impact response metadata");
  }
  const watchlists = value.watchlists.map(parseAffectedWatchlist);
  if (new Set(watchlists.map((item) => item.watchlistId)).size !== watchlists.length) {
    throw new DataIntegrityError("duplicate affected playbook watchlist");
  }
  assertCanonicalOrder(watchlists.map((item) => item.watchlistId),
    "affected playbook watchlists are not canonical");
  return {
    schemaVersion: "1.0.0",
    eventId: value.eventId,
    eventState: "PUBLISHED",
    watchlists,
  };
}

function parseWatchlist(value: unknown): PlaybookPackageWatchlist {
  if (!isExactRecord(value, [
    "schemaVersion", "watchlistId", "packageId", "state", "createdAt",
  ])) {
    throw new DataIntegrityError("invalid playbook watchlist shape");
  }
  if (
    value.schemaVersion !== "1.0.0"
    || typeof value.watchlistId !== "string"
    || !WATCHLIST_ID.test(value.watchlistId)
    || typeof value.packageId !== "string"
    || !PACKAGE_ID.test(value.packageId)
    || value.state !== "ACTIVE"
    || typeof value.createdAt !== "string"
    || !Number.isFinite(Date.parse(value.createdAt))
  ) {
    throw new DataIntegrityError("invalid playbook watchlist metadata");
  }
  return {
    schemaVersion: "1.0.0",
    watchlistId: value.watchlistId,
    packageId: value.packageId,
    state: "ACTIVE",
    createdAt: new Date(value.createdAt).toISOString(),
  };
}

function parseAffectedWatchlist(value: unknown): AffectedPlaybookWatchlist {
  if (!isExactRecord(value, [
    "watchlistId", "createdAt", "packageId", "playbookId", "evaluatedAt",
    "assuranceReviewStatus", "claimImpacts",
  ])) {
    throw new DataIntegrityError("invalid affected playbook watchlist shape");
  }
  if (
    typeof value.watchlistId !== "string"
    || !WATCHLIST_ID.test(value.watchlistId)
    || typeof value.createdAt !== "string"
    || !Number.isFinite(Date.parse(value.createdAt))
    || typeof value.packageId !== "string"
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
    throw new DataIntegrityError("invalid affected playbook watchlist metadata");
  }
  const claimImpacts = value.claimImpacts.map(parseClaimImpact);
  if (new Set(claimImpacts.map((item) => item.claimId)).size !== claimImpacts.length) {
    throw new DataIntegrityError("duplicate watchlist claim impact");
  }
  assertCanonicalOrder(claimImpacts.map((item) => item.claimId),
    "watchlist claim impacts are not canonical");
  return {
    watchlistId: value.watchlistId,
    createdAt: new Date(value.createdAt).toISOString(),
    packageId: value.packageId,
    playbookId: value.playbookId,
    evaluatedAt: new Date(value.evaluatedAt).toISOString(),
    assuranceReviewStatus: value.assuranceReviewStatus,
    claimImpacts,
  };
}

function parseClaimImpact(value: unknown): PackageClaimImpact {
  if (!isExactRecord(value, ["claimId", "impactType"])) {
    throw new DataIntegrityError("invalid watchlist claim impact shape");
  }
  if (
    typeof value.claimId !== "string"
    || value.claimId.length === 0
    || !isImpactType(value.impactType)
  ) {
    throw new DataIntegrityError("invalid watchlist claim impact metadata");
  }
  return { claimId: value.claimId, impactType: value.impactType };
}

function isImpactType(value: unknown): value is PackageClaimImpact["impactType"] {
  return value === "MAY_AFFECT"
    || value === "INVALIDATES"
    || value === "SUPERSEDES"
    || value === "DEADLINE";
}

function assertCanonicalOrder(values: string[], message: string): void {
  const sorted = [...values].sort((left, right) => left.localeCompare(right));
  if (sorted.some((item, index) => item !== values[index])) {
    throw new DataIntegrityError(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExactRecord(
  value: unknown,
  expectedKeys: string[],
): value is Record<string, unknown> {
  return isRecord(value) && hasExactKeys(value, expectedKeys);
}

function hasExactKeys(value: Record<string, unknown>, expectedKeys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}
