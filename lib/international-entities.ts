import type { Entity } from "@/types";
import { RESEARCHED_INTERNATIONAL } from "./international-researched";

const EU_BLOC: Entity = {
  id: "eu-bloc",
  geoId: "eu-bloc",
  name: "European Union",
  region: "eu",
  level: "bloc",
  isOverview: true,
  stance: "pioneering",
  contextBlurb:
    "The EU Markets in Crypto-Assets Regulation (MiCA) establishes a common regime for asset-referenced and e-money tokens. Stablecoin issuers face authorization, reserve, redemption, disclosure, governance, and supervision requirements across the EEA.",
  legislation: [
    {
      id: "eu-mica",
      billCode: "Reg. (EU) 2023/1114",
      title: "Markets in Crypto-Assets Regulation (MiCA)",
      summary:
        "MiCA creates the EU authorization and operating framework for asset-referenced tokens and e-money tokens, including reserve, redemption, governance, and significant-token supervision requirements.",
      stage: "Enacted",
      stance: "pioneering",
      category: "stablecoin-regulation",
      updatedDate: "2024-12-30",
      sourceUrl:
        "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32023R1114",
    },
  ],
  news: [],
  stablecoinMeta: {
    code: "EU",
    nameZh: "欧盟",
    lastUpdated: "2024-12-30",
    tags: [
      "licensing-required",
      "non-bank-permitted",
      "fiat-reserve-11",
      "redemption-rights",
      "passporting",
      "algorithmic-banned",
    ],
    legalStatus: "legal_with_restrictions",
    regulatoryClarity: 5,
    regimeStatus: "finalized",
    classification: "crypto_asset",
    allowsFiatBacked: true,
    allowsAlgorithmic: false,
    allowsAssetBacked: true,
  },
};

export const INTERNATIONAL_ENTITIES: Entity[] = [
  EU_BLOC,
  ...RESEARCHED_INTERNATIONAL.filter((entity) => entity.id !== EU_BLOC.id),
];
