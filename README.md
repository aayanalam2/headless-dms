# Document Management API

A headless REST API for uploading, versioning, and securely downloading files. Built on **Domain-Driven Design**, **Ports & Adapters (Hexagonal Architecture)**, and **functional programming** with [Effect](https://effect.website). All domain logic is pure and testable in isolation; infrastructure is a pluggable detail.

---

## Features

| Capability               | Details                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| **File upload**          | Multipart upload with SHA-256 checksum, MIME-type validation, and deterministic S3 key generation |
| **Immutable versioning** | Every upload creates a new version; existing S3 objects are never overwritten                     |
| **Presigned downloads**  | Time-limited (default 5 min) pre-signed URLs — files never pass through the API server            |
| **Access policies**      | Fine-grained Allow/Deny policies scoped per user per document                                     |
| **Role-based defaults**  | `admin` bypasses all policy checks; `user` falls through subject → owner → deny precedence        |
| **Rich search**          | Filter by name (ILIKE), content-type, owner, tags (array containment), and JSONB metadata         |
| **Soft delete**          | Documents are marked `deleted_at`; queries exclude them without removing data                     |
| **Audit log**            | Append-only record of every upload, version, and delete, written via a decoupled event bus        |
| **Structured logging**   | pino NDJSON to stdout in production; pretty-printed in development                                |
| **Swagger UI**           | Auto-generated at `/swagger`                                                                      |

---

## Architecture

The codebase is divided into four concentric layers. **Dependencies only point inward** — the domain has zero knowledge of infrastructure or HTTP.

```
┌──────────────────────────────────────────────────────────┐
│  Presentation  (src/presentation/)                       │
│  Elysia HTTP routes → Workflows → mapErrorToResponse     │
└────────────────────────┬─────────────────────────────────┘
                         │
┌────────────────────────▼─────────────────────────────────┐
│  Application  (src/application/)                         │
│  Workflow classes orchestrate use-cases as flat Effect   │
│  pipelines. Shared factories, DTOs, event publishers,    │
│  and event listeners live here. No I/O.                  │
└──────────┬────────────────────────────────┬──────────────┘
           │                                │
┌──────────▼──────────┐        ┌────────────▼─────────────┐
│  Domain             │        │  Infra  (src/infra/)     │
│  (src/domain/)      │        │  Drizzle repositories,   │
│  Entities, value    │        │  S3 storage, DI wiring,  │
│  objects, repo      │◄───────│  event bus.              │
│  interfaces. Zero   │        │  No business logic.      │
│  external deps.     │        └──────────────────────────┘
└─────────────────────┘
```

### Layer responsibilities

| Layer            | Directory           | Responsibility                                                                          |
| ---------------- | ------------------- | --------------------------------------------------------------------------------------- |
| **Domain**       | `src/domain/`       | Entities, value objects, repository interfaces (ports), domain services, domain errors. |
| **Application**  | `src/application/`  | Workflow classes, pipeline step functions, DTOs, event publishers, event listeners.     |
| **Infra**        | `src/infra/`        | Drizzle repositories, S3 storage, tsyringe DI container, typed event bus.               |
| **Presentation** | `src/presentation/` | Elysia HTTP routes, auth middleware, `mapErrorToResponse`.                              |

### Application layer structure

Each bounded context under `src/application/` follows the same layout:

```
<domain>/
├── workflows/
│   ├── <domain>.workflows.ts           # Injectable class — one method per use-case
│   └── steps/
│       ├── <domain>.context.steps.ts   # Named context types + pipeline step functions
│       └── <domain>.workflow.helpers.ts # decode factory, query wrappers, DTO mappers
├── services/
│   ├── <domain>.repository.service.ts  # liftRepo, requireX, buildX
│   └── <domain>.upload.service.ts      # (documents only) storage + entity construction
├── emitters/
│   └── <domain>.events.ts              # Raw event emitters (makeEmit wrappers)
├── events/
│   └── <domain>.event.publishers.ts    # Context-aware emitters called from pipelines
├── dtos/
│   └── <domain>.dto.ts                 # Schema, encoded/decoded types, mapper fns
└── <domain>-workflow.errors.ts         # WorkflowError discriminated union
```

`shared/` provides cross-domain utilities:

| Export             | Purpose                                                              |
| ------------------ | -------------------------------------------------------------------- |
| `makeDecoder`      | Builds a `decode` fn that maps schema parse errors to a domain error |
| `makeRequireAdmin` | Builds an `assertAdmin` step from a `notAuthorized` constructor      |
| `makeEmit`         | Wraps `eventBus.emit` for a specific event type                      |
| `DocumentActorCtx` | Shared `{ documentId, actor }` base type                             |
| `withPagination`   | HOF that wraps a paginated repo query + DTO transform                |

### Flat Effect pipelines

Workflow methods are flat `pipe()` chains of named step functions — no `Effect.gen`, no nested `if/else`, no anonymous inline logic:

```typescript
upload(raw) {
  return pipe(
    decode(UploadDocumentMetaSchema, raw),
    E.flatMap((meta) => prepareUpload(meta, this.storage)),
    E.flatMap((ctx) => requireAccess(this.policyGuard)(ctx)),
    E.flatMap((ctx) => attachChecksum(ctx)),
    E.flatMap((ctx) => commitFirstDocument(this.documentRepo)(ctx)),
    E.tap((ctx) => emitUploadedCtx(ctx)),
    E.map(toUploadResult),
  );
}
```

Named context types (`UploadContext`, `UploadContextCommitted`, …) accumulate pipeline state. Each step is typed against the minimal `Pick<>` it actually needs.

### Ports & Adapters

Repository and storage interfaces are defined in the domain and implemented in infra:

```
src/domain/document/document.repository.ts              ← port
src/infra/repositories/drizzle-document.repository.ts   ← adapter

src/infra/repositories/storage.port.ts                  ← port
src/infra/repositories/s3.storage.ts                    ← adapter
```

The DI container (`src/infra/di/container.ts`) wires adapters to tokens at startup. Workflows depend only on the port — swapping adapters (e.g. in-memory fakes in tests) requires no workflow changes.

### Decoupled audit via event bus

Workflows emit typed domain events; `audit.events.listeners.ts` subscribes and writes audit records independently. Adding a new audited operation only requires emitting an event — no changes to the listener.

---

## Domain Model

### Entities

| Entity            | Key invariants                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------- |
| `User`            | Branded `UserId`, validated `Email`, hashed password, `Role` (`admin` \| `user`)          |
| `Document`        | Branded `DocumentId`, owner reference, optional `currentVersionId`, soft-delete timestamp |
| `DocumentVersion` | Branded `VersionId`, immutable `BucketKey`, `Checksum`, MIME type, version number         |
| `AccessPolicy`    | `subjectId` + `documentId` + `PermissionAction` + `PolicyEffect` (Allow/Deny)             |

All entities are constructed through **Effect Schema** — a malformed entity cannot exist at runtime.

### Branded types

All domain IDs and validated strings are nominal types defined in `src/domain/utils/refined.types.ts`:

```typescript
export const DocumentId = createRefinedType("DocumentId", S.UUID);
export type DocumentId = typeof DocumentId.$infer; // string & Brand<"DocumentId">
```

### Access policy evaluation

`DocumentAccessService` applies a tiered precedence model:

1. Subject-specific `Deny` → immediate block
2. Subject-specific `Allow` → immediate pass
3. Document ownership → pass
4. Default → deny

Admins bypass all checks.

---

## Tech Stack

| Concern           | Technology                              |
| ----------------- | --------------------------------------- |
| Runtime           | [Bun](https://bun.sh) ≥ 1.3             |
| HTTP framework    | [Elysia](https://elysiajs.com) v1.4     |
| Effect system     | [Effect](https://effect.website) v3     |
| Schema / decoding | Effect Schema                           |
| Branded types     | `@carbonteq/refined-type`               |
| DI container      | tsyringe (reflect-metadata)             |
| ORM               | [Drizzle ORM](https://orm.drizzle.team) |
| Database          | PostgreSQL 16                           |
| Object storage    | MinIO (dev) / AWS S3 (prod)             |
| Auth              | HS256 JWT via `@elysiajs/jwt`           |
| Password hashing  | bcryptjs                                |
| Logging           | pino v10 + pino-pretty (dev)            |
| Testing           | Bun test runner + `@faker-js/faker`     |

---

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) ≥ 1.3
- Docker + Docker Compose

```bash
# 1. Install dependencies
bun install

# 2. Start infrastructure (PostgreSQL + MinIO)
docker compose up postgres minio minio_init -d

# 3. Apply migrations
bun run db:migrate

# 4. Start dev server (hot-reload)
bun run dev
```

API: `http://localhost:3000` · Swagger: `http://localhost:3000/swagger`

---

## Environment Variables

Validated at startup via Effect Schema — the server exits immediately on any missing or malformed value.

| Variable               | Required | Default       | Description                                                  |
| ---------------------- | -------- | ------------- | ------------------------------------------------------------ |
| `DATABASE_URL`         | ✅       | —             | PostgreSQL connection string                                 |
| `JWT_SECRET`           | ✅       | —             | JWT signing secret (≥ 32 chars in production)                |
| `S3_ENDPOINT`          | ✅       | —             | S3 or MinIO endpoint URL                                     |
| `S3_BUCKET`            | ✅       | —             | Bucket name                                                  |
| `S3_ACCESS_KEY_ID`     | ✅       | —             | S3 access key                                                |
| `S3_SECRET_ACCESS_KEY` | ✅       | —             | S3 secret key                                                |
| `S3_REGION`            | —        | `us-east-1`   | S3 region                                                    |
| `PORT`                 | —        | `3000`        | HTTP server port                                             |
| `NODE_ENV`             | —        | `development` | `development` → pretty logs; `production` → NDJSON           |
| `LOG_LEVEL`            | —        | `info`        | `trace` \| `debug` \| `info` \| `warn` \| `error` \| `fatal` |
| `PRESIGN_TTL_SECONDS`  | —        | `300`         | Pre-signed URL lifetime (seconds)                            |
| `BCRYPT_ROUNDS`        | —        | `12`          | bcrypt cost factor                                           |

---

## API Reference

All endpoints except `/auth/*` require `Authorization: Bearer <token>`.

### Auth

| Method | Path             | Auth | Notes                                                             |
| ------ | ---------------- | ---- | ----------------------------------------------------------------- |
| `POST` | `/auth/register` | None | `{ email, password }`                                             |
| `POST` | `/auth/login`    | None | Returns `{ token, user }`. Always 401 on failure (no enumeration) |

### Documents

| Method   | Path                                          | Auth           | Description                           |
| -------- | --------------------------------------------- | -------------- | ------------------------------------- |
| `POST`   | `/documents`                                  | Any            | Upload a new document (multipart)     |
| `GET`    | `/documents`                                  | Any            | Search / list with pagination         |
| `GET`    | `/documents/:id`                              | Any            | Get document by ID                    |
| `GET`    | `/documents/:id/download`                     | Any            | Pre-signed URL for current version    |
| `DELETE` | `/documents/:id`                              | Admin          | Soft-delete                           |
| `POST`   | `/documents/:id/versions`                     | Owner or Admin | Upload a new version                  |
| `GET`    | `/documents/:id/versions`                     | Any            | List all versions                     |
| `GET`    | `/documents/:id/versions/:versionId/download` | Any            | Pre-signed URL for a specific version |

**`GET /documents` query parameters**

| Parameter     | Description                                                  |
| ------------- | ------------------------------------------------------------ |
| `name`        | Case-insensitive substring match                             |
| `contentType` | Exact MIME type                                              |
| `tags`        | Comma-separated; returns docs containing **all** listed tags |
| `metadata`    | URL-encoded JSON; JSONB containment filter                   |
| `ownerId`     | Admin only; regular users always see only their own          |
| `page`        | 1-based (default: 1)                                         |
| `limit`       | 1–100 (default: 20)                                          |

### Access Policies

| Method   | Path                     | Auth | Description                      |
| -------- | ------------------------ | ---- | -------------------------------- |
| `POST`   | `/policies`              | Any  | Grant access to a document       |
| `PATCH`  | `/policies/:id`          | Any  | Change Allow/Deny effect         |
| `DELETE` | `/policies/:id`          | Any  | Revoke a policy                  |
| `GET`    | `/policies/check`        | Any  | Check whether the actor can act  |
| `GET`    | `/policies/document/:id` | Any  | List all policies for a document |

### Audit

| Method | Path     | Auth  | Description                                                            |
| ------ | -------- | ----- | ---------------------------------------------------------------------- |
| `GET`  | `/audit` | Admin | List audit log entries (optional `resourceType`, `resourceId` filters) |

---

## Project Structure

```
src/
├── domain/                                 # Zero external dependencies
│   ├── user/
│   ├── document/
│   │   └── value-objects/                  # BucketKey, Checksum, ContentType, Tags, Metadata
│   ├── access-policy/
│   │   └── value-objects/                  # PermissionAction, PolicyEffect
│   ├── events/                             # Domain event type definitions
│   ├── services/
│   │   └── document-access.service.ts      # Cross-aggregate policy evaluation
│   └── utils/                              # Branded types, enums, pagination, base classes
│
├── application/
│   ├── shared/                             # makeDecoder, makeEmit, makeRequireAdmin,
│   │                                       #   DocumentActorCtx, withPagination
│   ├── security/
│   │   └── document-access.guard.ts        # Application-level access check
│   ├── documents/
│   │   ├── workflows/
│   │   │   ├── document.workflows.ts
│   │   │   └── steps/                      # context.steps.ts, workflow.helpers.ts
│   │   ├── services/                       # repository.service.ts, upload.service.ts
│   │   ├── emitters/                       # Raw makeEmit wrappers
│   │   ├── events/                         # Context-aware event publishers
│   │   └── dtos/
│   ├── access-policy/                      # Same layout as documents
│   ├── users/                              # workflows/steps/, services/, dtos/
│   └── audit/
│       ├── workflows/
│       └── events/
│           └── audit.events.listeners.ts   # Subscribes to domain events → writes audit
│
├── infra/
│   ├── di/                                 # tsyringe container + injection tokens
│   ├── repositories/                       # Drizzle adapters + S3 storage adapter
│   ├── database/
│   │   ├── schema.ts
│   │   ├── models/                         # Per-table definitions + row types
│   │   ├── migrations/
│   │   └── utils/                          # shared-columns, connection, query-helpers
│   ├── services/
│   │   └── auth.service.ts                 # JWT sign/verify
│   ├── event-bus.ts                        # Typed in-process EventEmitter
│   └── errors.ts                           # mapErrorToResponse: WorkflowError → HTTP
│
└── presentation/http/
    ├── controllers/                        # auth, documents, policies, audit
    ├── middleware/
    │   └── auth.plugin.ts                  # JWT verification + actor context
    └── lib/                                # logger, http helpers, error-map

tests/
├── domain/                                 # Entity invariant tests — pure, no mocks
├── application/                            # Workflow tests with in-memory port fakes
├── infra/                                  # Repository integration tests (real PostgreSQL)
│   └── helpers/db.ts                       # Test DB setup/teardown
├── presentation/http/lib/                  # mapErrorToResponse contract tests
└── helpers/
    ├── factories.ts                        # faker-based entity factories
    └── mocks.ts                            # In-memory repository implementations
```

---

## Testing

```bash
bun test            # run all tests
bun test --watch    # re-run on file changes
```

| Suite                        | What is tested                                              |
| ---------------------------- | ----------------------------------------------------------- |
| `domain/`                    | Entity invariants and domain service logic — pure, no mocks |
| `application/`               | Workflow use-cases with in-memory repository fakes          |
| `infra/*.repository.test.ts` | Drizzle adapters against a real PostgreSQL instance         |
| `presentation/http/lib/`     | `mapErrorToResponse` — all error variants and body shapes   |

---

## Database Management

```bash
bun run db:generate   # generate a migration from schema changes
bun run db:migrate    # apply pending migrations
bun run db:studio     # open Drizzle Studio in the browser
```

---

## Production Deployment

```bash
docker build -t document-management-api .
docker run -p 3000:3000 --env-file .env.production document-management-api
```

The image runs `drizzle-kit migrate` before starting the server. For production, consider running migrations as a separate pre-deploy step.
