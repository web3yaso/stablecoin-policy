import type { SupabaseHttpClient } from "../data/supabase-client";
import type {
  RetrievalCorpusKind,
  RetrievalIndexBuildInput,
  RetrievalIndexPlan,
} from "./index-builder";
import type { IndexedEvidenceChunk, RetrievalIndexRelease } from "./contracts";

export type RetrievalIndexManifestEnvelope = {
  indexReleaseId: string;
  releaseState: "DRAFT" | "ACTIVE" | "RETIRED";
  manifest: Record<string, unknown>;
  manifestSha256: string;
};

export type RetrievalCorpusSnapshotEnvelope = {
  snapshotId: string;
  manifest: Record<string, unknown>;
  manifestSha256: string;
  sourceReleaseCount: number;
  claimCount: number;
};

export type RetrievalEvalAssurance = "MACHINE_ASSURED" | "HUMAN_REVIEWED";
export type RetrievalEvalOutcome = "PASSED" | "FAILED";
export type RetrievalEvalMetrics = {
  recallAt10: number;
  mrrAt10: number;
  citationPrecision: number;
  versionIsolation: number;
  checklistTopicCoverage: number;
  rightsLeaks: number;
  assuranceLeaks: number;
  promptInstructionLeaks: number;
  unsafeBuildsAccepted: number;
};

export type RetrievalDraftEvalInput = {
  indexRelease: RetrievalIndexRelease;
  chunks: Array<Omit<IndexedEvidenceChunk, "embedding"> & { embedding: string }>;
};

export class RetrievalIndexAdminClient {
  constructor(private readonly client: SupabaseHttpClient) {}

  async buildInput(
    policyDomain: string,
    corpusReleaseId: string,
    corpusReleaseKind: RetrievalCorpusKind,
  ): Promise<RetrievalIndexBuildInput> {
    const input = await this.client.rpc<RetrievalIndexBuildInput | null>(
      "get_retrieval_index_build_input",
      {
        p_policy_domain: policyDomain,
        p_corpus_release_id: corpusReleaseId,
        p_corpus_release_kind: corpusReleaseKind,
      },
    );
    if (input === null) throw new Error("eligible retrieval corpus release not found");
    return input;
  }

  async prepareSnapshot(
    snapshotId: string,
    policyDomain: string,
    corpusReleaseKind: RetrievalCorpusKind,
    sourceReleaseIds: string[],
  ): Promise<RetrievalCorpusSnapshotEnvelope> {
    assertIdentifier(snapshotId);
    return this.client.rpc<RetrievalCorpusSnapshotEnvelope>(
      "prepare_retrieval_corpus_snapshot",
      {
        p_snapshot_id: snapshotId,
        p_policy_domain: policyDomain,
        p_corpus_release_kind: corpusReleaseKind,
        p_source_release_ids: sourceReleaseIds,
      },
    );
  }

  async createSnapshot(
    snapshotId: string,
    policyDomain: string,
    corpusReleaseKind: RetrievalCorpusKind,
    sourceReleaseIds: string[],
    expectedManifestSha256: string,
  ): Promise<RetrievalCorpusSnapshotEnvelope> {
    assertSha256(expectedManifestSha256, "expected snapshot manifest");
    return this.client.rpc<RetrievalCorpusSnapshotEnvelope>(
      "create_retrieval_corpus_snapshot",
      {
        p_snapshot_id: snapshotId,
        p_policy_domain: policyDomain,
        p_corpus_release_kind: corpusReleaseKind,
        p_source_release_ids: sourceReleaseIds,
        p_expected_manifest_sha256: expectedManifestSha256,
      },
    );
  }

  async snapshotBuildInput(snapshotId: string): Promise<RetrievalIndexBuildInput> {
    assertIdentifier(snapshotId);
    const input = await this.client.rpc<RetrievalIndexBuildInput | null>(
      "get_retrieval_snapshot_build_input",
      { p_snapshot_id: snapshotId },
    );
    if (input === null) throw new Error("retrieval corpus snapshot not found");
    return input;
  }

  async build(plan: RetrievalIndexPlan): Promise<RetrievalIndexManifestEnvelope> {
    return this.client.rpc<RetrievalIndexManifestEnvelope>(
      "build_retrieval_index_release",
      { p_plan: plan },
    );
  }

  async manifest(indexReleaseId: string): Promise<RetrievalIndexManifestEnvelope> {
    assertIdentifier(indexReleaseId);
    const envelope = await this.client.rpc<RetrievalIndexManifestEnvelope | null>(
      "get_retrieval_index_manifest",
      { p_index_release_id: indexReleaseId },
    );
    if (envelope === null) throw new Error("retrieval index release not found");
    return envelope;
  }

  async activate(
    indexReleaseId: string,
    expectedManifestSha256: string,
    activatedAt: string,
  ): Promise<Record<string, unknown>> {
    assertIdentifier(indexReleaseId);
    if (!/^[0-9a-f]{64}$/.test(expectedManifestSha256)) {
      throw new Error("expected manifest SHA-256 is invalid");
    }
    if (!Number.isFinite(Date.parse(activatedAt))) {
      throw new Error("activation timestamp is invalid");
    }
    return this.client.rpc<Record<string, unknown>>(
      "activate_retrieval_index_release",
      {
        p_index_release_id: indexReleaseId,
        p_expected_manifest_sha256: expectedManifestSha256,
        p_activated_at: activatedAt,
      },
    );
  }

  async recordEval(input: {
    evalRecordId: string;
    indexReleaseId: string;
    expectedManifestSha256: string;
    evalAssurance: RetrievalEvalAssurance;
    outcome: RetrievalEvalOutcome;
    artifactSha256: string;
    metrics: RetrievalEvalMetrics;
    evaluatedAt: string;
  }): Promise<Record<string, unknown>> {
    assertIdentifier(input.evalRecordId);
    assertIdentifier(input.indexReleaseId);
    assertSha256(input.expectedManifestSha256, "expected manifest");
    assertSha256(input.artifactSha256, "eval artifact");
    if (!Number.isFinite(Date.parse(input.evaluatedAt))) {
      throw new Error("eval timestamp is invalid");
    }
    return this.client.rpc<Record<string, unknown>>(
      "record_retrieval_index_eval",
      {
        p_eval_record_id: input.evalRecordId,
        p_index_release_id: input.indexReleaseId,
        p_expected_manifest_sha256: input.expectedManifestSha256,
        p_eval_assurance: input.evalAssurance,
        p_outcome: input.outcome,
        p_artifact_sha256: input.artifactSha256,
        p_metrics: input.metrics,
        p_evaluated_at: input.evaluatedAt,
      },
    );
  }

  async draftEvalInput(indexReleaseId: string): Promise<RetrievalDraftEvalInput> {
    assertIdentifier(indexReleaseId);
    const input = await this.client.rpc<RetrievalDraftEvalInput | null>(
      "get_retrieval_draft_eval_input",
      { p_index_release_id: indexReleaseId },
    );
    if (input === null) throw new Error("DRAFT retrieval index not found");
    return input;
  }
}

function assertIdentifier(value: string): void {
  if (!/^[a-z0-9][a-z0-9._:-]{2,200}$/.test(value)) {
    throw new Error("retrieval index release identifier is invalid");
  }
}

function assertSha256(value: string, label: string): void {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(`${label} SHA-256 is invalid`);
  }
}
