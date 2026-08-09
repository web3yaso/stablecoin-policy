import type { Entity, Legislation, Region, StanceType } from "@/types";
import federal from "@/data/legislation/federal.json";
import arizona from "@/data/legislation/states/arizona.json";
import california from "@/data/legislation/states/california.json";
import colorado from "@/data/legislation/states/colorado.json";
import florida from "@/data/legislation/states/florida.json";
import illinois from "@/data/legislation/states/illinois.json";
import newJersey from "@/data/legislation/states/new-jersey.json";
import newYork from "@/data/legislation/states/new-york.json";
import texas from "@/data/legislation/states/texas.json";
import washington from "@/data/legislation/states/washington.json";
import wyoming from "@/data/legislation/states/wyoming.json";
import { INTERNATIONAL_ENTITIES } from "./international-entities";

interface JurisdictionFile {
  state: string;
  stateCode: string;
  stance?: string;
  contextBlurb: string;
  legislation: unknown[];
}

const stateFiles = [
  arizona,
  california,
  colorado,
  florida,
  illinois,
  newJersey,
  newYork,
  texas,
  washington,
  wyoming,
] as JurisdictionFile[];

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function fromJurisdictionFile(
  source: JurisdictionFile,
  level: "federal" | "state",
): Entity {
  return {
    id: level === "federal" ? "us-federal" : slugify(source.state),
    geoId: level === "federal" ? "840" : source.state,
    name: source.state,
    region: "na",
    level,
    isOverview: level === "federal",
    canDrillDown: level === "federal",
    stance: (source.stance ?? "none") as StanceType,
    contextBlurb: source.contextBlurb,
    legislation: source.legislation as Legislation[],
    news: [],
  };
}

const CANADA: Entity = {
  id: "canada-federal",
  geoId: "124",
  name: "Canada",
  region: "na",
  level: "federal",
  stance: "review",
  contextBlurb:
    "Canada has no dedicated federal stablecoin statute. Registered crypto trading platforms must follow securities-regulator conditions for value-referenced crypto assets, including reserve, custody, disclosure, and listing controls.",
  legislation: [],
  news: [],
};

export const ENTITIES: Entity[] = [
  fromJurisdictionFile(federal as JurisdictionFile, "federal"),
  CANADA,
  ...stateFiles.map((source) => fromJurisdictionFile(source, "state")),
  ...INTERNATIONAL_ENTITIES,
];

export function getEntity(geoId: string, region: Region): Entity | null {
  return (
    ENTITIES.find(
      (entity) => entity.geoId === geoId && entity.region === region,
    ) ?? null
  );
}
