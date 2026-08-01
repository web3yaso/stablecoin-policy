import type { Entity, NewsItem } from "@/types";

export type NewsDataset = {
  generatedAt?: string;
  regional?: Record<string, Record<string, unknown>>;
  entities?: Record<string, { news?: NewsItem[] }>;
};

export function newsForEntity(
  dataset: NewsDataset | null | undefined,
  entityName: string,
): NewsItem[] | null {
  const news = dataset?.entities?.[entityName]?.news;
  return Array.isArray(news) ? news : null;
}

export function applyNewsDataset(
  entities: Entity[],
  dataset: NewsDataset | null | undefined,
): Entity[] {
  if (!dataset?.entities) return entities;
  return entities.map((entity) => {
    const current = newsForEntity(dataset, entity.name);
    if (!current) return entity;
    return { ...entity, news: mergeNews(current, entity.news) };
  });
}

function mergeNews(current: NewsItem[], fallback: NewsItem[]): NewsItem[] {
  const seen = new Set(current.map(newsIdentity));
  return [
    ...current,
    ...fallback.filter((item) => !seen.has(newsIdentity(item))),
  ].sort((left, right) => (right.date ?? "").localeCompare(left.date ?? ""));
}

function newsIdentity(item: NewsItem): string {
  return item.officialDocumentId
    ? `${item.officialDocumentId}:${item.sourceVersion ?? ""}`
    : item.url;
}
