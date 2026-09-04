// Deliberately no dotenv loading: the signing key belongs to the Citely host.
import { runEvidenceSmokeCommand } from "../../lib/retrieval/smoke-command";

void runEvidenceSmokeCommand(process.argv.slice(2), process.env)
  .then(result => console.log(JSON.stringify(result, null, 2)))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "evidence smoke failed");
    process.exitCode = 1;
  });
