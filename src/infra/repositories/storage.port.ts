import type { Effect as E } from "effect";
import type { BucketKey } from "@domain/utils/refined.types.ts";
import type { AppError } from "@infra/errors.ts";

export type IStorage = {
  uploadFile(
    key: BucketKey,
    body: ReadableStream | Uint8Array | Buffer | string,
    contentType: string,
  ): E.Effect<void, AppError>;
  getPresignedDownloadUrl(key: BucketKey, expiresInSeconds?: number): E.Effect<string, AppError>;
  deleteFile(key: BucketKey): E.Effect<void, AppError>;
};
