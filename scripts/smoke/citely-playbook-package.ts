import { readFile } from "node:fs/promises";
import path from "node:path";
import { runCitelyPackageSmoke } from "../../lib/playbooks/citely-smoke";
import type { BusinessProfile } from "../../lib/playbooks/contracts";

type CreateRequest = {
  playbookId: string;
  profile: BusinessProfile;
};

async function main(): Promise<void> {
  const baseUrl = required("CITELY_SMOKE_BASE_URL");
  const keyId = required("CITELY_SERVICE_SIGNING_KEY_ID");
  const privateKeyPem = required("CITELY_SERVICE_PRIVATE_KEY_PEM");
  const [request, responseSchema] = await Promise.all([
    readJson<CreateRequest>(
      "contracts/fixtures/citely/v1/stablecoin-pre-listing-success.request.json",
    ),
    readJson<Record<string, unknown>>(
      "contracts/v1/playbook-package-response.schema.json",
    ),
  ]);
  const result = await runCitelyPackageSmoke({
    baseUrl,
    keyId,
    privateKeyPem,
    request,
    responseSchema,
  });
  console.log(JSON.stringify(result, null, 2));
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function readJson<T>(relativePath: string): Promise<T> {
  return JSON.parse(
    await readFile(path.join(process.cwd(), relativePath), "utf8"),
  ) as T;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
