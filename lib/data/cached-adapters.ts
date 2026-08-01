import type {
  ImmutableObjectStore,
  PutImmutableObjectInput,
  ReportMetadataRepository,
  StoredObject,
} from "./contracts";
import { ResilientCache, type ResilientCacheOptions } from "./resilient-cache";
import type { ReportMeta } from "./report-types";

export class CachedReportMetadataRepository
  implements ReportMetadataRepository
{
  private readonly cache: ResilientCache<ReportMeta[]>;

  constructor(
    private readonly origin: ReportMetadataRepository,
    options: ResilientCacheOptions,
  ) {
    this.cache = new ResilientCache(options);
  }

  async listReports(): Promise<ReportMeta[]> {
    const read = await this.cache.read("catalog", () => this.origin.listReports());
    return read.value.map(cloneReportMeta);
  }

  async findReportBySlug(slug: string): Promise<ReportMeta | null> {
    const reports = await this.listReports();
    return reports.find((report) => report.slug === slug) ?? null;
  }
}

export class CachedObjectStore implements ImmutableObjectStore {
  private readonly cache: ResilientCache<StoredObject | null>;

  constructor(
    private readonly origin: ImmutableObjectStore,
    options: ResilientCacheOptions,
  ) {
    this.cache = new ResilientCache(options);
  }

  async getObject(key: string): Promise<StoredObject | null> {
    const read = await this.cache.read(key, () => this.origin.getObject(key));
    return read.value ? cloneStoredObject(read.value) : null;
  }

  async putObject(input: PutImmutableObjectInput): Promise<StoredObject> {
    const stored = await this.origin.putObject(input);
    this.cache.set(input.key, cloneStoredObject(stored));
    return cloneStoredObject(stored);
  }
}

function cloneReportMeta(meta: ReportMeta): ReportMeta {
  return { ...meta, jurisdiction: [...meta.jurisdiction] };
}

function cloneStoredObject(object: StoredObject): StoredObject {
  return { ...object, body: new Uint8Array(object.body) };
}
