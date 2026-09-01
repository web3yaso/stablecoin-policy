import { readFile } from "node:fs/promises";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import {
  runContractReplayEval,
  type ContractReplayEvalCase,
  type ContractReplayEvalReport,
} from "../../lib/playbooks/contract-replay-eval";
import {
  buildCitelyConsumerFixtures,
  serializeCitelyConsumerFixture,
} from "../contracts/citely-consumer-fixtures";

const FIXTURE_DIRECTORY = path.join(
  process.cwd(), "contracts", "fixtures", "citely", "v1",
);

export async function buildContractReplayEvalReport(): Promise<ContractReplayEvalReport> {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  const validateRequest = ajv.compile(await readSchema(
    "playbook-package-create-request.schema.json",
  ));
  const validateResponse = ajv.compile(await readSchema(
    "playbook-package-response.schema.json",
  ));
  const fixtures = await buildCitelyConsumerFixtures();
  const cases: ContractReplayEvalCase[] = await Promise.all(fixtures.map(async (fixture) => {
    const assetId = fixture.request.profile.asset?.symbol.toLowerCase() ?? null;
    return {
      caseId: `contract-replay:${fixture.slug}`,
      scope: {
        jurisdictionCode: fixture.request.profile.targetJurisdiction,
        assetId,
        playbookId: fixture.request.playbookId,
      },
      committedRequestJson: await readFile(
        path.join(FIXTURE_DIRECTORY, `${fixture.slug}.request.json`), "utf8",
      ),
      committedResponseJson: await readFile(
        path.join(FIXTURE_DIRECTORY, `${fixture.slug}.response.json`), "utf8",
      ),
      replayedRequestJson: serializeCitelyConsumerFixture(fixture.request),
      replayedResponseJson: serializeCitelyConsumerFixture(fixture.response),
    };
  }));
  return runContractReplayEval(cases, {
    request: (value) => Boolean(validateRequest(value)),
    response: (value) => Boolean(validateResponse(value)),
  });
}

async function readSchema(name: string): Promise<object> {
  return JSON.parse(await readFile(
    path.join(process.cwd(), "contracts", "v1", name), "utf8",
  )) as object;
}

async function main(): Promise<void> {
  const report = await buildContractReplayEvalReport();
  console.log(JSON.stringify(report, null, 2));
  if (report.outcome !== "PASSED") {
    throw new Error("Phase 5 contract and replay eval gates failed");
  }
}

if (process.argv[1]?.endsWith("run-phase5-contract-replay.ts")) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
