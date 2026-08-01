import "../env.js";
import { readSupabaseConfig, SupabaseHttpClient } from "../../lib/data/supabase-client.js";

async function main() {
  const client = new SupabaseHttpClient(readSupabaseConfig());
  let directInsertDenied = false;
  try {
    await client.rest("corpus_releases", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        release_id: "corpus:negative-smoke:direct",
        as_of: "2026-07-31T00:00:00.000Z",
        knowledge_cutoff: "2026-08-01T00:00:00.000Z",
        manifest_checksum_sha256: "0".repeat(64),
        release_state: "DRAFT",
      }),
    });
  } catch (error: unknown) {
    directInsertDenied = error instanceof Error && /permission denied|42501/i.test(error.message);
    if (!directInsertDenied) throw error;
  }
  if (!directInsertDenied) throw new Error("service role directly inserted a corpus release");

  let invalidCreateRejected = false;
  try {
    await client.rpc("create_corpus_release", {
      p_release_id: "INVALID",
      p_as_of: "2026-07-31T00:00:00.000Z",
      p_knowledge_cutoff: "2026-08-01T00:00:00.000Z",
    });
  } catch (error: unknown) {
    invalidCreateRejected = error instanceof Error && /invalid corpus release id/i.test(error.message);
    if (!invalidCreateRejected) throw error;
  }
  if (!invalidCreateRejected) throw new Error("invalid corpus release ID was accepted");

  console.log(JSON.stringify({ directInsertDenied, invalidCreateRejected }));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
