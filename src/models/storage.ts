import type { Effect } from "effect";
import type { BucketKey } from "../types/branded.ts";
import type { AppError } from "../types/errors.ts";

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
