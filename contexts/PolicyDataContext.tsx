"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ENTITIES } from "@/lib/placeholder-data";
import { applyNewsDataset, type NewsDataset } from "@/lib/news-dataset";
import type { Entity, Region } from "@/types";

type PolicyDataContextValue = {
  entities: Entity[];
  newsDataset: NewsDataset | null;
  newsStatus: "loading" | "live" | "stale" | "unavailable";
  newsGeneratedAt?: string;
  getEntity: (geoId: string, region: Region) => Entity | null;
  getOverviewEntity: (region: Region) => Entity | null;
};

const PolicyDataContext = createContext<PolicyDataContextValue | null>(null);

export function PolicyDataProvider({ children }: { children: ReactNode }) {
  const [newsDataset, setNewsDataset] = useState<NewsDataset | null>(null);
  const [newsStatus, setNewsStatus] = useState<
    PolicyDataContextValue["newsStatus"]
  >("loading");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/public/datasets/news-summaries", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`dataset request failed (${response.status})`);
        }
        return {
          value: (await response.json()) as NewsDataset,
          stale: response.headers.get("x-data-stale") === "true",
        };
      })
      .then(({ value, stale }) => {
        setNewsDataset(value);
        setNewsStatus(stale ? "stale" : "live");
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          console.warn(
            `runtime news dataset unavailable: ${error instanceof Error ? error.message : error}`,
          );
          setNewsStatus("unavailable");
        }
      });
    return () => controller.abort();
  }, []);

  const entities = useMemo(
    () => applyNewsDataset(ENTITIES, newsDataset),
    [newsDataset],
  );
  const getEntity = useCallback(
    (geoId: string, region: Region) =>
      entities.find((entity) => entity.geoId === geoId && entity.region === region) ??
      null,
    [entities],
  );
  const getOverviewEntity = useCallback(
    (region: Region) =>
      entities.find((entity) => entity.region === region && entity.isOverview) ??
      null,
    [entities],
  );
  const value = useMemo(
    () => ({
      entities,
      newsDataset,
      newsStatus,
      newsGeneratedAt: newsDataset?.generatedAt,
      getEntity,
      getOverviewEntity,
    }),
    [entities, getEntity, getOverviewEntity, newsDataset, newsStatus],
  );

  return (
    <PolicyDataContext.Provider value={value}>
      {children}
    </PolicyDataContext.Provider>
  );
}

export function usePolicyData(): PolicyDataContextValue {
  const value = useContext(PolicyDataContext);
  if (!value) {
    throw new Error("usePolicyData must be used inside PolicyDataProvider");
  }
  return value;
}
