"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Entity, GovLevel } from "@/types";
import StanceBadge from "@/components/ui/StanceBadge";
import Breadcrumb, { type BreadcrumbItem } from "@/components/ui/Breadcrumb";
import ContextBlurb from "./ContextBlurb";
import LegislationList from "./LegislationList";
import KeyFigures from "./KeyFigures";
import NewsSection from "./NewsSection";

interface SidePanelProps {
  entity: Entity | null;
  breadcrumbItems: BreadcrumbItem[];
  showViewStatesButton?: boolean;
  onViewStates?: () => void;
}

const LEVEL_LABEL: Record<GovLevel, string | null> = {
  federal: "Federal Government",
  state: "State Government",
  bloc: null,
};

type Layer = "legislation" | "figures" | "news";

const LEGISLATION_PREVIEW = 5;
const FIGURES_PREVIEW = 3;
const NEWS_PREVIEW = 3;

function ShowAllLink({
  total,
  shown,
  label,
  href,
}: {
  total: number;
  shown: number;
  label: string;
  href?: string;
}) {
  if (total <= shown) return null;
  const className =
    "inline-block text-xs text-muted hover:text-ink transition-colors mt-3";
  const content = `Show all ${total} ${label} →`;
  if (href) {
    return (
      <Link href={href} className={className}>
        {content}
      </Link>
    );
  }
  return (
    <a href="#" className={className}>
      {content}
    </a>
  );
}

export default function SidePanel({
  entity,
  breadcrumbItems,
  showViewStatesButton = false,
  onViewStates,
}: SidePanelProps) {
  const hasLegislation = !!entity && entity.legislation.length > 0;
  const hasFigures = !!entity && entity.keyFigures.length > 0;
  const hasNews = !!entity && entity.news.length > 0;

  const availableLayers = useMemo<Layer[]>(() => {
    const layers: Layer[] = [];
    if (hasLegislation) layers.push("legislation");
    if (hasFigures) layers.push("figures");
    if (hasNews) layers.push("news");
    return layers;
  }, [hasLegislation, hasFigures, hasNews]);

  const [preferredLayer, setPreferredLayer] = useState<Layer>("legislation");

  const activeLayer: Layer =
    availableLayers.length > 0 && !availableLayers.includes(preferredLayer)
      ? availableLayers[0]
      : preferredLayer;

  return (
    <aside className="w-full lg:w-96 max-h-[45vh] lg:max-h-[calc(100vh-96px)] bg-white/90 backdrop-blur-2xl rounded-3xl shadow-[0_8px_32px_rgba(0,0,0,0.08),0_2px_8px_rgba(0,0,0,0.04)] flex flex-col overflow-hidden border border-black/[.04]">
      {/* Always-visible breadcrumb header */}
      <div className="px-6 pt-5 pb-4">
        <Breadcrumb items={breadcrumbItems} />
      </div>

      {!entity ? (
        <div className="flex-1 flex items-center justify-center px-8 py-16 min-h-[200px]">
          <p className="text-xs text-muted text-center">
            Select a country or region to explore legislation
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <div className="px-6 pt-2 pb-5 border-b border-black/[.06]">
            <h2 className="text-2xl font-semibold text-ink tracking-tight">
              {entity.name}
            </h2>
            <div className="mt-2 flex items-center gap-3">
              <StanceBadge stance={entity.stance} size="md" />
              {LEVEL_LABEL[entity.level] && (
                <span className="text-xs text-muted">
                  {LEVEL_LABEL[entity.level]}
                </span>
              )}
            </div>
          </div>

          <div className="p-6 flex flex-col gap-6">
            <ContextBlurb text={entity.contextBlurb} />

            {showViewStatesButton && onViewStates && (
              <button
                type="button"
                onClick={onViewStates}
                className="self-start rounded-full bg-ink text-white text-xs font-medium px-4 py-2 hover:bg-ink/90 transition-colors"
              >
                View State Legislation →
              </button>
            )}

            {availableLayers.length > 0 && (
              <>
                <div className="inline-flex items-center gap-1 p-1 rounded-full bg-black/[.04] self-start">
                  {availableLayers.map((layer) => {
                    const active = layer === activeLayer;
                    const label =
                      layer === "legislation"
                        ? "Legislation"
                        : layer === "figures"
                          ? "Key Figures"
                          : "News";
                    return (
                      <button
                        key={layer}
                        type="button"
                        onClick={() => setPreferredLayer(layer)}
                        className={`text-xs font-medium px-3 py-1.5 rounded-full transition-all ${
                          active
                            ? "bg-white text-ink shadow-[0_1px_3px_rgba(0,0,0,0.08)]"
                            : "text-muted hover:text-ink"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>

                {activeLayer === "legislation" && hasLegislation && (
                  <section>
                    <LegislationList
                      legislation={entity.legislation.slice(
                        0,
                        LEGISLATION_PREVIEW,
                      )}
                    />
                    <ShowAllLink
                      total={entity.legislation.length}
                      shown={LEGISLATION_PREVIEW}
                      label="bills"
                      href={`/legislation/${encodeURIComponent(entity.id)}`}
                    />
                  </section>
                )}

                {activeLayer === "figures" && hasFigures && (
                  <section>
                    <KeyFigures
                      figures={entity.keyFigures.slice(0, FIGURES_PREVIEW)}
                    />
                    <ShowAllLink
                      total={entity.keyFigures.length}
                      shown={FIGURES_PREVIEW}
                      label="figures"
                    />
                  </section>
                )}

                {activeLayer === "news" && hasNews && (
                  <section>
                    <NewsSection news={entity.news.slice(0, NEWS_PREVIEW)} />
                    <ShowAllLink
                      total={entity.news.length}
                      shown={NEWS_PREVIEW}
                      label="articles"
                    />
                  </section>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
