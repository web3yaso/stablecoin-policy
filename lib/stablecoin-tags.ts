import type { Dimension, StablecoinTag } from "@/types";

/** English display labels for each StablecoinTag. */
export const STABLECOIN_TAG_LABEL: Record<StablecoinTag, string> = {
  // Issuance
  "bank-only": "Bank Only",
  "non-bank-permitted": "Non-Bank Permitted",
  "foreign-issuer-allowed": "Foreign Issuer Allowed",
  "licensing-required": "Licensing Required",
  "sandbox-available": "Sandbox Available",
  // Reserve & Backing
  "fiat-reserve-11": "1:1 Fiat Reserve",
  "asset-backed": "Asset-Backed",
  "algorithmic-banned": "Algorithmic Banned",
  "monthly-attestation": "Monthly Attestation",
  "rehypothecation-banned": "Rehypothecation Banned",
  // Consumer Protection
  "redemption-rights": "Redemption Rights",
  "yield-prohibited": "Yield Prohibited",
  "insolvency-priority": "Insolvency Priority",
  "disclosure-required": "Disclosure Required",
  "aml-kyc": "AML / KYC",
  // Cross-Border
  "equivalence-principle": "Equivalence Principle",
  "passporting": "Passporting",
  "foreign-stablecoin-banned": "Foreign Stablecoin Banned",
  "travel-rule": "Travel Rule",
  "local-entity-required": "Local Entity Required",
  // Monetary Sovereignty
  "cbdc-coexistence": "CBDC Coexistence",
  "usd-stablecoin-restricted": "USD Stablecoin Restricted",
  "capital-flow-controls": "Capital Flow Controls",
  "private-stablecoin-banned": "Private Stablecoin Banned",
};

/** Chinese display labels for each StablecoinTag. */
export const STABLECOIN_TAG_LABEL_ZH: Record<StablecoinTag, string> = {
  "bank-only": "仅银行发行",
  "non-bank-permitted": "允许非银行发行",
  "foreign-issuer-allowed": "外资发行商获准",
  "licensing-required": "须持牌发行",
  "sandbox-available": "沙盒机制可用",
  "fiat-reserve-11": "1:1 法币储备",
  "asset-backed": "资产支持",
  "algorithmic-banned": "禁止算法稳定币",
  "monthly-attestation": "月度储备证明",
  "rehypothecation-banned": "禁止再质押",
  "redemption-rights": "赎回权利",
  "yield-prohibited": "禁止付息",
  "insolvency-priority": "破产优先偿付",
  "disclosure-required": "信息披露义务",
  "aml-kyc": "反洗钱 / KYC",
  "equivalence-principle": "等效原则",
  "passporting": "通行证制度",
  "foreign-stablecoin-banned": "禁止境外稳定币",
  "travel-rule": "旅行规则",
  "local-entity-required": "须设本地实体",
  "cbdc-coexistence": "CBDC 共存",
  "usd-stablecoin-restricted": "美元稳定币受限",
  "capital-flow-controls": "资本流动管制",
  "private-stablecoin-banned": "禁止私人稳定币",
};

/** Which StablecoinTags belong to each stablecoin Dimension. */
export const STABLECOIN_DIMENSION_TAGS: Record<
  Extract<Dimension, `sc-${string}`>,
  StablecoinTag[]
> = {
  "sc-issuance": [
    "bank-only",
    "non-bank-permitted",
    "foreign-issuer-allowed",
    "licensing-required",
    "sandbox-available",
  ],
  "sc-reserve": [
    "fiat-reserve-11",
    "asset-backed",
    "algorithmic-banned",
    "monthly-attestation",
    "rehypothecation-banned",
  ],
  "sc-consumer": [
    "redemption-rights",
    "yield-prohibited",
    "insolvency-priority",
    "disclosure-required",
    "aml-kyc",
  ],
  "sc-cross-border": [
    "equivalence-principle",
    "passporting",
    "foreign-stablecoin-banned",
    "travel-rule",
    "local-entity-required",
  ],
  "sc-sovereignty": [
    "cbdc-coexistence",
    "usd-stablecoin-restricted",
    "capital-flow-controls",
    "private-stablecoin-banned",
  ],
};

/**
 * Categorical color for the sc-issuance dimension.
 * Priority: banned > bank-only > non-bank-permitted > unknown.
 */
export function getIssuanceColor(tags: StablecoinTag[], legalStatus?: string): string {
  if (tags.includes("private-stablecoin-banned")) return "#FF3B30";
  if (tags.includes("bank-only")) return "#FF9500";
  if (tags.includes("non-bank-permitted")) return "#34C759";
  // Tags take priority; fall back to legalStatus so countries with
  // different legal statuses aren't collapsed into the same gray.
  if (legalStatus === "banned") return "#FF3B30";
  if (legalStatus === "legal_with_restrictions" || legalStatus === "partially_legal") return "#FF9500";
  if (legalStatus === "legal") return "#34C759";
  return "#8E8E93";
}
