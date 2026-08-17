import { DataIntegrityError } from "../data/external-storage-errors";
import { SupabaseHttpClient } from "../data/supabase-client";

const PACKAGE_ID = /^package:[a-z0-9-]+:[0-9a-f]{16}$/;
const WATCHLIST_ID = /^watchlist:[0-9a-f]{32}$/;
const DELTA_ID = /^delta:[0-9a-f]{32}$/;
const EVENT_ID = /^[a-z0-9][a-z0-9._:-]{2,160}$/;
const CURSOR_VERSION = 1;
const MAX_CURSOR_LENGTH = 1_024;
export const DEFAULT_CHANGE_DELTA_PAGE_LIMIT = 50;
export const MAX_CHANGE_DELTA_PAGE_LIMIT = 100;

export type ChangeDeltaImpactType =
  | "MAY_AFFECT"
  | "INVALIDATES"
  | "SUPERSEDES"
  | "DEADLINE";

export type ChangeToActionDelta = {
  deltaId: string;
  cursor: string;
  watchlistId: string;
  packageId: string;
  event: {
    eventId: string;
    eventType: string;
    title: string;
    publishedAt: string;
    effectiveAt: string | null;
    beforeVersionId: string | null;
    afterVersionId: string | null;
  };
  evidenceChanges: Array<{
    claimId: string;
    impactType: ChangeDeltaImpactType;
  }>;
  status: "REVIEW_REQUIRED";
  packageAssuranceReviewStatus: "PROVISIONAL" | "HUMAN_REVIEWED";
  actions: ["REVIEW_EVIDENCE_CHANGE", "REQUEST_PLAYBOOK_RERUN"];
  requiredCustomerResponse: "ACKNOWLEDGE_AND_RERUN";
  createdAt: string;
};

export type ChangeToActionDeltaPage = {
  schemaVersion: "1.0.0";
  watchlistId: string;
  packageId: string;
  items: ChangeToActionDelta[];
  nextCursor: string;
  hasMore: boolean;
};

export type ChangeToActionDeltaListResult =
  | { status: "OK"; page: ChangeToActionDeltaPage }
  | { status: "NOT_FOUND" };

type DecodedCursor = {
  watchlistId: string | null;
  sequence: number;
};

export type RawChangeToActionDelta = Omit<ChangeToActionDelta, "cursor"> & {
  deltaSequence: number;
};

export class InvalidChangeDeltaCursorError extends Error {
  constructor() {
    super("after_cursor is invalid");
    this.name = "InvalidChangeDeltaCursorError";
  }
}

export class PlaybookWatchlistChangeDeltaStore {
  constructor(private readonly client: SupabaseHttpClient) {}

  async list(
    packageId: string,
    afterCursor?: string,
    limit = DEFAULT_CHANGE_DELTA_PAGE_LIMIT,
  ): Promise<ChangeToActionDeltaListResult> {
    if (!PACKAGE_ID.test(packageId)) throw new Error("invalid playbook package ID");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_CHANGE_DELTA_PAGE_LIMIT) {
      throw new Error("invalid change delta page limit");
    }
    const decoded = afterCursor
      ? decodeChangeDeltaCursor(afterCursor, packageId)
      : { watchlistId: null, sequence: 0 };
    const raw = await this.client.rpc<unknown>(
      "get_playbook_watchlist_change_deltas",
      {
        p_package_id: packageId,
        p_after_sequence: decoded.sequence,
        p_cursor_watchlist_id: decoded.watchlistId,
        p_limit: limit,
      },
    );
    return parseDeltaListResult(raw, packageId, decoded.sequence, limit);
  }
}

export function encodeChangeDeltaCursor(
  packageId: string,
  watchlistId: string,
  sequence: number,
): string {
  if (
    !PACKAGE_ID.test(packageId)
    || !WATCHLIST_ID.test(watchlistId)
    || !Number.isSafeInteger(sequence)
    || sequence < 0
  ) {
    throw new Error("cannot encode invalid change delta cursor");
  }
  return Buffer.from(JSON.stringify({
    version: CURSOR_VERSION,
    packageId,
    watchlistId,
    sequence,
  }), "utf8").toString("base64url");
}

