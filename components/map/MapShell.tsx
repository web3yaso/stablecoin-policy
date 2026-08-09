"use client";

import dynamic from "next/dynamic";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MutableRefObject,
} from "react";
import { usePolicyData } from "@/contexts/PolicyDataContext";
import type { Dimension, Entity, Region, ViewTarget } from "@/types";
import { REGION_LABEL, REGION_ORDER } from "@/types";
import type { TooltipState } from "@/lib/map-utils";
import DimensionToggle from "@/components/sections/DimensionToggle";
import SidePanel from "@/components/panel/SidePanel";

const NorthAmericaMap = dynamic(() => import("./NorthAmericaMap"), {
  ssr: false,
});
const EuropeMap = dynamic(() => import("./EuropeMap"), { ssr: false });
const AsiaMap = dynamic(() => import("./AsiaMap"), { ssr: false });
const AfricaMap = dynamic(() => import("./AfricaMap"), { ssr: false });

type MapRegion = "na" | "eu" | "asia" | "africa";

function normalizeRegion(region: Region): MapRegion {
  if (region === "latam") return "na";
  if (region === "oceania") return "asia";
  return region;
}

interface MapShellProps {
  revealProgress?: number;
  navigateRef?: MutableRefObject<((target: ViewTarget) => void) | null>;
}

export default function MapShell({
  revealProgress = 1,
  navigateRef,
}: MapShellProps) {
  const { entities } = usePolicyData();
  const [region, setRegion] = useState<MapRegion>("na");
  const [dimension, setDimension] = useState<Dimension>("sc-issuance");
  const [selected, setSelected] = useState<Entity | null>(null);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const selectGeo = useCallback(
    (geoId: string, preferredRegion?: Region) => {
      const entity =
        entities.find(
          (candidate) =>
            candidate.geoId === geoId &&
            (!preferredRegion || candidate.region === preferredRegion),
        ) ?? entities.find((candidate) => candidate.geoId === geoId);
      setSelected(entity ?? null);
    },
    [entities],
  );

  useEffect(() => {
    if (!navigateRef) return;
    navigateRef.current = (target) => {
      setRegion(normalizeRegion(target.region));
      if (target.selectedGeoId) {
        selectGeo(target.selectedGeoId, target.region);
      } else {
        setSelected(null);
      }
    };
    return () => {
      navigateRef.current = null;
    };
  }, [navigateRef, selectGeo]);

  const map = useMemo(() => {
    const common = {
      selectedGeoId: selected?.geoId ?? null,
      setTooltip,
      dimension,
    };
    if (region === "eu") {
      return <EuropeMap {...common} onSelectEntity={(id) => selectGeo(id, "eu")} />;
    }
    if (region === "asia") {
      return <AsiaMap {...common} onSelectEntity={(id) => selectGeo(id, "asia")} />;
    }
    if (region === "africa") {
      return <AfricaMap {...common} onSelectEntity={(id) => selectGeo(id, "africa")} />;
    }
    return (
      <NorthAmericaMap
        {...common}
        onSelectEntity={(id) => selectGeo(id)}
        onSelectUsState={(name) => selectGeo(name, "na")}
      />
    );
  }, [dimension, region, selectGeo, selected?.geoId]);

  const opacity = Math.max(0, Math.min(1, (revealProgress - 0.12) / 0.28));

  return (
    <div
      className="fixed inset-0 z-0 bg-bg"
      style={{
        opacity,
        pointerEvents: opacity > 0.75 ? "auto" : "none",
        transition: "opacity 180ms linear",
      }}
      aria-label="Stablecoin policy jurisdiction map"
    >
      <div className="absolute inset-x-0 top-12 bottom-0 flex flex-col">
        <div className="px-4 pt-4 flex justify-center">
          <div className="inline-flex rounded-full bg-white/90 border border-black/[.06] p-1 shadow-sm backdrop-blur-xl">
            {(REGION_ORDER as MapRegion[]).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => {
                  setRegion(item);
                  setSelected(null);
                }}
                className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
                  item === region
                    ? "bg-ink text-white"
                    : "text-muted hover:text-ink"
                }`}
              >
                {REGION_LABEL[item]}
              </button>
            ))}
          </div>
        </div>

        <div className="relative flex-1 min-h-0 px-3 md:px-8">{map}</div>

        <div className="px-4 pb-4 flex justify-center">
          <div className="max-w-4xl w-full rounded-2xl border border-black/[.06] bg-white/92 px-4 py-3 shadow-sm backdrop-blur-xl">
            <DimensionToggle dimension={dimension} onChange={setDimension} />
          </div>
        </div>
      </div>

      {tooltip && (
        <div
          className="fixed z-30 pointer-events-none rounded-lg bg-ink text-white px-3 py-1.5 text-xs shadow-lg"
          style={{ left: tooltip.x + 12, top: tooltip.y + 12 }}
        >
          {tooltip.label}
        </div>
      )}

      {selected && (
        <SidePanel entity={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
