import type { Effect } from "effect";
import type { BucketKey } from "@domain/utils/refined.types.ts";
import type { AppError } from "@infra/errors.ts";

export type IStorage = {
  uploadFile(
    key: BucketKey,
    body: ReadableStream | Uint8Array | Buffer | string,
    contentType: string,
  ): Effect.Effect<void, AppError>;
  getPresignedDownloadUrl(
    key: BucketKey,
    expiresInSeconds?: number,
  ): Effect.Effect<string, AppError>;
  deleteFile(key: BucketKey): Effect.Effect<void, AppError>;
};
