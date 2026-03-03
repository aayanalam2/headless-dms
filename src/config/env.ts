import { Either, Schema } from "effect";

// ---------------------------------------------------------------------------
// Raw env schema — all values arrive as strings from process.env.
// Effect Schema validates and fails fast at startup (12-Factor III).
// ---------------------------------------------------------------------------

const EnvSchema = Schema.Struct({
  DATABASE_URL: Schema.NonEmptyString,
  JWT_SECRET: Schema.NonEmptyString,
  S3_ENDPOINT: Schema.NonEmptyString,
  S3_BUCKET: Schema.NonEmptyString,
  S3_REGION: Schema.optionalWith(Schema.String, { default: () => "us-east-1" }),
  S3_ACCESS_KEY_ID: Schema.NonEmptyString,
  S3_SECRET_ACCESS_KEY: Schema.NonEmptyString,
  PORT: Schema.optionalWith(Schema.String, { default: () => "3000" }),
  PRESIGN_TTL_SECONDS: Schema.optionalWith(Schema.String, {
    default: () => "300",
  }),
  BCRYPT_ROUNDS: Schema.optionalWith(Schema.String, { default: () => "12" }),
  NODE_ENV: Schema.optionalWith(Schema.String, {
    default: () => "development",
  }),
});

// ---------------------------------------------------------------------------
// AppConfig — the typed, application-facing config object.
// Consume this everywhere; never read process.env directly.
// ---------------------------------------------------------------------------

export type AppConfig = {
  readonly databaseUrl: string;
  readonly jwtSecret: string;
  readonly port: number;
  readonly s3: {
    readonly endpoint: string;
    readonly bucket: string;
    readonly region: string;
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
  };
  readonly presignTtlSeconds: number;
  readonly bcryptRounds: number;
  readonly nodeEnv: string;
};

function loadConfig(): AppConfig {
  // Inject defaults for optional keys before parsing so NonEmptyString
  // validators only fire on truly mandatory fields.
  const raw = {
    DATABASE_URL: process.env["DATABASE_URL"],
    JWT_SECRET: process.env["JWT_SECRET"],
    S3_ENDPOINT: process.env["S3_ENDPOINT"],
    S3_BUCKET: process.env["S3_BUCKET"],
    S3_REGION: process.env["S3_REGION"],
    S3_ACCESS_KEY_ID: process.env["S3_ACCESS_KEY_ID"],
    S3_SECRET_ACCESS_KEY: process.env["S3_SECRET_ACCESS_KEY"],
    PORT: process.env["PORT"],
    PRESIGN_TTL_SECONDS: process.env["PRESIGN_TTL_SECONDS"],
    BCRYPT_ROUNDS: process.env["BCRYPT_ROUNDS"],
    NODE_ENV: process.env["NODE_ENV"],
  };

  const result = Schema.decodeUnknownEither(EnvSchema)(raw);

  if (Either.isLeft(result)) {
    // Fail fast — log to stdout (12-Factor XI) then exit
    console.error(
      JSON.stringify({
        level: "error",
        message: "Invalid environment configuration. Server cannot start.",
        details: result.left.message,
        timestamp: new Date().toISOString(),
      }),
    );
    process.exit(1);
  }

  const env = result.right;

  return Object.freeze({
    databaseUrl: env.DATABASE_URL,
    jwtSecret: env.JWT_SECRET,
    port: parseInt(env.PORT, 10),
    s3: Object.freeze({
      endpoint: env.S3_ENDPOINT,
      bucket: env.S3_BUCKET,
      region: env.S3_REGION,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    }),
    presignTtlSeconds: parseInt(env.PRESIGN_TTL_SECONDS, 10),
    bcryptRounds: parseInt(env.BCRYPT_ROUNDS, 10),
    nodeEnv: env.NODE_ENV,
  });
}

export const config: AppConfig = loadConfig();
