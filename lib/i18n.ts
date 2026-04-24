import type { Locale } from "@/contexts/LocaleContext";

const translations = {
  en: {
    // ── Header ────────────────────────────────────────────────────
    "nav.map": "Map",
    "nav.bills": "Bills",
    "nav.politicians": "Politicians",
    "nav.about": "About",
    "nav.toggle": "中文",

    // ── Legal status enums ────────────────────────────────────────
    "legal.legal": "Legal",
    "legal.legal_with_restrictions": "Legal with restrictions",
    "legal.banned": "Banned",
    "legal.partially_legal": "Partially legal",
    "legal.unclear": "Unclear",

    // ── Regime status enums ───────────────────────────────────────
    "regime.finalized": "In Force",
    "regime.pending_start": "Pending Implementation",
    "regime.in_progress": "Implementation in Progress",
    "regime.draft": "Draft / Proposed",
    "regime.none": "No Framework",

    // ── Classification enums ──────────────────────────────────────
    "class.payment_instrument": "Payment Instrument",
    "class.crypto_asset": "Crypto Asset",
    "class.e_money": "E-Money",
    "class.security": "Security",
    "class.unclear": "Unclear",

    // ── StablecoinInfo sections ───────────────────────────────────
    "section.legal_status": "Legal Status",
    "section.allowed_types": "Allowed Types",
    "section.regime_status": "Regime Status",
    "section.practitioner_qa": "Practitioner Q&A",

    // ── Allowed types ─────────────────────────────────────────────
    "allowed.fiat": "Fiat-backed",
    "allowed.algorithmic": "Algorithmic",
    "allowed.asset": "Asset-backed",

    // ── Regulatory clarity ────────────────────────────────────────
    "clarity.label": "Regulatory Clarity",
    "clarity.high": "Clear framework",
    "clarity.mid": "Framework exists",
    "clarity.low": "Framework unclear",

    // ── Practitioner Q&A fields ───────────────────────────────────
    "qa.canIssue": "Can we issue stablecoins here?",
    "qa.foreignStablecoin": "Are foreign stablecoins usable?",
    "qa.reserveRequirement": "Reserve requirements",
    "qa.algorithmicStatus": "Algorithmic stablecoins",
    "qa.yieldToHolders": "Can stablecoins pay yield to holders?",

    // ── Practitioner answer status ────────────────────────────────
    "status.ok": "Yes",
    "status.warn": "Conditional",
    "status.no": "No",

    // ── Tags (stored as English keys in JSON) ─────────────────────
    "tag.regime_finalized": "Framework in Force",
    "tag.regime_in_progress": "Framework in Progress",
    "tag.regime_draft": "Draft Stage",
    "tag.allows_fiat": "Fiat-pegged",
    "tag.no_algorithmic": "No Algorithmic",
    "tag.payment_instrument": "Payment Instrument",
    "tag.e_money": "E-Money",
    "tag.clarity_high": "Clear Rules",
    // ── Stablecoin taxonomy tags ───────────────────────────────────
    "tag.bank-only": "Bank Only",
    "tag.non-bank-permitted": "Non-Bank Permitted",
    "tag.foreign-issuer-allowed": "Foreign Issuer Allowed",
    "tag.licensing-required": "Licensing Required",
    "tag.sandbox-available": "Sandbox Available",
    "tag.fiat-reserve-11": "1:1 Fiat Reserve",
    "tag.asset-backed": "Asset-Backed",
    "tag.algorithmic-banned": "Algorithmic Banned",
    "tag.monthly-attestation": "Monthly Attestation",
    "tag.rehypothecation-banned": "Rehypothecation Banned",
    "tag.redemption-rights": "Redemption Rights",
    "tag.yield-prohibited": "Yield Prohibited",
    "tag.insolvency-priority": "Insolvency Priority",
    "tag.disclosure-required": "Disclosure Required",
    "tag.aml-kyc": "AML / KYC",
    "tag.equivalence-principle": "Equivalence Principle",
    "tag.passporting": "Passporting",
    "tag.foreign-stablecoin-banned": "Foreign Stablecoin Banned",
    "tag.travel-rule": "Travel Rule",
    "tag.local-entity-required": "Local Entity Required",
    "tag.cbdc-coexistence": "CBDC Coexistence",
    "tag.usd-stablecoin-restricted": "USD Stablecoin Restricted",
    "tag.capital-flow-controls": "Capital Flow Controls",
    "tag.private-stablecoin-banned": "Private Stablecoin Banned",

    // ── SidePanel ─────────────────────────────────────────────────
    "panel.last_updated": "Last updated",
    "panel.primary_regulator": "Primary Regulator",
    "panel.tab.bills": "Bills",
    "panel.tab.local": "Local",
    "panel.tab.figures": "Figures",
    "panel.tab.regulators": "Regulators",
    "panel.tab.news": "News",
    "panel.tab.centers": "Centers",
    "panel.tab.energy": "Energy",
    "panel.hint.title": "Click anywhere to explore",
    "panel.hint.body": "Click a country or map pin to open its detail.",
    "panel.hint.shortcuts": "Press",
    "panel.hint.shortcuts_end": "for keyboard shortcuts.",
    "panel.no_entity": "Select a region to see its policies",
    "panel.summary_lang_note": "(English)",

    // ── Hero ──────────────────────────────────────────────────────
    "hero.headline1": "Tracking stablecoin",
    "hero.headline2": "policy worldwide",
    "hero.scroll_hint": "Scroll to reveal the map",

    // ── Page sections ─────────────────────────────────────────────
    "page.s1.label": "01 · Latest developments",
    "page.s1.title": "What happened this week",
    "page.s2.label": "02 · The full record",
    "page.s2.title": "Every bill we're tracking",
    "page.s3.label": "03 · Who voted how",
    "page.s3.title": "Politicians",
    "page.s3.sub": "The legislators shaping stablecoin policy — and how their votes stack up against what they said they believed.",
    "page.s4.label": "04 · From the wire",
    "page.s4.title": "Live news",

    // ── Footer ────────────────────────────────────────────────────
    "footer.brand": "Track Stablecoin Policy",
    "footer.about": "About",
    "footer.methodology": "Methodology",
    "footer.contact": "Contact",
    "footer.built_by": "Built by",
  },

  zh: {
    // ── Header ────────────────────────────────────────────────────
    "nav.map": "地图",
    "nav.bills": "法案",
    "nav.politicians": "政要",
    "nav.about": "关于",
    "nav.toggle": "EN",

    // ── Legal status enums ────────────────────────────────────────
    "legal.legal": "合法",
    "legal.legal_with_restrictions": "有条件合法",
    "legal.banned": "禁止",
    "legal.partially_legal": "部分合法",
    "legal.unclear": "不明确",

    // ── Regime status enums ───────────────────────────────────────
    "regime.finalized": "已生效",
    "regime.pending_start": "待实施",
    "regime.in_progress": "实施中",
    "regime.draft": "草案阶段",
    "regime.none": "无框架",

    // ── Classification enums ──────────────────────────────────────
    "class.payment_instrument": "支付工具",
    "class.crypto_asset": "加密资产",
    "class.e_money": "电子货币",
    "class.security": "证券",
    "class.unclear": "不明确",

    // ── StablecoinInfo sections ───────────────────────────────────
    "section.legal_status": "法律状态",
    "section.allowed_types": "允许的类型",
    "section.regime_status": "监管状态",
    "section.practitioner_qa": "从业者速查",

    // ── Allowed types ─────────────────────────────────────────────
    "allowed.fiat": "法币挂钩型",
    "allowed.algorithmic": "算法型",
    "allowed.asset": "资产支持型",

    // ── Regulatory clarity ────────────────────────────────────────
    "clarity.label": "监管清晰度",
    "clarity.high": "监管框架清晰",
    "clarity.mid": "监管框架存在",
    "clarity.low": "监管框架不明确",

    // ── Practitioner Q&A fields ───────────────────────────────────
    "qa.canIssue": "可以发行稳定币吗？",
    "qa.foreignStablecoin": "境外稳定币可用吗？",
    "qa.reserveRequirement": "储备金要求",
    "qa.algorithmicStatus": "算法稳定币",
    "qa.yieldToHolders": "能向持有人支付收益吗？",

    // ── Practitioner answer status ────────────────────────────────
    "status.ok": "是",
    "status.warn": "有条件",
    "status.no": "否",

    // ── Tags ──────────────────────────────────────────────────────
    "tag.regime_finalized": "监管框架生效",
    "tag.regime_in_progress": "监管框架推进中",
    "tag.regime_draft": "草案阶段",
    "tag.allows_fiat": "法币挂钩",
    "tag.no_algorithmic": "禁止算法稳定币",
    "tag.payment_instrument": "支付工具",
    "tag.e_money": "电子货币",
    "tag.clarity_high": "规则清晰",
    // ── 稳定币分类标签 ─────────────────────────────────────────────
    "tag.bank-only": "仅银行可发行",
    "tag.non-bank-permitted": "非银行可发行",
    "tag.foreign-issuer-allowed": "允许境外发行",
    "tag.licensing-required": "须持牌经营",
    "tag.sandbox-available": "监管沙盒",
    "tag.fiat-reserve-11": "1:1 法币储备",
    "tag.asset-backed": "资产支撑",
    "tag.algorithmic-banned": "算法稳定币禁止",
    "tag.monthly-attestation": "月度审计证明",
    "tag.rehypothecation-banned": "禁止再质押",
    "tag.redemption-rights": "赎回权",
    "tag.yield-prohibited": "禁止付息",
    "tag.insolvency-priority": "破产优先受偿",
    "tag.disclosure-required": "信息披露要求",
    "tag.aml-kyc": "反洗钱 / KYC",
    "tag.equivalence-principle": "等效原则",
    "tag.passporting": "通行证制度",
    "tag.foreign-stablecoin-banned": "境外稳定币禁止",
    "tag.travel-rule": "旅行规则",
    "tag.local-entity-required": "须设本地实体",
    "tag.cbdc-coexistence": "与 CBDC 共存",
    "tag.usd-stablecoin-restricted": "美元稳定币受限",
    "tag.capital-flow-controls": "资本流动管制",
    "tag.private-stablecoin-banned": "私人稳定币禁止",

    // ── SidePanel ─────────────────────────────────────────────────
    "panel.last_updated": "最后更新",
    "panel.primary_regulator": "主要监管机构",
    "panel.tab.bills": "法案",
    "panel.tab.local": "地方",
    "panel.tab.figures": "人物",
    "panel.tab.regulators": "监管机构",
    "panel.tab.news": "新闻",
    "panel.tab.centers": "数据中心",
    "panel.tab.energy": "能源",
    "panel.hint.title": "点击任意位置探索",
    "panel.hint.body": "点击国家或地图标记查看详情。",
    "panel.hint.shortcuts": "按下",
    "panel.hint.shortcuts_end": "查看快捷键。",
    "panel.no_entity": "选择一个地区查看政策详情",
    "panel.summary_lang_note": "（英文）",

    // ── Hero ──────────────────────────────────────────────────────
    "hero.headline1": "追踪全球",
    "hero.headline2": "稳定币政策",
    "hero.scroll_hint": "向下滚动查看地图",

    // ── Page sections ─────────────────────────────────────────────
    "page.s1.label": "01 · 最新动态",
    "page.s1.title": "本周发生了什么",
    "page.s2.label": "02 · 完整记录",
    "page.s2.title": "我们追踪的每一项法案",
    "page.s3.label": "03 · 谁投了什么票",
    "page.s3.title": "政要人物",
    "page.s3.sub": "推动稳定币政策的立法者——以及他们的投票与公开立场是否一致。",
    "page.s4.label": "04 · 实时资讯",
    "page.s4.title": "实时新闻",

    // ── Footer ────────────────────────────────────────────────────
    "footer.brand": "稳定币政策追踪",
    "footer.about": "关于",
    "footer.methodology": "方法论",
    "footer.contact": "联系我们",
    "footer.built_by": "作者",
  },
} as const;

type TranslationKey = keyof (typeof translations)["en"];

export function t(locale: Locale, key: TranslationKey): string {
  return translations[locale][key] ?? translations["en"][key] ?? key;
}