export function decodeChangeDeltaCursor(
  cursor: string,
  expectedPackageId: string,
): DecodedCursor {
  if (
    !PACKAGE_ID.test(expectedPackageId)
    || cursor.length === 0
    || cursor.length > MAX_CURSOR_LENGTH
    || !/^[A-Za-z0-9_-]+$/.test(cursor)
  ) {
    throw new InvalidChangeDeltaCursorError();
  }
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      !isExactRecord(value, [
        "version", "packageId", "watchlistId", "sequence",
      ])
      || value.version !== CURSOR_VERSION
      || value.packageId !== expectedPackageId
      || typeof value.watchlistId !== "string"
      || !WATCHLIST_ID.test(value.watchlistId)
      || typeof value.sequence !== "number"
      || !Number.isSafeInteger(value.sequence)
      || value.sequence < 0
    ) {
      throw new InvalidChangeDeltaCursorError();
    }
    return { watchlistId: value.watchlistId, sequence: value.sequence };
  } catch (error: unknown) {
    if (error instanceof InvalidChangeDeltaCursorError) throw error;
    throw new InvalidChangeDeltaCursorError();
  }
}

export function parseDeltaListResult(
  value: unknown,
  requestedPackageId: string,
  afterSequence: number,
  limit: number,
): ChangeToActionDeltaListResult {
  if (!isRecord(value) || typeof value.status !== "string") {
    throw new DataIntegrityError("invalid change delta response");
  }
  if (value.status === "NOT_FOUND" && hasExactKeys(value, ["status"])) {
    return { status: "NOT_FOUND" };
  }
  if (value.status === "INVALID_CURSOR" && hasExactKeys(value, ["status"])) {
    throw new InvalidChangeDeltaCursorError();
  }
  if (!isExactRecord(value, [
    "status", "schemaVersion", "watchlistId", "packageId", "items",
    "nextSequence", "hasMore",
  ])) {
    throw new DataIntegrityError("invalid change delta page shape");
  }
  if (
    value.status !== "OK"
    || value.schemaVersion !== "1.0.0"
    || typeof value.watchlistId !== "string"
    || !WATCHLIST_ID.test(value.watchlistId)
    || value.packageId !== requestedPackageId
    || !Array.isArray(value.items)
    || value.items.length > limit
    || typeof value.nextSequence !== "number"
    || !Number.isSafeInteger(value.nextSequence)
    || value.nextSequence < afterSequence
    || typeof value.hasMore !== "boolean"
  ) {
    throw new DataIntegrityError("invalid change delta page metadata");
  }
  const rawItems = value.items.map((item) => parseRawChangeToActionDelta(
    item,
    requestedPackageId,
    value.watchlistId as string,
  ));
  assertStrictlyIncreasing(rawItems.map((item) => item.deltaSequence));
  if (rawItems.some((item) => item.deltaSequence <= afterSequence)) {
    throw new DataIntegrityError("change delta page did not advance past cursor");
  }
  const lastSequence = rawItems.at(-1)?.deltaSequence ?? afterSequence;
  if (
    value.nextSequence !== lastSequence
    || (rawItems.length === 0 && value.hasMore)
    || (value.hasMore && rawItems.length !== limit)
  ) {
    throw new DataIntegrityError("change delta next cursor mismatch");
  }
  const items = rawItems.map(({ deltaSequence, ...item }) => ({
    ...item,
    cursor: encodeChangeDeltaCursor(
      requestedPackageId,
      value.watchlistId as string,
      deltaSequence,
    ),
  }));
  return {
    status: "OK",
    page: {
      schemaVersion: "1.0.0",
      watchlistId: value.watchlistId,
      packageId: requestedPackageId,
      items,
      nextCursor: encodeChangeDeltaCursor(
        requestedPackageId,
        value.watchlistId,
        value.nextSequence,
      ),
      hasMore: value.hasMore,
    },
  };
}

