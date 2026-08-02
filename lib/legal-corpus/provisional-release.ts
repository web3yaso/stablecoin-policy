import type { SupabaseHttpClient } from "../data/supabase-client";

/**
 * Provisional corpus releases publish AI_CROSS_CHECKED evidence through an
 * explicit atomic service RPC (migration 0021). They live in tables that are
 * physically separate from the reviewed release workflow: publishing a
 * provisional release never touches claim review_state, reviewed releases,
 * or coverage.
 */

export type ProvisionalReleaseInput = {
  releaseId: string;
  jurisdictionCode: string;
  asOf: string;
  knowledgeCutoff: string;
  claimIds: string[];
};

export type ProvisionalReleaseResult = {
  releaseId: string;
  jurisdictionCode: string;
  manifestSha256: string;
  claimCount: number;
  publishedAt: string;
};

const ID = /^[a-z0-9][a-z0-9._:-]{2,160}$/;
const JURISDICTION = /^[A-Z][A-Z0-9-]{1,15}$/;

export function provisionalReleaseInputErrors(
  input: ProvisionalReleaseInput,
): string[] {
  const errors: string[] = [];
  if (!ID.test(input.releaseId)) errors.push("identifier_invalid");
  if (!JURISDICTION.test(input.jurisdictionCode)) errors.push("jurisdiction_invalid");
  if (input.claimIds.length === 0) errors.push("membership_empty");
  if (input.claimIds.some((claimId) => !ID.test(claimId))) {
    errors.push("identifier_invalid");
  }
  if (new Set(input.claimIds).size !== input.claimIds.length) {
    errors.push("membership_duplicate");
  }
  for (const timestamp of [input.asOf, input.knowledgeCutoff]) {
    if (!Number.isFinite(Date.parse(timestamp))) {
      errors.push("timestamp_invalid");
      break;
    }
  }
  return [...new Set(errors)];
}

export class ProvisionalReleaseClient {
  constructor(private readonly client: SupabaseHttpClient) {}

  async publish(
    input: ProvisionalReleaseInput,
  ): Promise<ProvisionalReleaseResult> {
    const errors = provisionalReleaseInputErrors(input);
    if (errors.length > 0) {
      throw new Error(`provisional release invalid: ${errors.join(", ")}`);
    }
    return this.client.rpc<ProvisionalReleaseResult>(
      "publish_provisional_release",
      {
        p_release_id: input.releaseId,
        p_jurisdiction_code: input.jurisdictionCode,
        p_as_of: input.asOf,
        p_knowledge_cutoff: input.knowledgeCutoff,
        p_claim_ids: [...input.claimIds].sort(),
      },
    );
  }
}
