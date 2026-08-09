import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { RETIRED_ROUTES } from "../lib/retired-routes";
import { ENTITIES } from "../lib/policy-entities";

const ROOT = process.cwd();

test("legacy public routes have permanent homepage redirects", () => {
  assert.deepEqual(RETIRED_ROUTES, [
    { source: "/datacenters", destination: "/", permanent: true },
    { source: "/datacenters/:path*", destination: "/", permanent: true },
    { source: "/politicians", destination: "/", permanent: true },
    { source: "/politicians/:path*", destination: "/", permanent: true },
    { source: "/globe", destination: "/", permanent: true },
  ]);
});

test("retired route implementations and domain loaders are absent", () => {
  for (const path of [
    "app/datacenters/page.tsx",
    "app/datacenters/[id]/page.tsx",
    "app/politicians/page.tsx",
    "app/globe/page.tsx",
    "lib/datacenters.ts",
    "lib/energy-data.ts",
    "lib/politicians-data.ts",
    "lib/donor-data.ts",
    "data/donors/politicians.json",
    "data/politicians/us-enriched.json",
    "data/votes/federal.json",
    "scripts/sync/water-features.ts",
    "scripts/sync/votes-congress.ts",
  ]) {
    assert.equal(existsSync(join(ROOT, path)), false, `${path} should be absent`);
  }
});

test("runtime entities expose only Stablecoin legislation", () => {
  assert.ok(ENTITIES.length > 0);
  for (const entity of ENTITIES) {
    assert.equal("stanceAI" in entity, false);
    assert.equal("stanceDatacenter" in entity, false);
    assert.equal("keyFigures" in entity, false);
    for (const legislation of entity.legislation) {
      assert.match(legislation.category, /^stablecoin-/);
      assert.equal("impactTags" in legislation, false);
      assert.equal("voteTally" in legislation, false);
      assert.equal("relatedFacilityIds" in legislation, false);
    }
  }
});

test("international jurisdiction files contain no legacy product fields", () => {
  const directory = join(ROOT, "data/international");
  for (const filename of readdirSync(directory)) {
    if (!filename.endsWith(".json")) continue;
    const value = JSON.parse(readFileSync(join(directory, filename), "utf8")) as Record<
      string,
      unknown
    >;
    assert.equal("stanceAI" in value, false, filename);
    assert.equal("stanceDatacenter" in value, false, filename);
    assert.equal("keyFigures" in value, false, filename);
    assert.deepEqual(value.news, [], filename);
    assert.deepEqual(value.legislation, [], filename);
  }
});

test("retired UI packages are not declared", () => {
  const packageJson = JSON.parse(
    readFileSync(join(ROOT, "package.json"), "utf8"),
  ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const declared = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };
  for (const dependency of [
    "@number-flow/react",
    "cobe",
    "maplibre-gl",
    "react-grab",
    "topojson-client",
    "@types/topojson-client",
  ]) {
    assert.equal(dependency in declared, false, dependency);
  }
});
