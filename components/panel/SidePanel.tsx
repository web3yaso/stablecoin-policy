"use client";

import { useState } from "react";
import type { Entity } from "@/types";
import ContextBlurb from "./ContextBlurb";
import LegislationList from "./LegislationList";
import NewsSection from "./NewsSection";
import StablecoinInfo from "./StablecoinInfo";

type PanelTab = "overview" | "legislation" | "news";

export default function SidePanel({
  entity,
  onClose,
}: {
  entity: Entity;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<PanelTab>("overview");
  const tabs: Array<{ id: PanelTab; label: string }> = [
    { id: "overview", label: "Overview" },
    { id: "legislation", label: `Rules (${entity.legislation.length})` },
    { id: "news", label: `Updates (${entity.news.length})` },
  ];

  return (
    <aside className="fixed bottom-4 right-4 top-16 z-50 flex w-[min(26rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-3xl border border-black/[.08] bg-white shadow-2xl">
      <div className="flex items-start justify-between gap-4 border-b border-black/[.06] px-5 py-4">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-widest text-muted">
            Stablecoin policy
          </div>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-ink">
            {entity.name}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close jurisdiction details"
          className="rounded-full bg-black/[.05] px-2.5 py-1.5 text-sm text-muted hover:text-ink"
        >
          ×
        </button>
      </div>

      <div className="flex gap-1 border-b border-black/[.06] px-4 py-2">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${
              tab === item.id ? "bg-ink text-white" : "text-muted hover:text-ink"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {tab === "overview" && (
          <div className="flex flex-col gap-5">
            <ContextBlurb text={entity.contextBlurb} />
            {entity.stablecoinMeta ? (
              <StablecoinInfo meta={entity.stablecoinMeta} />
            ) : (
              <p className="text-xs leading-relaxed text-muted">
                This editorial jurisdiction record is a public orientation layer.
                Paid decisions use versioned claims and evidence from the domain API.
              </p>
            )}
          </div>
        )}
        {tab === "legislation" && (
          <LegislationList legislation={entity.legislation} />
        )}
        {tab === "news" && <NewsSection news={entity.news} />}
      </div>
    </aside>
  );
}
