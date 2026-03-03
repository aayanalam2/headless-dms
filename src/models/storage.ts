import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { config } from "../config/env.ts";
import type { BucketKey } from "../types/branded.ts";
import { Effect } from "effect";
import { AppError } from "../types/errors.ts";

// ---------------------------------------------------------------------------
// S3 storage adapter — the only place in the codebase that talks to object
// storage. All functions return AppResult<T>; storage errors are wrapped as
// AppError.storage so callers never deal with raw SDK exceptions.
//
// The S3Client is a module-level singleton (created once per process).
// Swapping S3 for MinIO or GCS only requires changing this file and env vars.
// ---------------------------------------------------------------------------

let _client: S3Client | null = null;

function getClient(): S3Client {
  if (_client === null) {
    _client = new S3Client({
      endpoint: config.s3.endpoint,
      region: config.s3.region,
      credentials: {
        accessKeyId: config.s3.accessKeyId,
        secretAccessKey: config.s3.secretAccessKey,
      },
      forcePathStyle: true,
    });
  }
  return _client;
}

// ---------------------------------------------------------------------------
// uploadToS3
// Streams a file body to S3. Returns Ok(void) on success.
// The key must be a BucketKey branded type to prevent raw strings from being
// used accidentally.
// ---------------------------------------------------------------------------

export function uploadToS3(
  key: BucketKey,
  body: ReadableStream | Uint8Array | Buffer | string,
  contentType: string,
): Effect.Effect<void, AppError> {
  return Effect.tryPromise({
    try: () =>
      getClient().send(
        new PutObjectCommand({
          Bucket: config.s3.bucket,
          Key: key as string,
          Body: body,
          ContentType: contentType,
        }),
      ),
    catch: (e) => AppError.storage(e),
  }).pipe(Effect.as(undefined));
}

// ---------------------------------------------------------------------------
// getPresignedDownloadUrl
// Returns a time-limited pre-signed GET URL for the given object key.
// The API never streams file bytes — clients download directly from S3.
// ---------------------------------------------------------------------------

export function getPresignedDownloadUrl(
  key: BucketKey,
  expiresInSeconds: number = config.presignTtlSeconds,
): Effect.Effect<string, AppError> {
  return Effect.tryPromise({
    try: () =>
      getSignedUrl(
        getClient(),
        new GetObjectCommand({
          Bucket: config.s3.bucket,
          Key: key as string,
        }),
        { expiresIn: expiresInSeconds },
      ),
    catch: (e) => AppError.storage(e),
  });
}

// ---------------------------------------------------------------------------
// deleteFromS3
// Removes an object. Used during hard-delete admin flows if ever needed.
// Soft-deleted documents intentionally leave their S3 objects intact.
// ---------------------------------------------------------------------------

export function deleteFromS3(key: BucketKey): Effect.Effect<void, AppError> {
  return Effect.tryPromise({
    try: () =>
      getClient().send(
        new DeleteObjectCommand({
          Bucket: config.s3.bucket,
          Key: key as string,
        }),
      ),
    catch: (e) => AppError.storage(e),
  }).pipe(Effect.as(undefined));
}
