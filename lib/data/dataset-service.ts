import type {
  DatasetReleaseRepository,
  ImmutableObjectStore,
} from "./contracts";
import type { DatasetSnapshot } from "./dataset-types";
import { DataIntegrityError, DataParityError } from "./external-storage-errors";
import { stableJson } from "./integrity";
import { ResilientCache, type ResilientCacheOptions } from "./resilient-cache";

export interface DatasetReader {
  getActiveDataset<T = unknown>(datasetId: string): Promise<DatasetSnapshot<T> | null>;
  getDatasetRelease<T = unknown>(
    datasetId: string,
    releaseId: string,
  ): Promise<DatasetSnapshot<T> | null>;
}

export class DatasetService implements DatasetReader {
  private readonly cache: ResilientCache<DatasetSnapshot | null>;

  constructor(
    private readonly releases: DatasetReleaseRepository,
    private readonly objects: ImmutableObjectStore,
    cacheOptions: ResilientCacheOptions,
  ) {
    this.cache = new ResilientCache(cacheOptions);
  }

  getActiveDataset<T = unknown>(datasetId: string) {
    return this.read<T>(`active:${datasetId}`, async () => {
      const release = await this.releases.findActiveRelease(datasetId);
      return release ? this.loadRelease<T>(release) : null;
    });
  }

  getDatasetRelease<T = unknown>(datasetId: string, releaseId: string) {
    return this.read<T>(`release:${datasetId}:${releaseId}`, async () => {
      const release = await this.releases.findRelease(datasetId, releaseId);
      return release ? this.loadRelease<T>(release) : null;
    });
  }

  private async read<T>(
    cacheKey: string,
    load: () => Promise<DatasetSnapshot<T> | null>,
  ): Promise<DatasetSnapshot<T> | null> {
    const read = await this.cache.read(cacheKey, load as () => Promise<DatasetSnapshot | null>);
    if (!read.value) return null;
    return {
      ...(read.value as DatasetSnapshot<T>),
      cacheState: read.state,
      cachedAt: read.cachedAt,
      ...(read.staleBecause ? { staleReason: read.staleBecause.message } : {}),
    };
  }

  private async loadRelease<T>(release: DatasetSnapshot<T>["release"]): Promise<DatasetSnapshot<T>> {
    const object = await this.objects.getObject(release.objectKey);
    if (!object) {
      throw new Error(`dataset artifact is missing: ${release.objectKey}`);
    }
    if (object.checksumSha256 !== release.checksumSha256) {
      throw new DataIntegrityError(
        `dataset artifact checksum mismatch: ${release.objectKey}`,
      );
    }

    let data: T;
    try {
      data = JSON.parse(Buffer.from(object.body).toString("utf8")) as T;
    } catch (error: unknown) {
      throw new DataIntegrityError(
        `dataset artifact is not valid JSON: ${error instanceof Error ? error.message : error}`,
      );
    }

    return {
      release,
      data,
      cacheState: "origin",
      cachedAt: new Date().toISOString(),
    };
  }
}

export class DualReadDatasetService implements DatasetReader {
  constructor(
    private readonly primary: DatasetReader,
    private readonly secondary: DatasetReader,
    private readonly strict = false,
    private readonly onIssue: (error: Error) => void = (error) =>
      console.warn(error.message),
  ) {}

  getActiveDataset<T = unknown>(datasetId: string) {
    return this.compare<T>(
      datasetId,
      () => this.primary.getActiveDataset<T>(datasetId),
      () => this.secondary.getActiveDataset<T>(datasetId),
    );
  }

  getDatasetRelease<T = unknown>(datasetId: string, releaseId: string) {
    return this.compare<T>(
      `${datasetId}@${releaseId}`,
      () => this.primary.getDatasetRelease<T>(datasetId, releaseId),
      () => this.secondary.getDatasetRelease<T>(datasetId, releaseId),
    );
  }

  private async compare<T>(
    resource: string,
    readPrimary: () => Promise<DatasetSnapshot<T> | null>,
    readSecondary: () => Promise<DatasetSnapshot<T> | null>,
  ): Promise<DatasetSnapshot<T> | null> {
    const primary = await readPrimary();
    try {
      const secondary = await readSecondary();
      if (stableJson(primary?.data ?? null) !== stableJson(secondary?.data ?? null)) {
        throw new DataParityError(`dataset ${resource}`);
      }
    } catch (error: unknown) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      if (this.strict) throw normalized;
      this.onIssue(normalized);
    }
    return primary;
  }
}
