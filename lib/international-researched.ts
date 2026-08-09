import type { Entity } from "@/types";

import algeria from "@/data/international/algeria.json";
import argentina from "@/data/international/argentina.json";
import australia from "@/data/international/australia.json";
import austria from "@/data/international/austria.json";
import belgium from "@/data/international/belgium.json";
import brazil from "@/data/international/brazil.json";
import bulgaria from "@/data/international/bulgaria.json";
import china from "@/data/international/china.json";
import croatia from "@/data/international/croatia.json";
import cyprus from "@/data/international/cyprus.json";
import czechia from "@/data/international/czechia.json";
import denmark from "@/data/international/denmark.json";
import egypt from "@/data/international/egypt.json";
import estonia from "@/data/international/estonia.json";
import finland from "@/data/international/finland.json";
import france from "@/data/international/france.json";
import germany from "@/data/international/germany.json";
import greece from "@/data/international/greece.json";
import greenland from "@/data/international/greenland.json";
import hongKong from "@/data/international/hong-kong.json";
import hungary from "@/data/international/hungary.json";
import india from "@/data/international/india.json";
import indonesia from "@/data/international/indonesia.json";
import ireland from "@/data/international/ireland.json";
import italy from "@/data/international/italy.json";
import japan from "@/data/international/japan.json";
import latvia from "@/data/international/latvia.json";
import lithuania from "@/data/international/lithuania.json";
import malaysia from "@/data/international/malaysia.json";
import mexico from "@/data/international/mexico.json";
import netherlands from "@/data/international/netherlands.json";
import philippines from "@/data/international/philippines.json";
import russia from "@/data/international/russia.json";
import saudiArabia from "@/data/international/saudi-arabia.json";
import singapore from "@/data/international/singapore.json";
import southKorea from "@/data/international/south-korea.json";
import spain from "@/data/international/spain.json";
import switzerland from "@/data/international/switzerland.json";
import taiwan from "@/data/international/taiwan.json";
import thailand from "@/data/international/thailand.json";
import turkey from "@/data/international/turkey.json";
import unitedArabEmirates from "@/data/international/united-arab-emirates.json";
import unitedKingdom from "@/data/international/united-kingdom.json";

const modules = [
  algeria,
  argentina,
  australia,
  austria,
  belgium,
  brazil,
  bulgaria,
  china,
  croatia,
  cyprus,
  czechia,
  denmark,
  egypt,
  estonia,
  finland,
  france,
  germany,
  greece,
  greenland,
  hongKong,
  hungary,
  india,
  indonesia,
  ireland,
  italy,
  japan,
  latvia,
  lithuania,
  malaysia,
  mexico,
  netherlands,
  philippines,
  russia,
  saudiArabia,
  singapore,
  southKorea,
  spain,
  switzerland,
  taiwan,
  thailand,
  turkey,
  unitedArabEmirates,
  unitedKingdom,
];

/** Stablecoin-only jurisdiction records normalized during Phase 7. */
export const RESEARCHED_INTERNATIONAL = modules as unknown as Entity[];
