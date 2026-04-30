import type { Entity, ImpactTag, Legislation } from "@/types";

import argentina from "@/data/international/argentina.json";
import australia from "@/data/international/australia.json";
import brazil from "@/data/international/brazil.json";
import canada from "@/data/international/canada.json";
import china from "@/data/international/china.json";
import croatia from "@/data/international/croatia.json";
import france from "@/data/international/france.json";
import germany from "@/data/international/germany.json";
import hongKong from "@/data/international/hong-kong.json";
import india from "@/data/international/india.json";
import ireland from "@/data/international/ireland.json";
import italy from "@/data/international/italy.json";
import japan from "@/data/international/japan.json";
import netherlands from "@/data/international/netherlands.json";
import russia from "@/data/international/russia.json";
import saudiArabia from "@/data/international/saudi-arabia.json";
import singapore from "@/data/international/singapore.json";
import southKorea from "@/data/international/south-korea.json";
import spain from "@/data/international/spain.json";
import switzerland from "@/data/international/switzerland.json";
import turkey from "@/data/international/turkey.json";
import unitedArabEmirates from "@/data/international/united-arab-emirates.json";
import unitedKingdom from "@/data/international/united-kingdom.json";
import unitedStates from "@/data/international/united-states.json";
import indonesia from "@/data/international/indonesia.json";
import thailand from "@/data/international/thailand.json";
import philippines from "@/data/international/philippines.json";
import malaysia from "@/data/international/malaysia.json";
import mexico from "@/data/international/mexico.json";
import taiwan from "@/data/international/taiwan.json";

const VALID_IMPACT_TAGS = new Set<ImpactTag>([
  "water-consumption",
  "carbon-emissions",
  "protected-land",
  "environmental-review",
  "renewable-energy",
  "grid-capacity",
  "energy-rates",
  "water-infrastructure",
  "noise-vibration",
  "local-zoning",
  "local-control",
  "residential-proximity",
  "property-values",
  "tax-incentives",
  "job-creation",
  "economic-development",
  "nda-transparency",
  "algorithmic-transparency",
  "ai-safety",
  "deepfake-regulation",
  "ai-in-healthcare",
  "ai-in-employment",
  "ai-in-education",
  "child-safety",
  "data-privacy",
]);

function sanitizeLegislation(l: Legislation): Legislation {
  return {
    ...l,
    impactTags: (l.impactTags ?? []).filter((t): t is ImpactTag =>
      VALID_IMPACT_TAGS.has(t as ImpactTag),
    ),
  };
}

function sanitizeEntity(e: Entity): Entity {
  return {
    ...e,
    legislation: (e.legislation ?? []).map(sanitizeLegislation),
    keyFigures: e.keyFigures ?? [],
    news: e.news ?? [],
  };
}

const modules: Entity[] = [];
function register(mod: unknown) {
  if (mod && typeof mod === "object" && "id" in (mod as Record<string, unknown>)) {
    modules.push(sanitizeEntity(mod as Entity));
  }
}

register(argentina);
register(australia);
register(brazil);
register(canada);
register(china);
register(croatia);
register(france);
register(germany);
register(hongKong);
register(india);
register(ireland);
register(italy);
register(japan);
register(netherlands);
register(russia);
register(saudiArabia);
register(singapore);
register(southKorea);
register(spain);
register(switzerland);
register(turkey);
register(unitedArabEmirates);
register(unitedKingdom);
register(unitedStates);
register(indonesia);
register(thailand);
register(philippines);
register(malaysia);
register(mexico);
register(taiwan);

export const RESEARCHED_INTERNATIONAL: Entity[] = modules;
