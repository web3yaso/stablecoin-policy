import { DataIntegrityError } from "../data/external-storage-errors";
import { sha256, stableJson } from "../data/integrity";
import { SupabaseHttpClient } from "../data/supabase-client";
import { SupabaseObjectStore } from "../data/supabase-object-store";
import type {
  PlaybookPackageArtifact,
} from "./contracts";
import { verifyPlaybookPackageIntegrity } from "./runtime";

const SHA256 = /^[0-9a-f]{64}$/;
const PACKAGE_ID = /^package:[a-z0-9-]+:[0-9a-f]{16}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export type PlaybookPackageArtifactMetadata = {
  packageId: string;
  playbookId: string;
  profileFingerprint: string;
  artifactObjectId: string;
  objectKey: string;
  checksumSha256: string;
  byteSize: number;
  contentType: string;
  integritySha256: string;
  schemaVersion: string;
  evaluatedAt: string;
  assuranceReviewStatus: "PROVISIONAL" | "HUMAN_REVIEWED";
  corpusReleaseId: string | null;
  retrievalIndexReleaseId: string | null;
  dossierId: string | null;
  rulesVersion: string;
  templateVersion: string;
  requestFingerprintSha256?: string;
};

export type PlaybookIdempotencyClaim =
  | { status: "CLAIMED"; leaseExpiresAt: string }
  | { status: "PENDING"; retryAfter: string }
  | { status: "COMPLETED"; artifact: PlaybookPackageArtifact };

export class PlaybookIdempotencyConflictError extends Error {
  constructor() {
    super("Idempotency-Key was already used for a different playbook request");
    this.name = "PlaybookIdempotencyConflictError";
  }
}

export class PlaybookPackageArtifactStore {
  private readonly objects: SupabaseObjectStore;
  private readonly bucket = "policy-playbooks";

  constructor(private readonly client: SupabaseHttpClient) {
    this.objects = new SupabaseObjectStore(client, this.bucket);
  }

