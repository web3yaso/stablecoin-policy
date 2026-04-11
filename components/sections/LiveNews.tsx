"use client";

import { useMemo, useState } from "react";
import { ENTITIES } from "@/lib/placeholder-data";
import type { Entity, NewsItem } from "@/types";

interface NewsRow {
  item: NewsItem;
  entity: Entity;
}

const PREVIEW_COUNT = 12;

type ScopeFilter = "all" | "us-federal" | "us-states" | "international";

const SCOPE_OPTIONS: { key: ScopeFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "us-federal", label: "US Federal" },
  { key: "us-states", label: "US States" },
  { key: "international", label: "International" },
];

function matchesScope(entity: Entity, s: ScopeFilter): boolean {
  if (s === "all") return true;
  if (s === "us-federal") {
    return (
      entity.region === "na" &&
      entity.level === "federal" &&
      entity.geoId === "840"
    );
  }
  if (s === "us-states") {
    return entity.region === "na" && entity.level === "state";
  }
  return !(
    entity.region === "na" &&
    (entity.level === "state" ||
      (entity.level === "federal" && entity.geoId === "840"))
  );
}

function buildNewsRows(): NewsRow[] {
  const rows: NewsRow[] = [];
  for (const entity of ENTITIES) {
    for (const item of entity.news) {
      rows.push({ item, entity });
    }
  }
  return rows.sort((a, b) => b.item.date.localeCompare(a.item.date));
}

function rowMatchesQuery(row: NewsRow, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    row.item.headline.toLowerCase().includes(needle) ||
    row.item.source.toLowerCase().includes(needle) ||
    row.entity.name.toLowerCase().includes(needle)
  );
}

export default function LiveNews() {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [activeScope, setActiveScope] = useState<ScopeFilter>("all");

  const allRows = useMemo(() => buildNewsRows(), []);

  // Pre-compute counts per scope so the chip badges are live, ignoring the
  // search query so the user can always see how much content is in each
  // bucket before searching.
  const scopeCounts = useMemo(() => {
    const counts: Record<ScopeFilter, number> = {
      all: allRows.length,
      "us-federal": 0,
      "us-states": 0,
      international: 0,
    };
    for (const r of allRows) {
      if (matchesScope(r.entity, "us-federal")) counts["us-federal"] += 1;
      else if (matchesScope(r.entity, "us-states")) counts["us-states"] += 1;
      else counts.international += 1;
    }
    return counts;
  }, [allRows]);

  const filtered = useMemo(() => {
    let rows = allRows;
    if (activeScope !== "all") {
      rows = rows.filter((r) => matchesScope(r.entity, activeScope));
    }
    const q = query.trim();
    if (q) {
      rows = rows.filter((r) => rowMatchesQuery(r, q));
    }
    return rows;
  }, [allRows, activeScope, query]);

  const hasMore = filtered.length > PREVIEW_COUNT;
  const visible = expanded ? filtered : filtered.slice(0, PREVIEW_COUNT);

  return (
    <div>
      {/* Search input */}
      <div className="mb-6">
        <div className="max-w-md flex items-center gap-2.5 px-4 py-2.5 rounded-full bg-white border border-black/[.06] focus-within:border-black/20 transition-colors">
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            className="text-muted flex-shrink-0"
          >
            <circle
              cx="6"
              cy="6"
              r="4.5"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path
              d="M9.5 9.5L12.5 12.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search headlines, sources, jurisdictions…"
            className="flex-1 bg-transparent text-sm text-ink placeholder:text-muted focus:outline-none min-w-0"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="text-muted hover:text-ink flex-shrink-0"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path
                  d="M3 3L9 9M9 3L3 9"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Scope row */}
      <div className="mb-6">
        <div className="text-[13px] font-medium text-muted tracking-tight mb-2">
          Scope
        </div>
        <div className="flex flex-wrap gap-2">
          {SCOPE_OPTIONS.map((opt) => {
            const active = opt.key === activeScope;
            const count = scopeCounts[opt.key];
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => setActiveScope(opt.key)}
                className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
                  active
                    ? "bg-ink text-white"
                    : "border border-black/[.06] text-muted hover:text-ink"
                }`}
              >
                <span>{opt.label}</span>
                <span
                  className={`text-[10px] ${active ? "text-white/70" : "text-muted"}`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Live indicator + count */}
      <div className="flex items-center gap-2 mb-6">
        <span className="relative flex w-2 h-2">
          <span className="absolute inset-0 rounded-full bg-stance-restrictive opacity-60 animate-ping" />
          <span className="relative w-2 h-2 rounded-full bg-stance-restrictive" />
        </span>
        <span className="text-xs uppercase tracking-widest text-muted">
          Live · Updated continuously
        </span>
        <span className="text-xs text-muted ml-auto">
          {filtered.length} {filtered.length === 1 ? "story" : "stories"}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="py-16 text-center text-sm text-muted">
          No stories match this search.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {visible.map(({ item, entity }) => (
              <a
                key={item.id}
                href={item.url}
                target={item.url && item.url !== "#" ? "_blank" : undefined}
                rel={
                  item.url && item.url !== "#"
                    ? "noopener noreferrer"
                    : undefined
                }
                className="block bg-white border border-black/[.06] hover:border-black/20 rounded-2xl p-5 transition-colors"
              >
                <div className="text-sm font-medium text-ink tracking-tight leading-snug">
                  {item.headline}
                </div>
                <div className="text-[11px] text-muted mt-3 flex items-center gap-2">
                  <span className="font-medium text-ink/70">{item.source}</span>
                  <span aria-hidden>·</span>
                  <span>{item.date}</span>
                  <span aria-hidden>·</span>
                  <span className="truncate">{entity.name}</span>
                </div>
              </a>
            ))}
          </div>

          {hasMore && (
            <div className="mt-6 flex justify-center">
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="rounded-full border border-black/[.06] text-muted hover:text-ink px-5 py-2 text-xs font-medium transition-colors"
              >
                {expanded
                  ? "Show less"
                  : `Show all ${filtered.length} stories →`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
