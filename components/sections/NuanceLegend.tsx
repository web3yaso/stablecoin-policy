import {
  IMPACT_TAG_LABEL,
  STABLECOIN_DIMENSIONS,
  type Dimension,
  type ImpactTag,
  type StablecoinTag,
} from "@/types";
import { DIMENSION_COLOR, DIMENSION_TAGS } from "@/lib/dimensions";
import {
  STABLECOIN_TAG_LABEL,
  STABLECOIN_DIMENSION_TAGS,
} from "@/lib/stablecoin-tags";

type DcAiDimension = Exclude<Dimension, "overall" | `sc-${string}`>;

interface LensSection {
  title: string;
  groups: { dimension: DcAiDimension; label: string }[];
}

const DC_AI_SECTIONS: LensSection[] = [
  {
    title: "Data Centers",
    groups: [
      { dimension: "environmental", label: "Environmental" },
      { dimension: "energy", label: "Energy & grid" },
      { dimension: "community", label: "Community" },
      { dimension: "land-use", label: "Land use" },
    ],
  },
  {
    title: "AI Regulation",
    groups: [
      { dimension: "ai-governance-dim", label: "Governance" },
      { dimension: "ai-consumer", label: "Consumer protection" },
      { dimension: "ai-workforce", label: "Workforce & employment" },
      { dimension: "ai-public", label: "Public services" },
      { dimension: "ai-synthetic", label: "Synthetic media" },
    ],
  },
];

const STABLECOIN_SECTIONS = [
  {
    dimension: "sc-issuance" as const,
    label: "Issuance",
    description: "谁可以发行，门槛是什么",
    // Categorical: show green/amber/red chips for the three issuance outcomes
    categoricalColors: {
      "non-bank-permitted": "#34C759",
      "bank-only": "#FF9500",
      "private-stablecoin-banned": "#FF3B30",
    } as Partial<Record<StablecoinTag, string>>,
  },
  {
    dimension: "sc-reserve" as const,
    label: "Reserve & Backing",
    description: "钱放在哪里，怎么证明",
    categoricalColors: {} as Partial<Record<StablecoinTag, string>>,
  },
  {
    dimension: "sc-consumer" as const,
    label: "Consumer Protection",
    description: "持有人有什么权利",
    categoricalColors: {} as Partial<Record<StablecoinTag, string>>,
  },
  {
    dimension: "sc-cross-border" as const,
    label: "Cross-Border",
    description: "外国发行人和外国稳定币的待遇",
    categoricalColors: {} as Partial<Record<StablecoinTag, string>>,
  },
  {
    dimension: "sc-sovereignty" as const,
    label: "Monetary Sovereignty",
    description: "政府对私人稳定币的态度",
    categoricalColors: {} as Partial<Record<StablecoinTag, string>>,
  },
];

function uniq(tags: ImpactTag[]): ImpactTag[] {
  const seen = new Set<ImpactTag>();
  const out: ImpactTag[] = [];
  for (const t of tags) {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

export default function NuanceLegend() {
  return (
    <div className="space-y-8">
      {/* ── Stablecoin taxonomy (primary) ── */}
      <div className="bg-card border border-black/[.06] rounded-3xl p-6">
        <h3 className="text-sm font-semibold text-ink tracking-tight mb-1">
          Stablecoin policy tags
        </h3>
        <p className="text-xs text-muted mb-6">
          Five regulatory dimensions. Jurisdiction-level tags drive map
          coloring; bill-level tags enable fine-grained filtering.
        </p>
        <div className="flex flex-col gap-8">
          {STABLECOIN_SECTIONS.map(({ dimension, label, description, categoricalColors }) => {
            const tags = STABLECOIN_DIMENSION_TAGS[dimension];
            const dotColor = DIMENSION_COLOR[dimension];
            return (
              <div key={dimension}>
                <div className="flex items-baseline gap-2 mb-0.5">
                  <div
                    className="w-2 h-2 rounded-full flex-shrink-0 mt-0.5"
                    style={{ backgroundColor: dotColor }}
                  />
                  <span className="text-[13px] font-medium text-ink tracking-tight">
                    {label}
                  </span>
                </div>
                <div className="text-[11px] text-muted mb-2 pl-4">
                  {description}
                </div>
                <div className="flex flex-wrap gap-1.5 pl-4">
                  {tags.map((tag) => {
                    const catColor = categoricalColors[tag];
                    return (
                      <span
                        key={tag}
                        className="text-[11px] px-2 py-0.5 rounded-full inline-flex items-center gap-1.5"
                        style={{
                          backgroundColor: catColor
                            ? `${catColor}22`
                            : "rgba(0,0,0,0.04)",
                          color: catColor ? catColor : "var(--color-muted)",
                        }}
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: catColor ?? dotColor }}
                        />
                        {STABLECOIN_TAG_LABEL[tag]}
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Map coloring note ── */}
      <div className="bg-black/[.02] border border-black/[.05] rounded-2xl px-5 py-4">
        <div className="text-[12px] font-medium text-ink tracking-tight mb-1.5">
          Issuance coloring — how the map works
        </div>
        <div className="flex flex-wrap gap-3 mb-2">
          {[
            { color: "#34C759", label: "Non-Bank Permitted" },
            { color: "#FF9500", label: "Bank Only" },
            { color: "#FF3B30", label: "Private Stablecoin Banned" },
            { color: "#8E8E93", label: "Unknown / In Progress" },
          ].map(({ color, label }) => (
            <span key={label} className="inline-flex items-center gap-1.5 text-[11px] text-muted">
              <span
                className="w-3 h-3 rounded-sm flex-shrink-0"
                style={{ backgroundColor: color }}
              />
              {label}
            </span>
          ))}
        </div>
        <p className="text-[11px] text-muted leading-relaxed">
          EU member states all inherit the EU-bloc color (MiCA is uniform
          across the single market). US states all inherit the US-federal
          color (federal law governs payment stablecoins).
        </p>
      </div>

      {/* ── Legacy DC / AI taxonomy ── */}
      <div className="bg-card border border-black/[.06] rounded-3xl p-6">
        <h3 className="text-sm font-semibold text-ink tracking-tight mb-1">
          Data center &amp; AI impact tags
        </h3>
        <p className="text-xs text-muted mb-6">
          Legacy tags grouped by lens and dimension.
        </p>
        <div className="flex flex-col gap-8">
          {DC_AI_SECTIONS.map((section) => (
            <div key={section.title}>
              <div className="text-sm font-semibold text-ink tracking-tight mb-4">
                {section.title}
              </div>
              <div className="flex flex-col gap-5">
                {section.groups.map(({ dimension, label }) => {
                  const tags = uniq(DIMENSION_TAGS[dimension]);
                  const dotColor = DIMENSION_COLOR[dimension];
                  return (
                    <div key={dimension}>
                      <div className="text-[13px] font-medium text-muted tracking-tight mb-2">
                        {label}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {tags.map((tag) => (
                          <span
                            key={tag}
                            className="text-[11px] bg-black/[.04] text-muted px-2 py-0.5 rounded-full inline-flex items-center gap-1.5"
                          >
                            <span
                              className="w-1.5 h-1.5 rounded-full"
                              style={{ backgroundColor: dotColor }}
                            />
                            {IMPACT_TAG_LABEL[tag]}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