  async claimIdempotencyKey(
    idempotencyKey: string,
    requestFingerprintSha256: string,
  ): Promise<PlaybookIdempotencyClaim> {
    assertSha256(requestFingerprintSha256, "request fingerprint");
    let raw: unknown;
    try {
      raw = await this.client.rpc<unknown>(
        "claim_playbook_package_idempotency",
        {
          p_idempotency_key_sha256: hashIdempotencyKey(idempotencyKey),
          p_request_fingerprint_sha256: requestFingerprintSha256,
        },
      );
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes("idempotency key conflict")) {
        throw new PlaybookIdempotencyConflictError();
      }
      throw error;
    }
    if (!isRecord(raw) || typeof raw.status !== "string") {
      throw new DataIntegrityError("invalid playbook idempotency claim response");
    }
    if (raw.status === "CLAIMED") {
      return { status: "CLAIMED", leaseExpiresAt: readTimestamp(raw, "leaseExpiresAt") };
    }
    if (raw.status === "PENDING") {
      return { status: "PENDING", retryAfter: readTimestamp(raw, "retryAfter") };
    }
    if (raw.status === "COMPLETED") {
      const packageId = readString(raw, "packageId");
      const artifact = await this.findByPackageId(packageId);
      if (artifact === null) {
        throw new DataIntegrityError(
          `completed idempotency record has no package: ${packageId}`,
        );
      }
      return { status: "COMPLETED", artifact };
    }
    throw new DataIntegrityError("unknown playbook idempotency claim status");
  }

  async findByPackageId(packageId: string): Promise<PlaybookPackageArtifact | null> {
    if (!PACKAGE_ID.test(packageId)) return null;
    const metadata = await this.client.rpc<unknown>(
      "get_playbook_package_artifact",
      { p_package_id: packageId },
    );
    return metadata === null ? null : this.readArtifact(parseMetadata(metadata));
  }

  async findByIdempotencyKey(
    idempotencyKey: string,
    requestFingerprintSha256: string,
  ): Promise<PlaybookPackageArtifact | null> {
    const keySha256 = hashIdempotencyKey(idempotencyKey);
    assertSha256(requestFingerprintSha256, "request fingerprint");
    const raw = await this.client.rpc<unknown>(
      "get_playbook_package_by_idempotency",
      { p_idempotency_key_sha256: keySha256 },
    );
    if (raw === null) return null;
    const metadata = parseMetadata(raw);
    if (metadata.requestFingerprintSha256 !== requestFingerprintSha256) {
      throw new PlaybookIdempotencyConflictError();
    }
    return this.readArtifact(metadata);
  }

  async persist(
    artifact: PlaybookPackageArtifact,
    idempotencyKey: string,
    requestFingerprintSha256: string,
  ): Promise<PlaybookPackageArtifact> {
    assertArtifact(artifact);
    assertSha256(requestFingerprintSha256, "request fingerprint");
    const body = Buffer.from(stableJson(artifact), "utf8");
    const checksumSha256 = sha256(body);
    const pkg = artifact.package;
    const evidenceClaimIds = readDecisionEvidenceClaimIds(artifact);
    const objectKey = `packages/${pkg.playbookId}/${pkg.integritySha256}.json`;
    const stored = await this.objects.putObject({
      key: objectKey,
      body,
      contentType: "application/json",
      expectedChecksumSha256: checksumSha256,
    });

    await this.client.rpc<string>("register_playbook_package_with_dependencies", {
      p_object_id: `object:playbook-package:${pkg.integritySha256.slice(0, 32)}`,
      p_provider: "supabase-storage",
      p_bucket: this.bucket,
      p_object_key: objectKey,
      p_artifact_checksum_sha256: checksumSha256,
      p_byte_size: stored.byteSize,
      p_content_type: stored.contentType,
      p_package_id: pkg.packageId,
      p_playbook_id: pkg.playbookId,
      p_profile_fingerprint: pkg.profileFingerprint,
      p_integrity_sha256: pkg.integritySha256,
      p_schema_version: pkg.schemaVersion,
      p_evaluated_at: pkg.evaluatedAt,
      p_assurance_review_status: pkg.assurance.reviewStatus,
      p_corpus_release_id: pkg.versions.corpusReleaseId,
      p_retrieval_index_release_id: pkg.versions.retrievalIndexReleaseId,
      p_dossier_id: pkg.versions.dossierId,
      p_rules_version: pkg.versions.rulesVersion,
      p_template_version: pkg.versions.templateVersion,
      p_idempotency_key_sha256: hashIdempotencyKey(idempotencyKey),
      p_request_fingerprint_sha256: requestFingerprintSha256,
      p_evidence_claim_ids: evidenceClaimIds,
    });

    return artifact;
  }

  private async readArtifact(
    metadata: PlaybookPackageArtifactMetadata,
  ): Promise<PlaybookPackageArtifact> {
    const stored = await this.objects.getObject(metadata.objectKey);
    if (stored === null) {
      throw new DataIntegrityError(`playbook package artifact is missing: ${metadata.packageId}`);
    }
    if (
      stored.checksumSha256 !== metadata.checksumSha256
      || stored.byteSize !== metadata.byteSize
      || stored.contentType !== metadata.contentType
    ) {
      throw new DataIntegrityError(
        `playbook package artifact metadata mismatch: ${metadata.packageId}`,
      );
    }
    let artifact: unknown;
    try {
      artifact = JSON.parse(Buffer.from(stored.body).toString("utf8"));
    } catch {
      throw new DataIntegrityError(
        `playbook package artifact is not valid JSON: ${metadata.packageId}`,
      );
    }
    assertArtifact(artifact);
    if (
      artifact.package.packageId !== metadata.packageId
      || artifact.package.integritySha256 !== metadata.integritySha256
      || artifact.package.profileFingerprint !== metadata.profileFingerprint
    ) {
      throw new DataIntegrityError(
        `playbook package artifact identity mismatch: ${metadata.packageId}`,
      );
    }
    return artifact;
  }
}

export function playbookRequestFingerprint(input: {
  playbookId: string;
  profile: unknown;
}): string {
  return sha256(Buffer.from(stableJson(input), "utf8"));
}

export function parseIdempotencyKey(value: string | null): string | null {
  const key = value?.trim() ?? "";
  return IDEMPOTENCY_KEY.test(key) ? key : null;
}

export function hashIdempotencyKey(value: string): string {
  const key = parseIdempotencyKey(value);
  if (key === null) throw new Error("invalid Idempotency-Key");
  return sha256(Buffer.from(key, "utf8"));
}

function parseMetadata(value: unknown): PlaybookPackageArtifactMetadata {
  if (!isRecord(value)) throw new DataIntegrityError("invalid playbook package metadata");
  const metadata: PlaybookPackageArtifactMetadata = {
    packageId: readString(value, "packageId"),
    playbookId: readString(value, "playbookId"),
    profileFingerprint: readString(value, "profileFingerprint"),
    artifactObjectId: readString(value, "artifactObjectId"),
    objectKey: readString(value, "objectKey"),
    checksumSha256: readString(value, "checksumSha256"),
    byteSize: readNumber(value, "byteSize"),
    contentType: readString(value, "contentType"),
    integritySha256: readString(value, "integritySha256"),
    schemaVersion: readString(value, "schemaVersion"),
    evaluatedAt: readTimestamp(value, "evaluatedAt"),
    assuranceReviewStatus: readReviewStatus(value.assuranceReviewStatus),
    corpusReleaseId: readNullableString(value, "corpusReleaseId"),
    retrievalIndexReleaseId: readNullableString(value, "retrievalIndexReleaseId"),
    dossierId: readNullableString(value, "dossierId"),
    rulesVersion: readString(value, "rulesVersion"),
    templateVersion: readString(value, "templateVersion"),
  };
  if (value.requestFingerprintSha256 !== undefined) {
    metadata.requestFingerprintSha256 = readString(value, "requestFingerprintSha256");
  }
  if (!PACKAGE_ID.test(metadata.packageId)) {
    throw new DataIntegrityError("invalid stored playbook package ID");
  }
  for (const [label, hash] of [
    ["profile fingerprint", metadata.profileFingerprint],
    ["artifact checksum", metadata.checksumSha256],
    ["package integrity", metadata.integritySha256],
  ] as const) assertSha256(hash, label);
  if (metadata.requestFingerprintSha256 !== undefined) {
    assertSha256(metadata.requestFingerprintSha256, "request fingerprint");
  }
  return metadata;
}

