export type CacheReadState = "origin" | "fresh-cache" | "stale-cache";

export type CacheRead<T> = {
  value: T;
  state: CacheReadState;
  cachedAt: string;
  staleBecause?: Error;
};

export type ResilientCacheOptions = {
  freshForMs: number;
  maxStaleMs: number;
  maxEntries?: number;
  now?: () => number;
  onStale?: (key: string, error: Error) => void;
};

type CacheEntry<T> = {
  value: T;
  cachedAt: number;
};

export class ResilientCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private readonly pending = new Map<string, Promise<CacheRead<T>>>();
  private readonly freshForMs: number;
  private readonly maxStaleMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;
  private readonly onStale?: (key: string, error: Error) => void;

  constructor(options: ResilientCacheOptions) {
    if (options.freshForMs < 0 || options.maxStaleMs < options.freshForMs) {
      throw new Error("cache maxStaleMs must be at least freshForMs");
    }

    this.freshForMs = options.freshForMs;
    this.maxStaleMs = options.maxStaleMs;
    this.maxEntries = options.maxEntries ?? 100;
    this.now = options.now ?? Date.now;
    this.onStale = options.onStale;
  }

  async read(key: string, load: () => Promise<T>): Promise<CacheRead<T>> {
    const now = this.now();
    const cached = this.entries.get(key);

    if (cached && now - cached.cachedAt <= this.freshForMs) {
      this.touch(key, cached);
      return toRead(cached, "fresh-cache");
    }

    const existing = this.pending.get(key);
    if (existing) return existing;

    const request = this.loadWithFallback(key, load, cached);
    this.pending.set(key, request);

    try {
      return await request;
    } finally {
      this.pending.delete(key);
    }
  }

  set(key: string, value: T): CacheRead<T> {
    const entry = { value, cachedAt: this.now() };
    this.touch(key, entry);
    this.evictOverflow();
    return toRead(entry, "origin");
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  private async loadWithFallback(
    key: string,
    load: () => Promise<T>,
    cached: CacheEntry<T> | undefined,
  ): Promise<CacheRead<T>> {
    try {
      return this.set(key, await load());
    } catch (error: unknown) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      const now = this.now();
      if (cached && now - cached.cachedAt <= this.maxStaleMs) {
        this.touch(key, cached);
        this.onStale?.(key, normalized);
        return {
          ...toRead(cached, "stale-cache"),
          staleBecause: normalized,
        };
      }
      throw normalized;
    }
  }

  private touch(key: string, entry: CacheEntry<T>): void {
    this.entries.delete(key);
    this.entries.set(key, entry);
  }

  private evictOverflow(): void {
    while (this.entries.size > this.maxEntries) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (oldestKey === undefined) return;
      this.entries.delete(oldestKey);
    }
  }
}

function toRead<T>(entry: CacheEntry<T>, state: CacheReadState): CacheRead<T> {
  return {
    value: entry.value,
    state,
    cachedAt: new Date(entry.cachedAt).toISOString(),
  };
}
