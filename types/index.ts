export type Region = "na" | "eu" | "asia" | "latam" | "africa" | "oceania";

export type NaView = "countries" | "states";

export interface ViewTarget {
  region: Region;
  naView: NaView;
  selectedGeoId: string | null;
}

export type Stage =
  | "Filed"
  | "Committee"
  | "Floor"
  | "Enacted"
  | "Carried Over"
  | "Dead";

export type StanceType =
  | "restrictive"
  | "review"
  | "favorable"
  | "concerning"
  | "none"
  | "pioneering";

export const STANCE_LABEL: Record<StanceType, string> = {
  restrictive: "Restricted",
  concerning: "Regulatory process",
  review: "Framework developing",
  none: "No dedicated framework",
  favorable: "Permitted",
  pioneering: "Dedicated legislation",
};

export type GovLevel = "federal" | "state" | "bloc";

export type StablecoinTag =
  | "bank-only"
  | "non-bank-permitted"
  | "foreign-issuer-allowed"
  | "licensing-required"
  | "sandbox-available"
  | "fiat-reserve-11"
  | "asset-backed"
  | "algorithmic-banned"
  | "monthly-attestation"
  | "rehypothecation-banned"
  | "redemption-rights"
  | "yield-prohibited"
  | "insolvency-priority"
  | "disclosure-required"
  | "aml-kyc"
  | "equivalence-principle"
  | "passporting"
  | "foreign-stablecoin-banned"
  | "travel-rule"
  | "local-entity-required"
  | "cbdc-coexistence"
  | "usd-stablecoin-restricted"
  | "capital-flow-controls"
  | "private-stablecoin-banned";

export type LegislationCategory =
  | "stablecoin-policy"
  | "stablecoin-regulation";

export type Dimension =
  | "overall"
  | "sc-issuance"
  | "sc-reserve"
  | "sc-consumer"
  | "sc-cross-border"
  | "sc-sovereignty";

export const STABLECOIN_DIMENSIONS: Exclude<Dimension, "overall">[] = [
  "sc-issuance",
  "sc-reserve",
  "sc-consumer",
  "sc-cross-border",
  "sc-sovereignty",
];

export const DIMENSION_LABEL: Record<Dimension, string> = {
  overall: "Overall status",
  "sc-issuance": "Issuance",
  "sc-reserve": "Reserve & backing",
  "sc-consumer": "Consumer protection",
  "sc-cross-border": "Cross-border",
  "sc-sovereignty": "Monetary sovereignty",
};

export interface Legislation {
  id: string;
  billCode: string;
  title: string;
  summary: string;
  stage: Stage;
  stance?: StanceType;
  stablecoinTags?: StablecoinTag[];
  category: LegislationCategory;
  updatedDate: string;
  sourceUrl?: string;
  legiscanUrl?: string;
  legiscanId?: number;
}

export interface NewsItem {
  id: string;
  headline: string;
  source: string;
  date: string;
  url: string;
  summary?: string;
  summarySource?: "article" | "headline-only";
  sourceId?: string;
  sourceType?: "official-api" | "official-feed";
  sourceAuthority?: string;
  officialDocumentId?: string;
  sourceVersion?: string;
  documentType?: string;
  officialPdfUrl?: string;
  commentCloseDate?: string;
  openForComment?: boolean;
  retrievedAt?: string;
  relatedDocumentIds?: string[];
}

export type LegalStatusEnum =
  | "legal"
  | "legal_with_restrictions"
  | "banned"
  | "partially_legal"
  | "unclear";

export type RegimeStatusEnum =
  | "finalized"
  | "pending_start"
  | "in_progress"
  | "draft"
  | "none";

export type ClassificationEnum =
  | "payment_instrument"
  | "crypto_asset"
  | "e_money"
  | "security"
  | "unclear";

export type PractitionerStatus = "ok" | "warn" | "no";

export interface PractitionerQA {
  text: string;
  note?: string;
  status: PractitionerStatus;
}

export type RegulatorStance = "favorable" | "cautious" | "restrictive" | "neutral";

export interface Regulator {
  id: string;
  name: string;
  acronym?: string;
  role: string;
  websiteUrl?: string;
  isPrimary: boolean;
  headName?: string;
  headTitle?: string;
  headStance?: RegulatorStance;
  headQuote?: string;
  headQuoteUrl?: string;
}

export interface StablecoinMeta {
  code?: string;
  nameZh?: string;
  flagImg?: string;
  lastUpdated?: string;
  summaryEn?: string;
  tags?: StablecoinTag[];
  legalStatus: LegalStatusEnum;
  regulatoryClarity: number;
  regimeStatus: RegimeStatusEnum;
  classification?: ClassificationEnum;
  classificationNote?: string;
  allowsFiatBacked: boolean;
  allowsAlgorithmic: boolean;
  allowsAssetBacked: boolean | "partial";
  allowsAssetBackedNote?: string;
  canIssue?: PractitionerQA;
  foreignStablecoin?: PractitionerQA;
  reserveRequirement?: PractitionerQA;
  algorithmicStatus?: PractitionerQA;
  yieldToHolders?: PractitionerQA;
  regulators?: Regulator[];
}

export interface Entity {
  id: string;
  geoId: string;
  name: string;
  region: Region;
  level: GovLevel;
  stablecoinMeta?: StablecoinMeta;
  isOverview?: boolean;
  canDrillDown?: boolean;
  stance?: StanceType;
  contextBlurb: string;
  legislation: Legislation[];
  news: NewsItem[];
}

export const REGION_LABEL: Record<Region, string> = {
  na: "Americas",
  latam: "Americas",
  eu: "Europe",
  asia: "Asia-Pacific",
  africa: "Africa",
  oceania: "Asia-Pacific",
};

export const REGION_ORDER: Region[] = ["na", "eu", "asia", "africa"];
