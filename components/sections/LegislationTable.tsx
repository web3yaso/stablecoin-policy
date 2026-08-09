"use client";

import { useMemo, useState } from "react";
import { ENTITIES } from "@/lib/policy-entities";
import type { Dimension, Legislation, ViewTarget } from "@/types";
import StagePill from "@/components/ui/StagePill";

interface LegislationRow {
  bill: Legislation;
  entityId: string;
  entityName: string;
  geoId: string;
  region: ViewTarget["region"];
}

interface LegislationTableProps {
  dimension?: Dimension;
  onNavigateToEntity?: (target: ViewTarget) => void;
  showAll?: boolean;
}

export default function LegislationTable({
  onNavigateToEntity,
  showAll = false,
}: LegislationTableProps) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(showAll);
  const rows = useMemo<LegislationRow[]>(
    () =>
      ENTITIES.flatMap((entity) =>
        entity.legislation.map((bill) => ({
          bill,
          entityId: entity.id,
          entityName: entity.name,
          geoId: entity.geoId,
          region: entity.region,
        })),
      ).sort((left, right) =>
        (right.bill.updatedDate ?? "").localeCompare(
          left.bill.updatedDate ?? "",
        ),
      ),
    [],
  );

  const filtered = rows.filter(({ bill, entityName }) => {
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return `${bill.billCode} ${bill.title} ${bill.summary} ${entityName}`
      .toLowerCase()
      .includes(needle);
  });
  const visible = expanded ? filtered : filtered.slice(0, 12);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search Stablecoin rules"
          className="w-full max-w-sm rounded-full border border-black/[.08] bg-white px-4 py-2 text-sm text-ink outline-none focus:border-black/20"
        />
        <div className="text-xs text-muted">{filtered.length} records</div>
      </div>

      <div className="divide-y divide-black/[.06] overflow-hidden rounded-2xl border border-black/[.06] bg-white">
        {visible.map(({ bill, entityId, entityName, geoId, region }) => (
          <article key={`${entityId}:${bill.id}`} className="p-4 md:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() =>
                    onNavigateToEntity?.({
                      region,
                      naView: "countries",
                      selectedGeoId: geoId,
                    })
                  }
                  className="text-xs font-medium text-muted hover:text-ink"
                >
                  {entityName}
                </button>
                <h3 className="mt-1 text-sm font-semibold tracking-tight text-ink">
                  {bill.title}
                </h3>
                <p className="mt-1 text-xs text-muted">
                  {bill.billCode} · {bill.updatedDate}
                </p>
              </div>
              <StagePill stage={bill.stage} />
            </div>
            {bill.summary && (
              <p className="mt-3 text-sm leading-relaxed text-ink/75">
                {bill.summary}
              </p>
            )}
            {bill.sourceUrl && (
              <a
                href={bill.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex text-xs font-medium text-ink hover:underline"
              >
                Official source →
              </a>
            )}
          </article>
        ))}
        {visible.length === 0 && (
          <p className="p-8 text-center text-sm text-muted">No matching records.</p>
        )}
      </div>

      {!showAll && filtered.length > 12 && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-5 rounded-full border border-black/[.08] px-4 py-2 text-xs font-medium text-ink hover:bg-black/[.03]"
        >
          {expanded ? "Show fewer" : `Show all ${filtered.length}`}
        </button>
      )}
    </div>
  );
}