function assertArtifact(value: unknown): asserts value is PlaybookPackageArtifact {
  if (!isRecord(value) || !isRecord(value.package) || !isRecord(value.evidenceBundle)) {
    throw new DataIntegrityError("invalid playbook package artifact shape");
  }
  const pkg = value.package as unknown as PlaybookPackageArtifact["package"];
  const bundle = value.evidenceBundle as unknown as PlaybookPackageArtifact["evidenceBundle"];
  if (
    !PACKAGE_ID.test(pkg.packageId)
    || pkg.schemaVersion !== "1.1.0"
    || bundle.schemaVersion !== "1.1.0"
    || bundle.packageId !== pkg.packageId
    || !verifyPlaybookPackageIntegrity(pkg)
  ) {
    throw new DataIntegrityError("playbook package artifact integrity check failed");
  }
  readDecisionEvidenceClaimIds(value as unknown as PlaybookPackageArtifact);
}

function readDecisionEvidenceClaimIds(
  artifact: PlaybookPackageArtifact,
): string[] {
  const conclusions: unknown = artifact.package.conclusions;
  const claims: unknown = artifact.evidenceBundle.claims;
  if (!Array.isArray(conclusions) || !Array.isArray(claims)) {
    throw new DataIntegrityError("invalid playbook decision evidence shape");
  }

  const referenced: string[] = [];
  for (const conclusion of conclusions) {
    if (!isRecord(conclusion) || !Array.isArray(conclusion.evidenceClaimIds)) {
      throw new DataIntegrityError("invalid playbook conclusion evidence claims");
    }
    for (const claimId of conclusion.evidenceClaimIds) {
      if (typeof claimId !== "string" || claimId.length === 0) {
        throw new DataIntegrityError("invalid playbook conclusion evidence claim ID");
      }
      referenced.push(claimId);
    }
  }

  const bundled: string[] = [];
  for (const claim of claims) {
    if (!isRecord(claim) || typeof claim.claimId !== "string" || claim.claimId.length === 0) {
      throw new DataIntegrityError("invalid playbook evidence bundle claim ID");
    }
    bundled.push(claim.claimId);
  }

  const expected = [...new Set(referenced)].sort();
  const actual = [...new Set(bundled)].sort();
  if (actual.length !== bundled.length || actual.length !== expected.length
      || actual.some((claimId, index) => claimId !== expected[index])) {
    throw new DataIntegrityError(
      "playbook evidence bundle does not match conclusion claim dependencies",
    );
  }
  return actual;
}

function assertSha256(value: string, label: string): void {
  if (!SHA256.test(value)) throw new DataIntegrityError(`invalid ${label}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: Record<string, unknown>, key: string): string {
  const item = value[key];
  if (typeof item !== "string" || item.length === 0) {
    throw new DataIntegrityError(`invalid playbook package metadata ${key}`);
  }
  return item;
}

function readNullableString(
  value: Record<string, unknown>,
  key: string,
): string | null {
  const item = value[key];
  if (item === null) return null;
  return readString(value, key);
}

function readNumber(value: Record<string, unknown>, key: string): number {
  const item = value[key];
  const numeric = typeof item === "string" ? Number(item) : item;
  if (typeof numeric !== "number" || !Number.isSafeInteger(numeric) || numeric < 0) {
    throw new DataIntegrityError(`invalid playbook package metadata ${key}`);
  }
  return numeric;
}

function readTimestamp(value: Record<string, unknown>, key: string): string {
  const item = readString(value, key);
  if (!Number.isFinite(Date.parse(item))) {
    throw new DataIntegrityError(`invalid playbook package metadata ${key}`);
  }
  return new Date(item).toISOString();
}

function readReviewStatus(
  value: unknown,
): "PROVISIONAL" | "HUMAN_REVIEWED" {
  if (value !== "PROVISIONAL" && value !== "HUMAN_REVIEWED") {
    throw new DataIntegrityError("invalid playbook package assurance review status");
  }
  return value;
}
