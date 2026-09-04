import type { RetrievalIndexAdminClient } from "./index-admin";
import type { RetrievalCorpusKind } from "./index-builder";

/** Execute never replaces operator pins with a fresh lookup: exact retries must
 * reach the immutable operation ledger even after a replacement activates. */
export async function runSuspensionCommand(
  args: string[],
  admin: Pick<RetrievalIndexAdminClient, "inspectPointer" | "suspend">,
) {
  const values = new Map<string, string>();
  const allowed = new Set(["--domain", "--assurance-tier", "--operation-id", "--index-release",
    "--expected-manifest-sha256", "--expected-revision", "--reason"]);
  let execute = false;
  for (let i = 0; i < args.length; i++) {
    const name = args[i];
    if (name === "--execute") {
      if (execute) throw new Error("duplicate --execute");
      execute = true;
    } else {
      if (!allowed.has(name) || values.has(name)) throw new Error(`unknown or duplicate argument: ${name}`);
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
      values.set(name, value);
    }
  }
  const required = (name: string) => {
    const value = values.get(name);
    if (value === undefined) throw new Error(`${name} is required`);
    return value;
  };
  const domain = required("--domain");
  const tier = required("--assurance-tier");
  if (tier !== "PROVISIONAL" && tier !== "HUMAN_REVIEWED") throw new Error("invalid assurance tier");
  if (!execute) {
    return { mode: "DRY_RUN" as const, pointer: await admin.inspectPointer(domain, tier) };
  }
  return { mode: "EXECUTE" as const, result: await admin.suspend({
    policyDomain: domain, assuranceTier: tier as RetrievalCorpusKind,
    operationId: required("--operation-id"), indexReleaseId: required("--index-release"),
    expectedManifestSha256: required("--expected-manifest-sha256"),
    expectedRevision: required("--expected-revision"), reason: required("--reason"),
  }) };
}
