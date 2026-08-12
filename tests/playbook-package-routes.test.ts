import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET } from "../app/v1/playbook-packages/[id]/route";
import { POST } from "../app/v1/playbook-packages/route";

const API_KEY = "route-test-api-key";

test("package creation rejects a missing idempotency key before external IO", async () => {
  await withApiKey(async () => {
    const response = await POST(new NextRequest("https://example.test/v1/playbook-packages", {
      method: "POST",
      headers: {
        authorization: `Bearer ${API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        playbookId: "business-model-regulatory-boundary",
        profile: {
          operatorJurisdiction: "SG",
          targetJurisdiction: "EEA",
          activities: ["issue-emt"],
          asset: null,
        },
      }),
    }));

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid-idempotency-key" });
    assert.equal(response.headers.get("cache-control"), "no-store");
  });
});

test("package creation rejects fields outside the committed request contract", async () => {
  await withApiKey(async () => {
    const response = await POST(new NextRequest("https://example.test/v1/playbook-packages", {
      method: "POST",
      headers: {
        authorization: `Bearer ${API_KEY}`,
        "content-type": "application/json",
        "idempotency-key": "route-contract-test-0001",
      },
      body: JSON.stringify({
        playbookId: "business-model-regulatory-boundary",
        profile: {
          operatorJurisdiction: "SG",
          targetJurisdiction: "EEA",
          activities: ["issue-emt"],
          asset: null,
          customerEmail: "must-not-cross-boundary@example.test",
        },
      }),
    }));

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid-profile" });
  });
});

test("package replay rejects malformed identifiers before external IO", async () => {
  await withApiKey(async () => {
    const response = await GET(
      new NextRequest("https://example.test/v1/playbook-packages/not-a-package", {
        headers: { authorization: `Bearer ${API_KEY}` },
      }),
      { params: Promise.resolve({ id: "not-a-package" }) },
    );

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "playbook-package-not-found" });
    assert.equal(response.headers.get("cache-control"), "no-store");
  });
});

async function withApiKey(run: () => Promise<void>) {
  const previous = process.env.PLAYBOOK_API_KEY;
  process.env.PLAYBOOK_API_KEY = API_KEY;
  try {
    await run();
  } finally {
    if (previous === undefined) delete process.env.PLAYBOOK_API_KEY;
    else process.env.PLAYBOOK_API_KEY = previous;
  }
}
