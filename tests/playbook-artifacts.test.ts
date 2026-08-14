import assert from "node:assert/strict";
import test from "node:test";
import { DataIntegrityError, ExternalStorageError } from "../lib/data/external-storage-errors";
import { SupabaseHttpClient, type FetchLike } from "../lib/data/supabase-client";
import {
  hashIdempotencyKey,
  parseIdempotencyKey,
  PlaybookIdempotencyConflictError,
  PlaybookPackageArtifactStore,
  playbookRequestFingerprint,
} from "../lib/playbooks/artifacts";
import type { BusinessProfile, EvidenceClaim } from "../lib/playbooks/contracts";
import { businessModelBoundaryPlaybook } from "../lib/playbooks/definitions";
import {
  assembleEvidenceBundle,
  evaluatePlaybook,
  sealPlaybookPackage,
  type EvaluationEvidence,
} from "../lib/playbooks/runtime";

const IDEMPOTENCY_KEY = "playbook-request-00000001";

test("playbook artifacts persist privately and replay through a completed idempotency claim", async () => {
  const backend = fakeBackend();
  const store = new PlaybookPackageArtifactStore(client(backend.fetch));
  const artifact = createArtifact();
  const profile = profileFixture();
  const requestFingerprint = playbookRequestFingerprint({
    playbookId: artifact.package.playbookId,
    profile,
  });

  const firstClaim = await store.claimIdempotencyKey(
    IDEMPOTENCY_KEY,
    requestFingerprint,
  );
  assert.equal(firstClaim.status, "CLAIMED");
  const concurrentClaim = await store.claimIdempotencyKey(
    IDEMPOTENCY_KEY,
    requestFingerprint,
  );
  assert.equal(concurrentClaim.status, "PENDING");

  await store.persist(artifact, IDEMPOTENCY_KEY, requestFingerprint);
  const replay = await store.claimIdempotencyKey(
    IDEMPOTENCY_KEY,
    requestFingerprint,
  );
  assert.equal(replay.status, "COMPLETED");
  if (replay.status !== "COMPLETED") return;
  assert.deepEqual(replay.artifact, artifact);
  assert.deepEqual(await store.findByPackageId(artifact.package.packageId), artifact);

  assert.equal(backend.metadata.size, 1);
  const storedMetadata = [...backend.metadata.values()][0];
  assert.equal("profile" in storedMetadata, false);
  assert.equal("artifact" in storedMetadata, false);
  assert.equal(storedMetadata.profileFingerprint, artifact.package.profileFingerprint);
  assert.equal(
    backend.rpcBodies.some((body) => JSON.stringify(body).includes(IDEMPOTENCY_KEY)),
    false,
  );
  assert.equal(
    backend.rpcBodies.some((body) =>
      JSON.stringify(body).includes(hashIdempotencyKey(IDEMPOTENCY_KEY))),
    true,
  );
  const registration = backend.rpcBodies.find(
    (body) => Array.isArray(body.p_evidence_claim_ids),
  );
  assert.deepEqual(registration?.p_evidence_claim_ids, [claimFixture().claimId]);
});

test("the same idempotency key cannot be reused for a different request", async () => {
  const backend = fakeBackend();
  const store = new PlaybookPackageArtifactStore(client(backend.fetch));
  const firstFingerprint = playbookRequestFingerprint({
    playbookId: "stablecoin-pre-listing",
    profile: profileFixture(),
  });
  const secondFingerprint = playbookRequestFingerprint({
    playbookId: "business-model-regulatory-boundary",
    profile: profileFixture(),
  });
  await store.claimIdempotencyKey(IDEMPOTENCY_KEY, firstFingerprint);

  await assert.rejects(
    () => store.claimIdempotencyKey(IDEMPOTENCY_KEY, secondFingerprint),
    PlaybookIdempotencyConflictError,
  );
});

