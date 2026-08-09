import type { SupabaseHttpClient } from "../data/supabase-client";
import type {
  RetrievalCorpusKind,
  RetrievalIndexBuildInput,
  RetrievalIndexPlan,
} from "./index-builder";

export type RetrievalIndexManifestEnvelope = {
  indexReleaseId: string;
  releaseState: "DRAFT" | "ACTIVE" | "RETIRED";
  manifest: Record<string, unknown>;
  manifestSha256: string;
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
}

function assertIdentifier(value: string): void {
  if (!/^[a-z0-9][a-z0-9._:-]{2,200}$/.test(value)) {
    throw new Error("retrieval index release identifier is invalid");
  }
}
