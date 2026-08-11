import { chmod, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  assembleProductionEvalDataset,
  type ProductionEvalIndependentCheck,
  type ProductionEvalProposal,
} from "../../lib/retrieval/eval-dataset-assembly.js";

async function main() {
  const args = process.argv.slice(2);
  const proposalPath = await privateInputPath(readValue(args, "--proposal"));
  const checkPath = await privateInputPath(readValue(args, "--independent-check"));
  const proposal = JSON.parse(
    await readFile(proposalPath, "utf8"),
  ) as ProductionEvalProposal;
  const check = JSON.parse(
    await readFile(checkPath, "utf8"),
  ) as ProductionEvalIndependentCheck;
  const assembly = assembleProductionEvalDataset(proposal, check);
  const execute = args.includes("--execute");
  console.log(JSON.stringify({
    mode: execute ? "EXECUTE" : "DRY_RUN",
    datasetId: assembly.dataset.datasetId,
    datasetSha256: assembly.datasetSha256,
    sourceSnapshot: assembly.dataset.sourceSnapshot,
    generatorAgentId: assembly.dataset.generation.agentId,
    checkerAgentId: assembly.dataset.independentCheck.agentId,
    checklistTopicCount: assembly.dataset.requiredChecklistTopics.length,
    acceptedCaseCount: assembly.acceptedCaseCount,
    blockedCaseCount: assembly.blockedCaseCount,
  }, null, 2));
  if (!execute) {
    console.log("dry-run: no private dataset was written; pass --execute with the expected dataset SHA-256");
    return;
  }
  if (readValue(args, "--expected-dataset-sha256") !== assembly.datasetSha256) {
    throw new Error("expected dataset SHA-256 does not match the deterministic assembly");
  }
  const output = await privateOutputPath(readValue(args, "--output"));
  await writeFile(output, `${JSON.stringify(assembly.dataset)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  await chmod(output, 0o600);
  console.log(JSON.stringify({ output, datasetSha256: assembly.datasetSha256 }, null, 2));
}

async function privateOutputPath(value: string): Promise<string> {
  if (!path.isAbsolute(value)) throw new Error("eval dataset output must be absolute");
  const output = path.join(
    await realpath(path.dirname(path.resolve(value))),
    path.basename(value),
  );
  const relative = path.relative(await realpath(process.cwd()), output);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new Error("production eval datasets must be stored outside the repository");
  }
  return output;
}

async function privateInputPath(value: string): Promise<string> {
  if (!path.isAbsolute(value)) throw new Error("eval assembly inputs must be absolute");
  const input = await realpath(value);
  const relative = path.relative(await realpath(process.cwd()), input);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    throw new Error("eval assembly inputs must be stored outside the repository");
  }
  const metadata = await stat(input);
  if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) {
    throw new Error("eval assembly inputs must be files with mode 0600");
  }
  return input;
}

function readValue(args: string[], name: string): string {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (!value || value.startsWith("--")) throw new Error(`${name} is required`);
  return value;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