test("artifact replay fails closed on changed object bytes", async () => {
  const backend = fakeBackend();
  const store = new PlaybookPackageArtifactStore(client(backend.fetch));
  const artifact = createArtifact();
  const fingerprint = playbookRequestFingerprint({
    playbookId: artifact.package.playbookId,
    profile: profileFixture(),
  });
  await store.claimIdempotencyKey(IDEMPOTENCY_KEY, fingerprint);
  await store.persist(artifact, IDEMPOTENCY_KEY, fingerprint);
  const objectKey = [...backend.objects.keys()][0];
  backend.objects.set(objectKey, Buffer.from("tampered"));

  await assert.rejects(
    () => store.findByPackageId(artifact.package.packageId),
    DataIntegrityError,
  );
});

test("artifact persistence exposes storage outages instead of returning an unpersisted package", async () => {
  const backend = fakeBackend({ storageOutage: true });
  const store = new PlaybookPackageArtifactStore(client(backend.fetch));
  const artifact = createArtifact();
  const fingerprint = playbookRequestFingerprint({
    playbookId: artifact.package.playbookId,
    profile: profileFixture(),
  });
  await store.claimIdempotencyKey(IDEMPOTENCY_KEY, fingerprint);

  await assert.rejects(
    () => store.persist(artifact, IDEMPOTENCY_KEY, fingerprint),
    ExternalStorageError,
  );
  assert.equal(backend.metadata.size, 0);
});

test("artifact persistence rejects a dependency set that differs from conclusions", async () => {
  const backend = fakeBackend();
  const store = new PlaybookPackageArtifactStore(client(backend.fetch));
  const artifact = createArtifact();
  artifact.evidenceBundle.claims = [];
  const fingerprint = playbookRequestFingerprint({
    playbookId: artifact.package.playbookId,
    profile: profileFixture(),
  });

  await assert.rejects(
    () => store.persist(artifact, IDEMPOTENCY_KEY, fingerprint),
    /does not match conclusion claim dependencies/,
  );
  assert.equal(backend.objects.size, 0);
  assert.equal(backend.metadata.size, 0);
});

test("idempotency keys are bounded opaque tokens and request fingerprints are canonical", () => {
  assert.equal(parseIdempotencyKey(IDEMPOTENCY_KEY), IDEMPOTENCY_KEY);
  assert.equal(parseIdempotencyKey("short"), null);
  assert.equal(parseIdempotencyKey("contains spaces"), null);
  assert.equal(parseIdempotencyKey("x".repeat(129)), null);
  assert.equal(
    playbookRequestFingerprint({
      playbookId: "stablecoin-pre-listing",
      profile: { b: 2, a: 1 },
    }),
    playbookRequestFingerprint({
      profile: { a: 1, b: 2 },
      playbookId: "stablecoin-pre-listing",
    }),
  );
});

function profileFixture(): BusinessProfile {
  return {
    operatorJurisdiction: "SG",
    targetJurisdiction: "EEA",
    activities: ["issue-emt"],
    asset: null,
  };
}

function createArtifact() {
  const evidence: EvaluationEvidence = {
    claims: [claimFixture()],
    dossier: null,
    now: "2026-08-12T00:00:00.000Z",
    maxEvidenceAgeDays: 90,
  };
  const profile = profileFixture();
  const conclusions = evaluatePlaybook(
    businessModelBoundaryPlaybook,
    profile,
    evidence,
  );
  const pkg = sealPlaybookPackage(
    businessModelBoundaryPlaybook,
    profile,
    conclusions,
    evidence,
  );
  return { package: pkg, evidenceBundle: assembleEvidenceBundle(pkg, evidence) };
}

function claimFixture(): EvidenceClaim {
  return {
    claimId: "claim:eea:mica:e-money-token-authorisation:18",
    topic: "e-money-token-authorisation",
    legalStatus: "REQUIREMENT",
    proposition: "Sanitized authorization fixture.",
    citations: [{ provisionId: "provision:fixture:18", locator: "Article 18" }],
    releaseId: "provisional:eea:mica:2026-08-02",
    asOf: "2026-08-11T00:00:00.000Z",
    knowledgeCutoff: "2026-08-10T00:00:00.000Z",
    confidence: 0.95,
    limitations: ["Sanitized provisional fixture."],
  };
}

