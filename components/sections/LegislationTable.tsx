"use client";

import { useMemo, useState } from "react";
import {
  CATEGORY_LABEL,
  IMPACT_TAG_LABEL,
  type Dimension,
  type Entity,
  type Legislation,
  type LegislationCategory,
  type ViewTarget,
} from "@/types";
import { ENTITIES } from "@/lib/placeholder-data";
import { DIMENSION_TAGS } from "@/lib/dimensions";
import BillTimeline from "@/components/ui/BillTimeline";

interface LegislationTableProps {
  dimension: Dimension;
  onNavigateToEntity: (target: ViewTarget) => void;
}

interface BillRow {
  bill: Legislation;
  entity: Entity;
  target: ViewTarget;
}

type CategoryFilter = LegislationCategory | "all";

const CATEGORY_FILTERS: CategoryFilter[] = [
  "all",
  "data-centers",
  "ai-regulation",
  "deepfakes",
  "healthcare",
  "govt-ai",
  "employment",
  "education",
  "privacy",
];

function buildRows(): BillRow[] {
  const rows: BillRow[] = [];
  for (const entity of ENTITIES) {
    const target: ViewTarget = {
      region: entity.region,
      naView: entity.level === "state" ? "states" : "countries",
      selectedGeoId: entity.isOverview ? null : entity.geoId,
    };
    for (const bill of entity.legislation) {
      rows.push({ bill, entity, target });
    }
  }
  return rows;
}

export default function LegislationTable({
  dimension,
  onNavigateToEntity,
}: LegislationTableProps) {
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>("all");

  const allRows = useMemo(() => buildRows(), []);

  const filtered = useMemo(() => {
    let rows = allRows;

    if (activeCategory !== "all") {
      rows = rows.filter((r) => r.bill.category === activeCategory);
    }

    if (dimension !== "overall") {
      const dimensionTags = new Set(DIMENSION_TAGS[dimension]);
      rows = rows.filter((r) =>
        r.bill.impactTags.some((t) => dimensionTags.has(t)),
      );
    }

    return [...rows].sort((a, b) =>
      b.bill.updatedDate.localeCompare(a.bill.updatedDate),
    );
  }, [allRows, activeCategory, dimension]);

  const billCount = filtered.length;
  const entityCount = new Set(filtered.map((r) => r.entity.id)).size;

  // Hide categories that have zero bills under the current dimension filter,
  // but always keep "all" visible.
  const dimensionFilteredRows = useMemo(() => {
    if (dimension === "overall") return allRows;
    const dimensionTags = new Set(DIMENSION_TAGS[dimension]);
    return allRows.filter((r) =>
      r.bill.impactTags.some((t) => dimensionTags.has(t)),
    );
  }, [allRows, dimension]);

  const visibleCategories = useMemo(() => {
    return CATEGORY_FILTERS.filter((c) => {
      if (c === "all") return true;
      return dimensionFilteredRows.some((r) => r.bill.category === c);
    });
  }, [dimensionFilteredRows]);

  return (
    <div>
      {/* Filter chip row + counts */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex flex-wrap gap-2">
          {visibleCategories.map((c) => {
            const active = c === activeCategory;
            return (
              <button
                key={c}
                type="button"
                onClick={() => setActiveCategory(c)}
                className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? "bg-ink text-white"
                    : "border border-black/[.06] text-muted hover:text-ink"
                }`}
              >
                {c === "all" ? "All" : CATEGORY_LABEL[c]}
              </button>
            );
          })}
        </div>
        <div className="text-xs text-muted whitespace-nowrap">
          <span className="font-semibold text-ink">{billCount}</span> bills ·{" "}
          <span className="font-semibold text-ink">{entityCount}</span> entities
        </div>
      </div>

      {/* Rows */}
      {filtered.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted">
          No bills match this filter.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map(({ bill, entity, target }) => (
            <button
              key={`${entity.id}-${bill.id}`}
              type="button"
              onClick={() => onNavigateToEntity(target)}
              className="w-full text-left bg-bg/60 hover:bg-bg rounded-2xl p-5 transition-colors"
            >
              <div className="flex items-baseline gap-3">
                <span className="text-xs text-muted">{bill.billCode}</span>
                <span className="text-xs text-muted ml-auto">
                  {entity.name}
                </span>
              </div>
              <div className="text-sm font-medium text-ink tracking-tight mt-1">
                {bill.title}
              </div>
              {bill.impactTags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {bill.impactTags.map((tag) => (
                    <span
                      key={tag}
                      className="text-[11px] bg-black/[.04] text-muted px-2 py-0.5 rounded-full"
                    >
                      {IMPACT_TAG_LABEL[tag]}
                    </span>
                  ))}
                </div>
              )}
              <BillTimeline stage={bill.stage} />
              <div className="text-[11px] text-muted mt-2 flex items-center gap-3">
                {bill.partyOrigin && (
                  <span>
                    {bill.partyOrigin === "B"
                      ? "Bipartisan"
                      : bill.partyOrigin === "D"
                        ? "Democrat"
                        : "Republican"}
                  </span>
                )}
                <span>Updated {bill.updatedDate}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
