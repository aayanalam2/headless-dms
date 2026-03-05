import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { AppConfig } from "@infra/config/env.ts";
import type { BucketKey } from "@domain/utils/refined.types.ts";
import { Effect } from "effect";
import { AppError } from "@infra/errors.ts";
import type { IStorage } from "@infra/repositories/storage.port.ts";

// ---------------------------------------------------------------------------
// createS3Storage
// S3/MinIO implementation of IStorage. The S3Client is instantiated once
// inside the factory closure — no module-level singletons, fully injectable.
// Swap endpoint/credentials to target MinIO, GCS (via compat layer), etc.
// ---------------------------------------------------------------------------

export function createS3Storage(
  s3Config: AppConfig["s3"],
  bucket: string,
  presignTtlSeconds: number,
): IStorage {
  const client = new S3Client({
    endpoint: s3Config.endpoint,
    region: s3Config.region,
    credentials: {
      accessKeyId: s3Config.accessKeyId,
      secretAccessKey: s3Config.secretAccessKey,
    },
    forcePathStyle: true,
  });

  return {
    uploadFile(
      key: BucketKey,
      body: ReadableStream | Uint8Array | Buffer | string,
      contentType: string,
    ): Effect.Effect<void, AppError> {
      return Effect.tryPromise({
        try: () =>
          client.send(
            new PutObjectCommand({
              Bucket: bucket,
              Key: key as string,
              Body: body,
              ContentType: contentType,
            }),
          ),
        catch: (e) => AppError.storage(e),
      }).pipe(Effect.as(undefined));
    },

    getPresignedDownloadUrl(
      key: BucketKey,
      expiresInSeconds: number = presignTtlSeconds,
    ): Effect.Effect<string, AppError> {
      return Effect.tryPromise({
        try: () =>
          getSignedUrl(
            client,
            new GetObjectCommand({
              Bucket: bucket,
              Key: key as string,
            }),
            { expiresIn: expiresInSeconds },
          ),
        catch: (e) => AppError.storage(e),
      });
    },

    deleteFile(key: BucketKey): Effect.Effect<void, AppError> {
      return Effect.tryPromise({
        try: () =>
          client.send(
            new DeleteObjectCommand({
              Bucket: bucket,
              Key: key as string,
            }),
          ),
        catch: (e) => AppError.storage(e),
      }).pipe(Effect.as(undefined));
    },
  };
}
