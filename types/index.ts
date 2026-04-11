export type Region = "na" | "eu" | "asia";

/** Sub-view inside the NA region: country-level vs US-states drill-down. */
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
  | "none";

export type GovLevel = "federal" | "state" | "bloc";

export type ImpactTag =
  | "grid-strain"
  | "rate-hikes"
  | "water"
  | "national-park"
  | "noise"
  | "emissions"
  | "renewable-mandate"
  | "local-control"
  | "agricultural-land"
  | "job-creation"
  | "tax-exemption"
  | "zoning"
  | "environmental-study";

export type LegislationCategory =
  | "data-centers"
  | "ai-regulation"
  | "deepfakes"
  | "healthcare"
  | "govt-ai"
  | "employment"
  | "education"
  | "privacy";

export type Dimension =
  | "overall"
  | "environmental"
  | "energy"
  | "community"
  | "land-use";

export const IMPACT_TAG_LABEL: Record<ImpactTag, string> = {
  "grid-strain": "Grid Strain",
  "rate-hikes": "Rate Hikes",
  water: "Water Use",
  "national-park": "National Park",
  noise: "Noise",
  emissions: "Emissions",
  "renewable-mandate": "Renewable Mandate",
  "local-control": "Local Control",
  "agricultural-land": "Agricultural Land",
  "job-creation": "Job Creation",
  "tax-exemption": "Tax Exemption",
  zoning: "Zoning",
  "environmental-study": "Environmental Study",
};

export const CATEGORY_LABEL: Record<LegislationCategory, string> = {
  "data-centers": "Data Centers",
  "ai-regulation": "AI Regulation",
  deepfakes: "Deepfakes",
  healthcare: "Healthcare",
  "govt-ai": "Gov't AI",
  employment: "Employment",
  education: "Education",
  privacy: "Privacy",
};

export const DIMENSION_LABEL: Record<Dimension, string> = {
  overall: "Overall stance",
  environmental: "Environmental impact",
  energy: "Energy & grid",
  community: "Community impact",
  "land-use": "Land use",
};

export interface Legislation {
  id: string;
  billCode: string;
  title: string;
  summary: string;
  stage: Stage;
  impactTags: ImpactTag[];
  category: LegislationCategory;
  updatedDate: string;
  partyOrigin?: "R" | "D" | "B";
  sourceUrl?: string;
}

export interface Legislator {
  id: string;
  name: string;
  role: string;
  party: string;
  stance: StanceType;
  quote?: string;
}

export interface NewsItem {
  id: string;
  headline: string;
  source: string;
  date: string;
  url: string;
}

export interface Entity {
  id: string;
  geoId: string;
  name: string;
  region: Region;
  level: GovLevel;
  /** True for the regional overview entity (one per region). */
  isOverview?: boolean;
  /** True if this entity has a state-level drill-down (currently only US). */
  canDrillDown?: boolean;
  stance: StanceType;
  contextBlurb: string;
  legislation: Legislation[];
  keyFigures: Legislator[];
  news: NewsItem[];
}

export const REGION_LABEL: Record<Region, string> = {
  na: "North America",
  eu: "European Union",
  asia: "Asia",
};

export const REGION_ORDER: Region[] = ["na", "eu", "asia"];