export function parseRawChangeToActionDelta(
  value: unknown,
  packageId: string,
  watchlistId: string,
): RawChangeToActionDelta {
  if (!PACKAGE_ID.test(packageId) || !WATCHLIST_ID.test(watchlistId)) {
    throw new DataIntegrityError("invalid change delta binding");
  }
  if (!isExactRecord(value, [
    "deltaId", "deltaSequence", "watchlistId", "packageId", "event",
    "evidenceChanges", "status", "packageAssuranceReviewStatus", "actions",
    "requiredCustomerResponse", "createdAt",
  ])) {
    throw new DataIntegrityError("invalid change delta item shape");
  }
  if (
    typeof value.deltaId !== "string"
    || !DELTA_ID.test(value.deltaId)
    || typeof value.deltaSequence !== "number"
    || !Number.isSafeInteger(value.deltaSequence)
    || value.deltaSequence < 1
    || value.watchlistId !== watchlistId
    || value.packageId !== packageId
    || !isExactRecord(value.event, [
      "eventId", "eventType", "title", "publishedAt", "effectiveAt",
      "beforeVersionId", "afterVersionId",
    ])
    || !Array.isArray(value.evidenceChanges)
    || value.evidenceChanges.length === 0
    || value.status !== "REVIEW_REQUIRED"
    || (value.packageAssuranceReviewStatus !== "PROVISIONAL"
      && value.packageAssuranceReviewStatus !== "HUMAN_REVIEWED")
    || !Array.isArray(value.actions)
    || value.actions.length !== 2
    || value.actions[0] !== "REVIEW_EVIDENCE_CHANGE"
    || value.actions[1] !== "REQUEST_PLAYBOOK_RERUN"
    || value.requiredCustomerResponse !== "ACKNOWLEDGE_AND_RERUN"
    || typeof value.createdAt !== "string"
    || !Number.isFinite(Date.parse(value.createdAt))
  ) {
    throw new DataIntegrityError("invalid change delta item metadata");
  }
  const event = parseEvent(value.event);
  const evidenceChanges = value.evidenceChanges.map(parseEvidenceChange);
  if (new Set(evidenceChanges.map((item) => item.claimId)).size !== evidenceChanges.length) {
    throw new DataIntegrityError("duplicate change delta claim impact");
  }
  assertCanonicalOrder(evidenceChanges.map((item) => item.claimId));
  return {
    deltaId: value.deltaId,
    deltaSequence: value.deltaSequence,
    watchlistId,
    packageId,
    event,
    evidenceChanges,
    status: "REVIEW_REQUIRED",
    packageAssuranceReviewStatus: value.packageAssuranceReviewStatus,
    actions: ["REVIEW_EVIDENCE_CHANGE", "REQUEST_PLAYBOOK_RERUN"],
    requiredCustomerResponse: "ACKNOWLEDGE_AND_RERUN",
    createdAt: new Date(value.createdAt).toISOString(),
  };
}

function parseEvent(value: Record<string, unknown>): ChangeToActionDelta["event"] {
  if (
    typeof value.eventId !== "string"
    || !EVENT_ID.test(value.eventId)
    || typeof value.eventType !== "string"
    || value.eventType.length === 0
    || typeof value.title !== "string"
    || value.title.trim().length === 0
    || typeof value.publishedAt !== "string"
    || !Number.isFinite(Date.parse(value.publishedAt))
    || !isNullableTimestamp(value.effectiveAt)
    || !isNullableNonEmptyString(value.beforeVersionId)
    || !isNullableNonEmptyString(value.afterVersionId)
  ) {
    throw new DataIntegrityError("invalid change delta event snapshot");
  }
  return {
    eventId: value.eventId,
    eventType: value.eventType,
    title: value.title,
    publishedAt: new Date(value.publishedAt).toISOString(),
    effectiveAt: normalizeNullableTimestamp(value.effectiveAt),
    beforeVersionId: value.beforeVersionId,
    afterVersionId: value.afterVersionId,
  };
}

function parseEvidenceChange(value: unknown): ChangeToActionDelta["evidenceChanges"][number] {
  if (
    !isExactRecord(value, ["claimId", "impactType"])
    || typeof value.claimId !== "string"
    || value.claimId.length === 0
    || !isImpactType(value.impactType)
  ) {
    throw new DataIntegrityError("invalid change delta evidence change");
  }
  return { claimId: value.claimId, impactType: value.impactType };
}

function isImpactType(value: unknown): value is ChangeDeltaImpactType {
  return value === "MAY_AFFECT"
    || value === "INVALIDATES"
    || value === "SUPERSEDES"
    || value === "DEADLINE";
}

function isNullableTimestamp(value: unknown): value is string | null {
  return value === null
    || (typeof value === "string" && Number.isFinite(Date.parse(value)));
}

function normalizeNullableTimestamp(value: string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function isNullableNonEmptyString(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.length > 0);
}

function assertStrictlyIncreasing(values: number[]): void {
  if (values.some((value, index) => index > 0 && value <= values[index - 1])) {
    throw new DataIntegrityError("change delta cursors are not strictly increasing");
  }
}

function assertCanonicalOrder(values: string[]): void {
  const sorted = [...values].sort((left, right) => left.localeCompare(right));
  if (sorted.some((item, index) => item !== values[index])) {
    throw new DataIntegrityError("change delta evidence changes are not canonical");
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
