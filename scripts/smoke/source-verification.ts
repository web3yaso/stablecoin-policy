import "../env.js";
import { randomUUID } from "node:crypto";
import { readSupabaseConfig, SupabaseHttpClient } from "../../lib/data/supabase-client.js";
import { SourceVerificationClient } from "../../lib/legal-corpus/verification.js";

async function main() {
  const versionId = requiredValue(process.argv.slice(2), "--source-version");
  const client = new SupabaseHttpClient(readSupabaseConfig());
  const verifier = new SourceVerificationClient(client);
  const before = await verifier.prepare(versionId);
  if (before.lifecycleState !== "OBSERVED" || before.verifiedAt !== null) {
    throw new Error("negative smoke requires an unverified OBSERVED source version");
  }

  const invalidSha256 = `${before.manifestSha256.slice(0, 63)}${
    before.manifestSha256.endsWith("0") ? "1" : "0"
  }`;
  let rejected = false;
  try {
    await client.rpc("review_official_source_version", {
      p_verification_id: `verification:negative-smoke:${randomUUID()}`,
      p_version_id: versionId,
      p_outcome: "APPROVED",
      p_verification_method: "OFFICIAL_BYTE_AND_LOCATOR_REVIEW",
      p_reviewer_role: "Automated negative-path smoke",
      p_reviewer_ref: "reviewer:negative-smoke",
      p_manifest_sha256: invalidSha256,
      p_reviewed_at: new Date().toISOString(),
      p_private_notes: null,
    });
  } catch (error: unknown) {
    rejected = error instanceof Error && /manifest checksum mismatch/.test(error.message);
    if (!rejected) throw error;
  }
  if (!rejected) throw new Error("database accepted a stale verification manifest");

  const after = await verifier.prepare(versionId);
  if (
    after.lifecycleState !== "OBSERVED"
    || after.verifiedAt !== null
    || after.manifestSha256 !== before.manifestSha256
  ) {
    throw new Error("failed verification attempt changed source state");
  }
  console.log(JSON.stringify({
    versionId,
    staleManifestRejected: true,
    lifecycleState: after.lifecycleState,
    verifiedAt: after.verifiedAt,
    manifestSha256: after.manifestSha256,
  }));
}

function requiredValue(args: string[], name: string): string {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
