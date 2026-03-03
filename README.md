# Document Management API

A headless REST API for uploading, versioning, searching, and securely downloading files. Built with a functional-core / imperative-shell architecture: pure domain logic expressed as composable [Effect](https://effect.website) pipelines, backed by PostgreSQL and S3-compatible object storage (MinIO in development, AWS S3 in production).

---

## Features

| Capability | Details |
|---|---|
| **File upload** | Multipart upload with SHA-256 checksum, MIME-type validation, and automatic S3 key generation |
| **Immutable versioning** | Every upload creates a new version; existing objects in S3 are never overwritten |
| **Presigned downloads** | Time-limited (default 5 min) pre-signed URLs — files never pass through the API server |
| **Role-based access control** | `admin` can do everything; `user` can only read/write their own documents; only `admin` can hard-delete |
| **Rich search** | Filter by name (ILIKE), content-type, owner, tags (array containment), and arbitrary JSONB metadata |
| **Soft delete** | Documents are marked `deleted_at`; all queries exclude them without physically removing data |
| **Audit log** | Append-only record of every significant action (upload, version, delete) |
| **Structured logging** | pino NDJSON to stdout in production; pretty-printed in development |
| **Swagger UI** | Auto-generated at `/swagger` for interactive exploration |

---

## Architecture

This project follows the **Model-View-Controller (MVC)** pattern adapted for a REST API:

```
HTTP Request
     │
     ▼
┌──────────────────────────────────────────────────────────┐
│  Controller  (src/controllers/)                          │
│  Receives the HTTP request, validates input, delegates   │
│  to services, and writes the HTTP response.              │
└────────────────────────┬─────────────────────────────────┘
                         │  calls
                         ▼
┌──────────────────────────────────────────────────────────┐
│  Service  (src/services/)                                │
│  Business logic: RBAC, upload orchestration, search      │
│  parsing. Pure functions — no HTTP, no database.         │
└──────────┬──────────────────────────────┬────────────────┘
           │  reads / writes              │  transforms
           ▼                             ▼
┌─────────────────────┐      ┌───────────────────────────┐
│  Model              │      │  View                     │
│  (src/models/)      │      │  (src/dto/)               │
│  Drizzle ORM schema │      │  DTO types + mapper fns   │
│  DB repositories    │      │  Shape the JSON response  │
│  S3 storage layer   │      │  Strip internal fields    │
└─────────────────────┘      └───────────────────────────┘
```

### Layer responsibilities

| Layer | Directory | Responsibility |
|---|---|---|
| **Controller** | `src/controllers/` | Parse HTTP input, call services, return DTOs or error responses |
| **Service** | `src/services/` | Business rules, permission checks, upload orchestration, search parsing |
| **Model** | `src/models/` | Database schema (Drizzle), repository queries, S3 storage operations |
| **View** | `src/dto/` | DTO types and mapper functions — the outbound JSON shape of every response |

Services are pure functions that return `Effect<T, AppError>` — no I/O, no HTTP, tested in isolation without mocking. Repositories and storage are the only places where side effects occur.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | [Bun](https://bun.sh) v1.x |
| HTTP framework | [Elysia](https://elysiajs.com) v1.4 |
| Effect system | [Effect](https://effect.website) v3 |
| ORM | [Drizzle ORM](https://orm.drizzle.team) |
| Database | PostgreSQL 16 |
| Object storage | MinIO (dev) / AWS S3 (prod) |
| Auth | HS256 JWT via `@elysiajs/jwt` |
| Password hashing | bcryptjs |
| Schema validation | Zod v4 + `@carbonteq/refined-type` |
| Logging | pino v10 + pino-pretty (dev) |
| Testing | Bun test runner + `@faker-js/faker` |

---

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) ≥ 1.3
- [Docker](https://docs.docker.com/get-docker/) and Docker Compose (for local infrastructure)

### 1. Clone and install

```bash
git clone <repo-url>
cd document_management_mvc
bun install
```

### 2. Start infrastructure

```bash
docker compose up postgres minio minio_init -d
```

This starts:
- **PostgreSQL** on `localhost:5432`
- **MinIO** S3 API on `localhost:9000` and the web console on `localhost:9001`
- **minio_init** — a one-shot container that creates the `documents` bucket then exits

### 3. Configure environment

```bash
cp .env.example .env
# Edit .env if your credentials differ from the defaults
```

### 4. Run database migrations

```bash
bun run db:migrate
```

### 5. Start the development server

```bash
bun run dev       # hot-reload via --watch
# OR
bun run start     # single run
```

The API is available at `http://localhost:3000`. Swagger UI is at `http://localhost:3000/swagger`.

---

## Environment Variables

Copy `.env.example` to `.env`. All variables are validated at startup — the server exits immediately if a required variable is missing.

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | ✅ | — | PostgreSQL connection string |
| `JWT_SECRET` | ✅ | — | Secret for signing JWTs (≥32 chars in production) |
| `S3_ENDPOINT` | ✅ | — | S3 or MinIO endpoint URL |
| `S3_BUCKET` | ✅ | — | Bucket name |
| `S3_ACCESS_KEY_ID` | ✅ | — | S3 access key |
| `S3_SECRET_ACCESS_KEY` | ✅ | — | S3 secret key |
| `S3_REGION` | — | `us-east-1` | S3 region |
| `PORT` | — | `3000` | HTTP server port |
| `NODE_ENV` | — | `development` | `development` → pretty logs; `production` → NDJSON |
| `LOG_LEVEL` | — | `info` | `trace` \| `debug` \| `info` \| `warn` \| `error` \| `fatal` |
| `PRESIGN_TTL_SECONDS` | — | `300` | Pre-signed URL lifetime (seconds) |
| `BCRYPT_ROUNDS` | — | `12` | bcrypt cost factor |

---

## API Reference

All document endpoints require an `Authorization: Bearer <token>` header. Obtain a token via `/auth/login`.

### Auth

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/auth/register` | None | Register a new user. Body: `{ email, password, role? }` |
| `POST` | `/auth/login` | None | Login. Returns `{ token, user }`. Always 401 on any failure (no user enumeration) |

### Documents

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/documents` | Any | Upload a new document (multipart: `file`, optional `name`, `tags`, `metadata`) |
| `GET` | `/documents` | Any | Search / list documents with pagination |
| `GET` | `/documents/:id` | Any | Get a document by ID |
| `GET` | `/documents/:id/download` | Any | Pre-signed URL for the current version |
| `DELETE` | `/documents/:id` | Admin | Soft-delete a document |
| `POST` | `/documents/:id/versions` | Owner or Admin | Upload a new version of an existing document |
| `GET` | `/documents/:id/versions` | Any | List all versions of a document |
| `GET` | `/documents/:id/versions/:versionId/download` | Any | Pre-signed URL for a specific version |

#### Search query parameters (`GET /documents`)

| Parameter | Type | Description |
|---|---|---|
| `name` | string | Case-insensitive substring match |
| `contentType` | string | Exact MIME type match |
| `tags` | string | Comma-separated list; returns docs containing **all** provided tags |
| `metadata` | string | URL-encoded JSON object; JSONB containment filter |
| `ownerId` | string | Filter by owner (admin only; regular users always see their own) |
| `page` | number | 1-based page number (default: 1) |
| `limit` | number | Items per page, 1–100 (default: 20) |
| `sortBy` | string | `createdAt` \| `updatedAt` \| `name` (default: `createdAt`) |
| `sortOrder` | string | `asc` \| `desc` (default: `desc`) |

### Audit

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/audit` | Admin | List audit log entries. Optional `?resourceType=` and `?resourceId=` filters |

---

## Project Structure

```
src/
├── config/
│   └── env.ts                    # Typed config from process.env (validated at startup)
├── controllers/
│   ├── auth.controller.ts        # POST /auth/register, POST /auth/login
│   └── documents.controller.ts   # All /documents and /audit routes
├── dto/
│   ├── document.dto.ts           # DocumentDTO, VersionDTO, PaginatedDocumentsDTO
│   └── user.dto.ts               # UserDTO (strips passwordHash)
├── lib/
│   ├── http.ts                   # mapErrorToResponse: AppError → HTTP status + body
│   └── logger.ts                 # pino singleton (pretty dev / NDJSON prod)
├── middleware/
│   └── auth.plugin.ts            # JWT verification, scoped user context, adminPlugin
├── models/
│   ├── db/
│   │   ├── connection.ts         # Drizzle + postgres.js connection
│   │   ├── schema.ts             # Table definitions & inferred row types
│   │   └── migrations/           # Drizzle migration files
│   ├── document.repository.ts    # All document/version/audit DB queries
│   ├── user.repository.ts        # User DB queries
│   └── storage.ts                # S3 upload, presigned URL, delete
├── services/
│   ├── auth.service.ts           # hashPassword, verifyPassword, buildJwtClaims
│   ├── document.service.ts       # canRead/Write/Delete, buildBucketKey, nextVersionNumber
│   ├── document.upload.service.ts# uploadDocument, uploadNewVersion orchestration
│   └── search.service.ts         # parseSearchParams: raw query → typed SearchParams
└── types/
    ├── branded.ts                # UserId, DocumentId, Email, ISODateString, …
    └── errors.ts                 # AppError discriminated union + constructors

tests/
├── helpers/
│   └── factories.ts              # faker-based row factories + runOk/runErr helpers
├── dto/
│   └── dto.test.ts               # toUserDTO, toDocumentDTO, toVersionDTO, toPaginated…
├── lib/
│   └── http.test.ts              # mapErrorToResponse — all 6 error types
└── services/
    ├── auth.service.test.ts      # hashPassword, verifyPassword, buildJwtClaims
    ├── document.service.test.ts  # RBAC policies, buildBucketKey, nextVersionNumber, validateContentType
    ├── document.upload.service.test.ts  # parseOptionalJson, parseTags
    └── search.service.test.ts    # parseSearchParams — exhaustive coverage
```

---

## Design Decisions

### Effect for typed errors

All functions that can fail return `Effect<T, AppError>` instead of throwing exceptions or returning `Result` wrappers. This makes error handling:

- **Explicit** — the compiler enforces that every failure path is handled
- **Composable** — pipelines chain with `Effect.flatMap`/`Effect.map` without nested try/catch
- **Uniform** — every controller handler calls the same `run(set, effect)` helper that runs the effect and maps `AppError` to an HTTP status code

```typescript
// Controller: thin — just wires effects together
.get("/:id", ({ params, user, set }) =>
  run(set,
    pipe(
      findDocumentById(params.id),
      Effect.flatMap((doc) => pipe(canRead(user, doc), Effect.as(doc))),
      Effect.map((doc) => ({ document: toDocumentDTO(doc) })),
    ),
  ),
)
```

### Option for optional values

Anywhere the domain has a value that may or may not be present, the type is `Option<T>` rather than `T | undefined`. This eliminates nullish-coalescing noise and makes optionality visible and explicit in function signatures.

```typescript
// HTTP boundary: nullable query param → Option
Option.fromNullable(query.name)

// Domain: consume safely without null checks
Option.getOrElse(input.name, () => file.name)
```

### Branded primitives

Domain IDs and validated strings are distinct nominal types (`UserId`, `DocumentId`, `Email`, `HashedPassword`, `BucketKey`, `FileName`). It is a compile-time error to pass a `UserId` where a `DocumentId` is expected, or to store a plaintext password where a `HashedPassword` is required.

```typescript
export const UserId = createRefinedType("UserId", z.uuid());
export type UserId = typeof UserId.$infer;
```

### ISODateString

DTO date fields carry the type `ISODateString` — a branded `string` validated to be ISO-8601. Inside the system, `ISODateString.fromDate(date)` is a zero-cost coercion (Date → toISOString() is always valid). At API boundaries, `ISODateString.create(str)` validates external input. This prevents accidentally serving unformatted `Date` objects or arbitrary strings as date fields.

### Immutable S3 versioning

Every version gets a unique S3 key: `{documentId}/{versionId}/{encodedFilename}`. Objects are **never** overwritten. Deleting a version in the database does not remove the underlying object. This means you can always recover any historical version and there are no race conditions during concurrent uploads.

### Structured logging

pino is configured to write structured NDJSON to stdout (12-factor app, factor XI). In development, pino-pretty renders the same events as coloured single-line output. Each log entry includes `service: "document-management"`, ISO timestamp, and standard `err` serialization for Error objects. The log level is configurable via `LOG_LEVEL` environment variable.

---

## Testing

```bash
bun test            # run all tests
bun test --watch    # re-run on file changes
```

Tests are **pure unit tests** — no database, no S3, no HTTP server. The domain layer (services, DTOs, error mapping) is tested in full isolation.

All test data is generated with [`@faker-js/faker`](https://fakerjs.dev), making every test run against different realistic inputs and avoiding the false confidence of hardcoded fixture values.

| File | Coverage |
|---|---|
| `auth.service.test.ts` | `hashPassword`, `verifyPassword`, `buildJwtClaims` |
| `document.service.test.ts` | RBAC (`canRead/Write/Delete`), `buildBucketKey`, `nextVersionNumber`, `validateContentType` |
| `document.upload.service.test.ts` | `parseOptionalJson`, `parseTags` |
| `search.service.test.ts` | `parseSearchParams` — all pagination, sorting, filtering, and validation edge cases |
| `http.test.ts` | `mapErrorToResponse` — all 6 `AppError` variants, body shape invariants |
| `dto.test.ts` | `toUserDTO`, `toDocumentDTO`, `toVersionDTO`, `toPaginatedDocumentsDTO` |

---

## Production Deployment

The included `Dockerfile` builds a minimal Alpine image using Bun's official base image.

```bash
# Build
docker build -t document-management-api .

# Run (provide env vars via --env-file or -e flags)
docker run -p 3000:3000 --env-file .env.production document-management-api
```

Or use the full `docker-compose.yml` which also provisions PostgreSQL and MinIO:

```bash
docker compose up -d
```

> **Note:** The container runs `drizzle-kit migrate` on startup before launching the server. For production systems, consider running migrations as a separate step before deploying new container revisions.

---

## Database management

```bash
bun run db:generate   # generate a new migration from schema changes
bun run db:migrate    # apply pending migrations
bun run db:studio     # open Drizzle Studio (browser-based DB explorer)
```
