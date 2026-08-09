"use client";

import { useMemo, useState } from "react";
import { usePolicyData } from "@/contexts/PolicyDataContext";

type RegionKey = "na" | "eu" | "asia";

const LABELS: Record<RegionKey, string> = {
  na: "Americas",
  eu: "Europe",
  asia: "Asia-Pacific",
};

interface RegionalUpdate {
  summary?: string;
  generatedAt?: string;
  sourceCount?: number;
  sourcePolicy?: string;
}

export default function PolicyOverview() {
  const [active, setActive] = useState<RegionKey>("na");
  const { newsDataset, newsStatus } = usePolicyData();
  const regional = useMemo(
    () => (newsDataset?.regional ?? {}) as Record<RegionKey, RegionalUpdate>,
    [newsDataset?.regional],
  );
  const update = regional[active];
  const generatedAt = update?.generatedAt ?? newsDataset?.generatedAt;

  return (
    <div className="rounded-3xl bg-black/[.02] p-6 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-[13px] font-medium text-muted">
            Official-source policy update
          </div>
          <div className="mt-1 text-xs text-muted">
            {generatedAt
              ? `Generated ${new Date(generatedAt).toLocaleDateString("en", {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}`
              : "Loading current release"}
            {newsStatus === "stale" ? " · cached snapshot" : ""}
          </div>
        </div>
        <div className="inline-flex rounded-full bg-black/[.04] p-1">
          {(Object.keys(LABELS) as RegionKey[]).map((region) => (
            <button
              key={region}
              type="button"
              onClick={() => setActive(region)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-medium ${
                active === region
                  ? "bg-white text-ink shadow-sm"
                  : "text-muted hover:text-ink"
              }`}
            >
              {LABELS[region]}
            </button>
          ))}
        </div>
      </div>

      <p className="mt-6 text-base leading-7 text-ink/85">
        {update?.summary ??
          "The current official-source regional update is temporarily unavailable."}
      </p>
      {typeof update?.sourceCount === "number" && (
        <p className="mt-4 text-xs text-muted">
          {update.sourceCount} official source records · {update.sourcePolicy ?? "official-only"}
        </p>
      )}
    </div>
  );
}
