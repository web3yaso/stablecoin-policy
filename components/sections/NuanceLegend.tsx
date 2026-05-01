import { type StablecoinTag } from "@/types";
import { DIMENSION_COLOR } from "@/lib/dimensions";
import {
  STABLECOIN_TAG_LABEL,
  STABLECOIN_DIMENSION_TAGS,
} from "@/lib/stablecoin-tags";

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

    </div>
  );
}
