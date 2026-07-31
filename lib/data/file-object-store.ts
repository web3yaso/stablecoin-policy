import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ImmutableObjectStore,
  PutImmutableObjectInput,
  StoredObject,
} from "./contracts";
import { assertSafeObjectKey } from "./report-types";

export class ImmutableObjectConflictError extends Error {
  constructor(key: string) {
    super(`immutable object already exists with different content: ${key}`);
    this.name = "ImmutableObjectConflictError";
  }
}

export class FileObjectStore implements ImmutableObjectStore {
  constructor(private readonly rootDirectory: string) {}

  async getObject(key: string): Promise<StoredObject | null> {
    const objectPath = this.resolveObjectPath(key);

    try {
      const [body, objectStat] = await Promise.all([
        readFile(objectPath),
        stat(objectPath),
      ]);

      if (!objectStat.isFile()) {
        return null;
      }

      return createStoredObject(key, body, inferContentType(key));
    } catch (error: unknown) {
      if (isFileNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }

  async putObject(input: PutImmutableObjectInput): Promise<StoredObject> {
    const objectPath = this.resolveObjectPath(input.key);
    const body = Buffer.from(input.body);
    const checksumSha256 = sha256(body);

    if (
      input.expectedChecksumSha256 !== undefined &&
      input.expectedChecksumSha256 !== checksumSha256
    ) {
      throw new Error(`checksum mismatch for object: ${input.key}`);
    }

    await mkdir(path.dirname(objectPath), { recursive: true });

    try {
      await writeFile(objectPath, body, { flag: "wx" });
    } catch (error: unknown) {
      if (!isFileExistsError(error)) {
        throw error;
      }

      const existing = await this.getObject(input.key);
      if (existing?.checksumSha256 !== checksumSha256) {
        throw new ImmutableObjectConflictError(input.key);
      }

      return existing;
    }

    return createStoredObject(input.key, body, input.contentType);
  }

  private resolveObjectPath(key: string): string {
    assertSafeObjectKey(key);
    const resolvedRoot = path.resolve(this.rootDirectory);
    const resolvedObject = path.resolve(resolvedRoot, key);

    if (!resolvedObject.startsWith(`${resolvedRoot}${path.sep}`)) {
      throw new Error(`object key escapes storage root: ${key}`);
    }

    return resolvedObject;
  }
}

function createStoredObject(
  key: string,
  body: Uint8Array,
  contentType: string,
): StoredObject {
  return {
    key,
    body,
    contentType,
    byteSize: body.byteLength,
    checksumSha256: sha256(body),
  };
}

function sha256(body: Uint8Array): string {
  return createHash("sha256").update(body).digest("hex");
}

function inferContentType(key: string): string {
  if (key.endsWith(".json")) return "application/json";
  if (key.endsWith(".md.enc")) return "application/json";
  if (key.endsWith(".md")) return "text/markdown; charset=utf-8";
  if (key.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}

function isFileNotFoundError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isFileExistsError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}
