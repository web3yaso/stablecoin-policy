import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROOT = process.cwd();

async function source(path: string): Promise<string> {
  return readFile(`${ROOT}/${path}`, "utf8");
}

test("homepage exposes the machine-readable Agent purchase guide", async () => {
  const [homepage, translations] = await Promise.all([
    source("app/page.tsx"),
    source("lib/i18n.ts"),
  ]);

  assert.match(homepage, /href="\/\.well-known\/x402-skill\.md"/);
  assert.match(homepage, /rel="help"/);
  assert.match(homepage, /footer\.agent_purchase/);
  assert.match(translations, /"footer\.agent_purchase": "Agent purchase guide"/);
  assert.match(translations, /"footer\.agent_purchase": "Agent 购买指南"/);
});

test("Agent discovery documents describe the production x402 purchase flow", async () => {
  const [skill, llms] = await Promise.all([
    source("public/.well-known/x402-skill.md"),
    source("public/llms.txt"),
  ]);

  for (const document of [skill, llms]) {
    assert.match(document, /https:\/\/policy\.citely\.info\/api\/reports/);
    assert.match(document, /https:\/\/policy\.citely\.info\/\.well-known\/x402/);
    assert.doesNotMatch(document, /stablecoin-policy\.vercel\.app/);
    assert.doesNotMatch(document, /Base Sepolia/);
  }
  assert.match(skill, /PAYMENT-REQUIRED/);
  assert.match(skill, /PAYMENT-SIGNATURE/);
  assert.match(skill, /Do not hardcode the network, asset, amount, or recipient/);
  assert.match(skill, /GET https:\/\/policy\.citely\.info\/api\/reports/);
  assert.match(skill, /HTTP 402/);
  assert.match(skill, /HTTP 200/);
});
