export type DatasetRelease = {
  datasetId: string;
  releaseId: string;
  objectKey: string;
  checksumSha256: string;
  byteSize: number;
  contentType: string;
  schemaVersion: string;
  generatedAt: string;
  publishedAt: string;
};

export type DatasetSnapshot<T = unknown> = {
  release: DatasetRelease;
  data: T;
  cacheState: "origin" | "fresh-cache" | "stale-cache";
  cachedAt: string;
  staleReason?: string;
};

export const PUBLIC_DATASET_IDS = [
  "news-summaries",
  "news-source-health",
] as const;

export type PublicDatasetId = (typeof PUBLIC_DATASET_IDS)[number];

export function isPublicDatasetId(value: string): value is PublicDatasetId {
  return PUBLIC_DATASET_IDS.includes(value as PublicDatasetId);
}
