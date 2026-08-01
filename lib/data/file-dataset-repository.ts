import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { DatasetReleaseRepository } from "./contracts";
import type { DatasetRelease } from "./dataset-types";
import { sha256 } from "./integrity";
import { assertSafeObjectKey } from "./report-types";

export type FileDatasetDefinition = {
  objectKey: string;
  contentType: string;
  schemaVersion: string;
};

export class FileDatasetReleaseRepository
  implements DatasetReleaseRepository
{
  constructor(
    private readonly rootDirectory: string,
    private readonly definitions: Record<string, FileDatasetDefinition>,
  ) {}

  async findActiveRelease(datasetId: string): Promise<DatasetRelease | null> {
    const definition = this.definitions[datasetId];
    if (!definition) return null;
    assertSafeObjectKey(definition.objectKey);
    const filePath = path.resolve(this.rootDirectory, definition.objectKey);
    const root = path.resolve(this.rootDirectory);
    if (!filePath.startsWith(`${root}${path.sep}`)) {
      throw new Error(`dataset path escapes root: ${definition.objectKey}`);
    }

    try {
      const [body, fileStat] = await Promise.all([readFile(filePath), stat(filePath)]);
      const checksumSha256 = sha256(body);
      const generatedAt = readGeneratedAt(body) ?? fileStat.mtime.toISOString();
      return {
        datasetId,
        releaseId: `file-${checksumSha256.slice(0, 24)}`,
        objectKey: definition.objectKey,
        checksumSha256,
        byteSize: body.byteLength,
        contentType: definition.contentType,
        schemaVersion: definition.schemaVersion,
        generatedAt,
        publishedAt: generatedAt,
      };
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async findRelease(
    datasetId: string,
    releaseId: string,
  ): Promise<DatasetRelease | null> {
    const active = await this.findActiveRelease(datasetId);
    return active?.releaseId === releaseId ? active : null;
  }
}

function readGeneratedAt(body: Uint8Array): string | null {
  try {
    const value = JSON.parse(Buffer.from(body).toString("utf8")) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return null;
    }
    const record = value as Record<string, unknown>;
    for (const candidate of [record.generatedAt, record.checkedAt]) {
      if (
        typeof candidate === "string" &&
        Number.isFinite(Date.parse(candidate))
      ) {
        return candidate;
      }
    }
    return null;
  } catch {
    return null;
  }
}
