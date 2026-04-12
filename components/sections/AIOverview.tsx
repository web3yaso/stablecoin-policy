"use client";

import { useMemo, useState, Fragment } from "react";
import newsSummaries from "@/data/news/summaries.json";

type RegionKey = "all" | "na" | "eu" | "asia";

const REGION_LABEL: Record<Exclude<RegionKey, "all">, string> = {
  na: "North America",
  eu: "Europe",
  asia: "Asia-Pacific",
};

const TAB_ORDER: RegionKey[] = ["all", "na", "eu", "asia"];
const TAB_LABEL: Record<RegionKey, string> = {
  all: "Global",
  na: "North America",
  eu: "Europe",
  asia: "Asia-Pacific",
};

function formatRelative(iso: string | undefined): string {
  if (!iso) return "recently";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "recently";
  const diffMs = Date.now() - then;
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Patterns ordered most-specific first so longer matches win. Everything
// that matches gets wrapped in a `<strong>` + the `highlight-sweep` class
// so the reader's eye gets pulled to the load-bearing facts.
const HIGHLIGHT_PATTERNS: RegExp[] = [
  // Named acts / bills / frameworks / strategies — multi-word proper nouns
  // ending in a policy keyword.
  /\b[A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+){0,6}\s+(?:Act|Bill|Framework|Strategy|Order|Directive|Regulation|Roadmap|Law|Rule|Treaty|Pact|Initiative|Scheme|Blueprint|Policy|Plan)(?:\s+(?:No\.?|Law\s+No\.?)\s*\d[\w-]*)?/g,
  // Bracketed act references like (COM(2025) 836) or (HB0102)
  /\([A-Z]{2,}[A-Za-z0-9()\s.-]*\)/g,
  // Months with years ("March 2026", "January 22, 2026")
  /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}?(?:,\s*\d{4})?(?:\s*\d{4})?/g,
  // Dollar amounts with optional magnitude
  /\$\d+(?:\.\d+)?(?:\s*(?:billion|million|trillion|B|M|T))?/gi,
  // Percentages
  /\b\d+(?:\.\d+)?%/g,
  // "X states", "X countries", "X-bill package" style quantified nouns
  /\b\d{1,3}\s+(?:states?|countries?|provinces?|bills?|data\s+centers?|facilit(?:y|ies)|gigawatts?|megawatts?|GW|MW|TWh)/gi,
];

interface HighlightSpan {
  start: number;
  end: number;
}

function findHighlights(text: string): HighlightSpan[] {
  const spans: HighlightSpan[] = [];
  for (const pattern of HIGHLIGHT_PATTERNS) {
    // Reset lastIndex for /g regexes that carry state between calls
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      spans.push({ start: m.index, end: m.index + m[0].length });
      if (m[0].length === 0) pattern.lastIndex++;
    }
  }
  // Sort and collapse overlapping spans — longest wins on ties.
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: HighlightSpan[] = [];
  for (const s of spans) {
    const prev = merged[merged.length - 1];
    if (!prev) {
      merged.push(s);
      continue;
    }
    if (s.start < prev.end) {
      // Overlap — keep the longer one
      if (s.end - s.start > prev.end - prev.start) {
        merged[merged.length - 1] = s;
      }
    } else {
      merged.push(s);
    }
  }
  return merged;
}

function renderHighlighted(text: string, keyPrefix: string) {
  const spans = findHighlights(text);
  if (spans.length === 0) return text;
  const out: React.ReactNode[] = [];
  let cursor = 0;
  spans.forEach((span, i) => {
    if (span.start > cursor) {
      out.push(
        <Fragment key={`${keyPrefix}-t-${i}`}>
          {text.slice(cursor, span.start)}
        </Fragment>,
      );
    }
    // Stagger each sweep a touch so the eye tracks left-to-right.
    const delay = 120 + i * 60;
    out.push(
      <strong
        key={`${keyPrefix}-h-${i}`}
        className="font-semibold text-ink highlight-sweep"
        style={{ ["--sweep-delay" as string]: `${delay}ms` }}
      >
        {text.slice(span.start, span.end)}
      </strong>,
    );
    cursor = span.end;
  });
  if (cursor < text.length) {
    out.push(<Fragment key={`${keyPrefix}-tail`}>{text.slice(cursor)}</Fragment>);
  }
  return out;
}

function splitParagraphs(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const paras = trimmed.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return paras.length > 0 ? paras : [trimmed];
}

interface RegionalSummary {
  key: Exclude<RegionKey, "all">;
  label: string;
  paragraphs: string[];
}

export default function AIOverview() {
  const [tab, setTab] = useState<RegionKey>("all");

  const regional = (newsSummaries.regional ?? {}) as Record<
    string,
    { summary?: string } | undefined
  >;
  const updated = formatRelative(newsSummaries.generatedAt);

  const allRegions: RegionalSummary[] = useMemo(() => {
    const order: Array<Exclude<RegionKey, "all">> = ["na", "eu", "asia"];
    return order
      .map((k) => {
        const summary = regional[k]?.summary;
        if (!summary) return null;
        return {
          key: k,
          label: REGION_LABEL[k],
          paragraphs: splitParagraphs(summary),
        };
      })
      .filter((r): r is RegionalSummary => r !== null);
  }, [regional]);

  const visibleRegions: RegionalSummary[] =
    tab === "all" ? allRegions : allRegions.filter((r) => r.key === tab);

  // Rekey children on tab change so the highlight-sweep animation replays.
  const renderKey = tab;

  return (
    <div className="bg-black/[.02] rounded-3xl p-8">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="text-[13px] font-medium text-muted tracking-tight flex items-center gap-1.5">
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="#F5C518"
            aria-hidden
            className="flex-shrink-0"
          >
            <path d="M7 0L8.27 5.73L14 7L8.27 8.27L7 14L5.73 8.27L0 7L5.73 5.73Z" />
          </svg>
          AI overview · Updated {updated}
        </div>

        <div className="flex items-center gap-1 bg-black/[.04] rounded-full p-0.5">
          {TAB_ORDER.map((k) => {
            const active = tab === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                className={`text-[11px] font-medium px-3 py-1.5 rounded-full tracking-tight transition-colors ${
                  active
                    ? "bg-white text-ink shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
                    : "text-muted hover:text-ink"
                }`}
              >
                {TAB_LABEL[k]}
              </button>
            );
          })}
        </div>
      </div>

      {visibleRegions.length === 0 ? (
        <p className="text-sm text-muted mt-6">
          No overview available yet. Run scripts/sync/news.ts to generate one.
        </p>
      ) : (
        <div key={renderKey} className="mt-6 flex flex-col gap-8 animate-fade-rise">
          {visibleRegions.map((region) => (
            <div key={region.key}>
              {tab === "all" && (
                <div className="text-[11px] font-semibold text-muted uppercase tracking-[0.08em] mb-2">
                  {region.label}
                </div>
              )}
              <div className="flex flex-col gap-4 max-w-3xl">
                {region.paragraphs.map((p, i) => (
                  <p
                    key={`${region.key}-${i}`}
                    className="text-[15px] text-ink/80 leading-relaxed"
                  >
                    {renderHighlighted(p, `${region.key}-${i}`)}
                  </p>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