function client(fetchImpl: FetchLike): SupabaseHttpClient {
  return new SupabaseHttpClient({
    url: "https://example.supabase.co",
    serviceRoleKey: "test-service-role-key",
    reportsBucket: "policy-reports",
    datasetsBucket: "policy-datasets",
    sourcesBucket: "policy-sources",
    requestTimeoutMs: 1_000,
  }, fetchImpl);
}

function fakeBackend(options: { storageOutage?: boolean } = {}) {
  const objects = new Map<string, Uint8Array>();
  const metadata = new Map<string, Record<string, unknown>>();
  const idempotency = new Map<string, {
    requestFingerprint: string;
    packageId: string | null;
    state: "PENDING" | "COMPLETED";
    retryAfter: string;
  }>();
  const rpcBodies: Record<string, unknown>[] = [];
  const fetch: FetchLike = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.startsWith("/storage/v1/object/")) {
      const key = url.pathname;
      if (init?.method === "POST") {
        if (options.storageOutage) return new Response("outage", { status: 503 });
        if (objects.has(key)) return new Response("duplicate", { status: 409 });
        objects.set(key, new Uint8Array(await new Response(init.body).arrayBuffer()));
        return Response.json({ Key: key });
      }
      const body = objects.get(key);
      return body
        ? new Response(Buffer.from(body), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        : new Response("missing", { status: 404 });
    }

    const functionName = url.pathname.split("/").at(-1) ?? "";
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    rpcBodies.push(body);
    if (functionName === "claim_playbook_package_idempotency") {
      const keyHash = String(body.p_idempotency_key_sha256);
      const fingerprint = String(body.p_request_fingerprint_sha256);
      const existing = idempotency.get(keyHash);
      if (existing && existing.requestFingerprint !== fingerprint) {
        return new Response("playbook idempotency key conflict", { status: 409 });
      }
      if (existing?.state === "COMPLETED") {
        return Response.json({ status: "COMPLETED", packageId: existing.packageId });
      }
      if (existing) {
        return Response.json({ status: "PENDING", retryAfter: existing.retryAfter });
      }
      const retryAfter = "2026-08-12T00:02:00.000Z";
      idempotency.set(keyHash, {
        requestFingerprint: fingerprint,
        packageId: null,
        state: "PENDING",
        retryAfter,
      });
      return Response.json({ status: "CLAIMED", leaseExpiresAt: retryAfter });
    }
    if (functionName === "register_playbook_package_with_dependencies") {
      const packageId = String(body.p_package_id);
      const storedMetadata = {
        packageId,
        playbookId: body.p_playbook_id,
        profileFingerprint: body.p_profile_fingerprint,
        artifactObjectId: body.p_object_id,
        objectKey: body.p_object_key,
        checksumSha256: body.p_artifact_checksum_sha256,
        byteSize: body.p_byte_size,
        contentType: body.p_content_type,
        integritySha256: body.p_integrity_sha256,
        schemaVersion: body.p_schema_version,
        evaluatedAt: body.p_evaluated_at,
        assuranceReviewStatus: body.p_assurance_review_status,
        corpusReleaseId: body.p_corpus_release_id,
        retrievalIndexReleaseId: body.p_retrieval_index_release_id,
        dossierId: body.p_dossier_id,
        rulesVersion: body.p_rules_version,
        templateVersion: body.p_template_version,
      };
      metadata.set(packageId, storedMetadata);
      const keyHash = String(body.p_idempotency_key_sha256);
      const record = idempotency.get(keyHash);
      if (!record) return new Response("not claimed", { status: 409 });
      record.packageId = packageId;
      record.state = "COMPLETED";
      return Response.json(packageId);
    }
    if (functionName === "get_playbook_package_artifact") {
      return Response.json(metadata.get(String(body.p_package_id)) ?? null);
    }
    if (functionName === "get_playbook_package_by_idempotency") {
      const record = idempotency.get(String(body.p_idempotency_key_sha256));
      const item = record?.packageId ? metadata.get(record.packageId) : null;
      return Response.json(item
        ? { ...item, requestFingerprintSha256: record?.requestFingerprint }
        : null);
    }
    return new Response("unknown rpc", { status: 404 });
  };
  return { fetch, objects, metadata, rpcBodies };
}
