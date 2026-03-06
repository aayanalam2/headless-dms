# Document Management API

A headless REST API for uploading, versioning, searching, and securely downloading files. Built on **Domain-Driven Design**, **Ports & Adapters (Hexagonal Architecture)**, and **functional programming** with [Effect](https://effect.website). All domain logic is pure and testable in isolation; infrastructure is a pluggable detail.

---

## Features

| Capability                    | Details                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------- |
| **File upload**               | Multipart upload with SHA-256 checksum, MIME-type validation, and deterministic S3 key generation       |
| **Immutable versioning**      | Every upload creates a new version; existing objects in S3 are never overwritten                        |
| **Presigned downloads**       | Time-limited (default 5 min) pre-signed URLs — files never pass through the API server                  |
| **Access policies**           | Fine-grained Allow/Deny policies scoped to a user or a role per document                                |
| **Role-based defaults**       | `admin` bypasses all policy checks; `user` falls through to subject → role → owner precedence           |
| **Rich search**               | Filter by name (ILIKE), content-type, owner, tags (array containment), and arbitrary JSONB metadata     |
| **Soft delete**               | Documents are marked `deleted_at`; all queries exclude them without physically removing data            |
| **Audit log**                 | Append-only record of every significant action, written via a decoupled event bus                       |
| **Structured logging**        | pino NDJSON to stdout in production; pretty-printed in development                                      |
| **Swagger UI**                | Auto-generated at `/swagger` for interactive exploration                                                |

---

## Architecture

### Layered overview

The codebase is divided into four concentric layers. **Dependencies only point inward** — the domain knows nothing about infrastructure or HTTP.

```
┌──────────────────────────────────────────────────────────────────┐
│  Presentation  (src/presentation/)                               │
│  Elysia HTTP routes. Parses requests → calls Workflows →         │
│  maps WorkflowError to an HTTP status code.                      │
└───────────────────────────────┬──────────────────────────────────┘
                                │ depends on
┌───────────────────────────────▼──────────────────────────────────┐
│  Application  (src/application/)                                 │
│  Workflow classes orchestrate use-cases as flat Effect pipelines. │
│  Helpers, DTOs, and event listeners live here.                   │
│  No dependency on HTTP, Drizzle, or S3.                          │
└──────────┬────────────────────────────────────┬──────────────────┘
           │ depends on                          │ depends on
┌──────────▼──────────────┐        ┌────────────▼─────────────────┐
│  Domain  (src/domain/)  │        │  Infra  (src/infra/)         │
│  Entities, value        │        │  Implements domain ports:    │
│  objects, repository    │        │  Drizzle repositories, S3    │
│  interfaces (ports),    │        │  storage, DI container,      │
│  domain services,       │◄───────│  event bus.                  │
│  domain errors.         │        │  No business logic.          │
│  Zero external deps.    │        └──────────────────────────────┘
└─────────────────────────┘
```

### Layer responsibilities

| Layer            | Directory             | Responsibility                                                                                                |
| ---------------- | --------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Domain**       | `src/domain/`         | Entities, value objects, repository interfaces (ports), domain services, domain errors. No I/O of any kind.  |
| **Application**  | `src/application/`    | Workflow classes that compose domain operations into use-cases. DTOs, helpers, event listeners.               |
| **Infra**        | `src/infra/`          | Adapter implementations: Drizzle ORM repositories, S3 storage, tsyringe DI container, event bus.             |
| **Presentation** | `src/presentation/`   | Elysia HTTP routes. Authentication middleware, error mapping, Swagger registration.                           |

### Ports & Adapters

Every dependency that crosses from the application layer into infrastructure is expressed as an **interface (port)** defined in the domain:

```
src/domain/document/document.repository.ts     ← port (interface)
src/infra/repositories/drizzle-document.repository.ts  ← adapter (implementation)

src/infra/repositories/storage.port.ts         ← port (interface)
src/infra/repositories/s3.storage.ts            ← adapter (implementation)
```

The DI container (`src/infra/di/container.ts`) wires adapters to their ports at startup using **tsyringe** tokens. Workflows depend only on the port interface — swapping the adapter (e.g. replacing MinIO with AWS S3, or using an in-memory fake in tests) requires no changes to any workflow.

---

## Domain Model

### Entities

Entities are immutable value-carrying objects created and validated through **Effect Schema**. Construction always returns `Effect<Entity, ParseError>` — a malformed entity cannot exist at runtime.

| Entity              | Key invariants                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| `User`              | Branded `UserId`, validated `Email`, hashed password, `Role` enum (`admin` \| `user`)             |
| `Document`          | Branded `DocumentId`, owner reference, optional `currentVersionId`, soft-delete timestamp          |
| `DocumentVersion`   | Branded `VersionId`, immutable `BucketKey`, `Checksum`, MIME type, version number                 |
| `AccessPolicy`      | Exactly one of `subjectId` or `subjectRole` must be set (domain invariant enforced on creation)   |

### Value objects & branded types

All domain IDs and validated strings are **nominal (branded) types** defined in `src/domain/utils/refined.types.ts`. Invalid types are rejected at the boundary — it is a compile-time error to pass a `UserId` where a `DocumentId` is expected.

```typescript
export const DocumentId = createRefinedType("DocumentId", S.UUID);
export type DocumentId = typeof DocumentId.$infer; // string & Brand<"DocumentId">
```

### Domain services

Logic that spans multiple aggregates lives in pure domain services:

| Service                  | Responsibility                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| `DocumentAccessService`  | Evaluates `Effect` ↔ `Allow/Deny` policy precedence for a given actor + document + action |

---

## Application Layer

### Workflows

Each bounded context exposes a single injectable **Workflow class** with one method per use-case. Methods return `Effect<DTO, WorkflowError>` — no HTTP types, no Drizzle types.

```typescript
@injectable()
export class DocumentWorkflows {
  constructor(
    @inject(TOKENS.DocumentRepository) private readonly documentRepo: IDocumentRepository,
    @inject(TOKENS.StorageService)     private readonly storage: IStorageService,
    // ...
  ) {}

  upload(raw: UploadDocumentMetaEncoded): Effect.Effect<DocumentDTO, WorkflowError> { ... }
  list(raw: ListDocumentsQueryEncoded):   Effect.Effect<PaginatedDocumentsDTO, WorkflowError> { ... }
  // ...
}
```

### Flat Effect pipelines

All workflow logic is written as flat `pipe()` chains of named helper steps. There are no `Effect.gen` generators, no `yield*`, and no nested `if/else` inside pipelines. Every step has a single semantic name that reads like a sentence:

```typescript
getDocument(raw) {
  return pipe(
    decodeCommand(GetDocumentQuerySchema, raw, DocumentWorkflowError.invalidInput),
    Effect.flatMap((query) =>
      pipe(
        requireAccessibleDocument(this.documentRepo, this.policyRepo, this.userRepo,
          query.documentId, query.actor, PermissionAction.Read),
        Effect.map(toDocumentDTO),
      ),
    ),
  );
}
```

### Helpers

Module-level named step functions are extracted to `*.helpers.ts` files so the workflow file contains only orchestration. All three helper files share common combinators from `src/application/shared/workflow.helpers.ts`:

| Combinator        | Purpose                                                                     |
| ----------------- | --------------------------------------------------------------------------- |
| `makeUnavailable` | Lifts an error constructor into a curried `op → cause → E` factory          |
| `requireFound`    | Repo lookup + `Option` unwrap; maps absence to a `notFound` domain error    |
| `requireAbsent`   | Inverse — asserts the row does not exist; maps presence to a `duplicate` error |
| `assertOrFail`    | Boolean guard that passes a value through on success                        |
| `assertGuard`     | Void specialisation of `assertOrFail` (role-only gates)                     |

Each `*.helpers.ts` then reduces to partial applications:

```typescript
// access-policy.helpers.ts
export const unavailable = makeUnavailable(AccessPolicyWorkflowError.unavailable);

export function requirePolicy(repo, policyId) {
  return requireFound(
    repo.findById(policyId),
    unavailable("policyRepo.findById"),
    () => AccessPolicyWorkflowError.notFound(`Access policy '${policyId}'`),
  );
}
```

### Event bus & audit

The application layer communicates cross-cutting concerns (audit logging) through a **typed in-process event bus** rather than direct coupling. Workflow helpers emit domain events; `audit.listener.ts` subscribes and writes audit records independently:

```
grantAccess workflow
  └─ emitPolicyGranted(event)
       └─ eventBus.emit(AccessPolicyEvent.Granted, event)
            └─ audit.listener.ts: on(Granted) → auditRepo.save(...)
```

This means audit behaviour can be changed, tested, or replaced without touching any workflow.

---

## Tech Stack

| Concern           | Technology                                      |
| ----------------- | ----------------------------------------------- |
| Runtime           | [Bun](https://bun.sh) v1.x                      |
| HTTP framework    | [Elysia](https://elysiajs.com) v1.4              |
| Effect system     | [Effect](https://effect.website) v3              |
| Schema / decoding | Effect Schema (replaces Zod at domain boundary) |
| Branded types     | `@carbonteq/refined-type`                       |
| DI container      | tsyringe (reflect-metadata)                     |
| ORM               | [Drizzle ORM](https://orm.drizzle.team)          |
| Database          | PostgreSQL 16                                   |
| Object storage    | MinIO (dev) / AWS S3 (prod)                     |
| Auth              | HS256 JWT via `@elysiajs/jwt`                   |
| Password hashing  | bcryptjs                                        |
| Logging           | pino v10 + pino-pretty (dev)                    |
| Testing           | Bun test runner + `@faker-js/faker`             |

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

All variables are validated at startup via Effect Schema — the server exits immediately if a required variable is missing or malformed.

| Variable               | Required | Default       | Description                                                  |
| ---------------------- | -------- | ------------- | ------------------------------------------------------------ |
| `DATABASE_URL`         | ✅       | —             | PostgreSQL connection string                                 |
| `JWT_SECRET`           | ✅       | —             | Secret for signing JWTs (≥ 32 chars in production)           |
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

All endpoints (except `/auth/*`) require `Authorization: Bearer <token>`. Obtain a token via `POST /auth/login`.

### Auth

| Method | Path             | Auth | Description                                                                        |
| ------ | ---------------- | ---- | ---------------------------------------------------------------------------------- |
| `POST` | `/auth/register` | None | Register a new user. Body: `{ email, password }`                                   |
| `POST` | `/auth/login`    | None | Login. Returns `{ token, user }`. Always 401 on any failure (no user enumeration). |

### Documents

| Method   | Path                                          | Auth           | Description                                                                    |
| -------- | --------------------------------------------- | -------------- | ------------------------------------------------------------------------------ |
| `POST`   | `/documents`                                  | Any            | Upload a new document (multipart: `file`, optional `name`, `tags`, `metadata`) |
| `GET`    | `/documents`                                  | Any            | Search / list documents with pagination                                        |
| `GET`    | `/documents/:id`                              | Any            | Get a document by ID                                                           |
| `GET`    | `/documents/:id/download`                     | Any            | Pre-signed URL for the current version                                         |
| `DELETE` | `/documents/:id`                              | Admin          | Soft-delete a document                                                         |
| `POST`   | `/documents/:id/versions`                     | Owner or Admin | Upload a new version of an existing document                                   |
| `GET`    | `/documents/:id/versions`                     | Any            | List all versions of a document                                                |
| `GET`    | `/documents/:id/versions/:versionId/download` | Any            | Pre-signed URL for a specific version                                          |

#### Search query parameters (`GET /documents`)

| Parameter     | Type   | Description                                                         |
| ------------- | ------ | ------------------------------------------------------------------- |
| `name`        | string | Case-insensitive substring match                                    |
| `contentType` | string | Exact MIME type match                                               |
| `tags`        | string | Comma-separated list; returns docs containing **all** provided tags |
| `metadata`    | string | URL-encoded JSON object; JSONB containment filter                   |
| `ownerId`     | string | Filter by owner (admin only; regular users always see their own)    |
| `page`        | number | 1-based page number (default: 1)                                    |
| `limit`       | number | Items per page, 1–100 (default: 20)                                 |

### Access Policies

| Method   | Path                      | Auth  | Description                                              |
| -------- | ------------------------- | ----- | -------------------------------------------------------- |
| `POST`   | `/policies`               | Any   | Grant a subject or role access to a document             |
| `PATCH`  | `/policies/:id`           | Any   | Change the effect (Allow/Deny) of an existing policy     |
| `DELETE` | `/policies/:id`           | Any   | Revoke a policy                                          |
| `GET`    | `/policies/check`         | Any   | Check whether the actor can perform an action            |
| `GET`    | `/policies/document/:id`  | Any   | List all policies for a document                         |

### Audit

| Method | Path     | Auth  | Description                                                                  |
| ------ | -------- | ----- | ---------------------------------------------------------------------------- |
| `GET`  | `/audit` | Admin | List audit log entries. Optional `?resourceType=` and `?resourceId=` filters |

---

## Project Structure

```
src/
├── domain/                         # Inner ring — zero external dependencies
│   ├── user/
│   │   ├── user.entity.ts          # User aggregate, schema-validated construction
│   │   ├── user.errors.ts          # Domain error types
│   │   ├── user.guards.ts          # Pure boolean predicates
│   │   └── user.repository.ts      # Port (interface) — implemented in infra
│   ├── document/
│   │   ├── document.entity.ts
│   │   ├── document-version.entity.ts
│   │   ├── document.repository.ts  # Port
│   │   └── ...
│   ├── access-policy/
│   │   ├── access-policy.entity.ts
│   │   ├── access-policy.repository.ts  # Port
│   │   └── value-objects/
│   ├── events/                     # Domain event types (DocumentEvent, AccessPolicyEvent)
│   ├── services/
│   │   └── document-access.service.ts   # Cross-aggregate policy evaluation
│   └── utils/
│       ├── refined.types.ts        # Branded type constructors
│       ├── enums.ts                # Role, PermissionEffect, …
│       └── pagination.ts           # PaginationParams + withPagination HOF
│
├── application/                    # Use-case orchestration
│   ├── shared/
│   │   ├── decode.ts               # decodeCommand — schema decode + error mapping
│   │   ├── actor.ts                # Actor type shared across workflows
│   │   └── workflow.helpers.ts     # makeUnavailable, requireFound, requireAbsent,
│   │                               #   assertOrFail, assertGuard
│   ├── documents/
│   │   ├── document.workflows.ts   # DocumentWorkflows injectable class
│   │   ├── document.helpers.ts     # Named pipeline steps
│   │   ├── document-workflow.errors.ts
│   │   └── dtos/
│   ├── access-policy/
│   │   ├── access-policy.workflows.ts
│   │   ├── access-policy.helpers.ts
│   │   └── dtos/
│   ├── users/
│   │   ├── user.workflows.ts
│   │   ├── user.helpers.ts
│   │   └── dtos/
│   └── audit/
│       ├── audit.workflows.ts      # AuditWorkflows (listAuditLogs)
│       ├── audit.listener.ts       # Event bus subscribers → audit repo
│       └── dtos/
│
├── infra/                          # Outer ring — all I/O
│   ├── di/
│   │   ├── container.ts            # tsyringe wiring: ports → adapters
│   │   └── tokens.ts               # Injection token constants
│   ├── repositories/               # Drizzle adapter implementations
│   │   ├── drizzle-document.repository.ts
│   │   ├── drizzle-user.repository.ts
│   │   ├── drizzle-access-policy.repository.ts
│   │   ├── drizzle-audit.repository.ts
│   │   ├── s3.storage.ts           # S3 adapter
│   │   └── storage.port.ts         # Storage port (interface)
│   ├── database/
│   │   ├── schema.ts               # Drizzle table definitions
│   │   ├── models/                 # Inferred row types
│   │   └── migrations/
│   ├── event-bus.ts                # Typed in-process EventEmitter
│   ├── errors.ts                   # mapErrorToResponse: WorkflowError → HTTP
│   └── config/
│       └── env.ts                  # Startup-validated environment config
│
└── presentation/
    └── http/                       # Elysia route definitions + auth middleware

tests/
├── domain/                         # Entity invariant tests (no mocks needed)
│   ├── user.entity.test.ts
│   ├── document.entity.test.ts
│   ├── access-policy.entity.test.ts
│   └── document-access.service.test.ts
├── application/                    # Workflow tests with mocked ports
│   └── users/
├── infra/                          # Repository integration tests (real DB)
│   ├── user.repository.test.ts
│   ├── document.repository.test.ts
│   └── access-policy.repository.test.ts
├── presentation/
│   └── http/                       # HTTP contract tests
└── helpers/
    ├── factories.ts                # faker-based entity factories
    └── mocks.ts                    # In-memory port implementations
```

---

## Design Decisions

### Inward dependencies only

The domain layer imports nothing outside of `effect` and `@carbonteq/refined-type`. Infra imports the domain. The application layer imports both. Nothing in the domain or application layers ever imports from `infra` or `presentation` — runtime behaviour is injected through ports.

### Typed error channels with Effect

Every function that can fail returns `Effect<T, DomainError>` rather than throwing. This makes failure paths:

- **Explicit** — the compiler enforces exhaustive handling
- **Composable** — `flatMap` chains without nested try/catch
- **Uniform** — the presentation layer runs effects and maps `WorkflowError` to HTTP status with a single `mapErrorToResponse` function

### Flat `pipe()` — no generators

All workflow and helper code is written as flat `pipe()` chains. Avoiding `Effect.gen` / `yield*` keeps all steps visible at the same indentation level and gives each step a precise, searchable name:

```typescript
revokeAccess(raw) {
  return pipe(
    decodeCommand(RevokeAccessCommandSchema, raw, AccessPolicyWorkflowError.invalidInput),
    Effect.flatMap((cmd) =>
      pipe(
        requirePolicy(this.policyRepo, cmd.policyId),
        Effect.flatMap((policy) => requireDocForPolicy(this.documentRepo, policy.documentId)),
        Effect.flatMap((document) => assertPolicyManager(document, cmd.actor)),
        Effect.flatMap(() => pipe(
          this.policyRepo.delete(cmd.policyId),
          Effect.mapError(unavailable("policyRepo.delete")),
        )),
        Effect.flatMap(() => emitPolicyRevoked({ ... })),
      ),
    ),
  );
}
```

### Access policy evaluation

Admins bypass all checks. For non-admins, `DocumentAccessService.evaluate` applies a tiered precedence model to the document's policies:

1. Subject-specific `Deny` — immediate block
2. Subject-specific `Allow` — immediate pass
3. Role-based `Deny` — block
4. Role-based `Allow` — pass
5. Document ownership — pass
6. Default — deny

### Immutable S3 versioning

Every document version gets a unique, deterministic S3 key: `{documentId}/{versionId}/{encodedFilename}`. Objects are **never overwritten**. Deleting a version row in the database leaves the underlying object intact and recoverable.

### Decoupled audit via event bus

Workflows never write to the audit log directly. They emit typed domain events onto an in-process event bus (`src/infra/event-bus.ts`). `audit.listener.ts` subscribes to all event types and writes audit records. Adding a new audited operation requires only adding an event emission to the workflow — the listener registers itself at startup with no changes to the workflow class.

### Pagination HOF

Rather than repeating `parsePagination` + `Effect.map(toDTO)` in every list workflow, a generic `withPagination` higher-order function in `pagination.ts` encapsulates the pattern:

```typescript
withPagination(query, (pagination) => repo.search(q, pagination), toPaginatedDocumentsDTO)
```

---

## Testing

```bash
bun test            # run all tests
bun test --watch    # re-run on file changes
```

| Suite                            | What is tested                                                                          |
| -------------------------------- | --------------------------------------------------------------------------------------- |
| `domain/*.test.ts`               | Entity invariants and domain service logic — no mocks, no I/O                           |
| `application/users/*.test.ts`    | Workflow logic with in-memory repository fakes                                          |
| `infra/*.repository.test.ts`     | Repository adapters against a real PostgreSQL instance (integration)                    |
| `presentation/http/*.test.ts`    | HTTP contract tests — status codes, body shapes, auth middleware                        |
| `helpers/mocks.ts`               | Shared in-memory port implementations used across workflow unit tests                  |

Domain tests require no mocks because entities are pure functions. Repository integration tests use the same database provisioned by `docker compose`.

---

## Production Deployment

```bash
# Build the image
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

## Database Management

```bash
bun run db:generate   # generate a new migration from schema changes
bun run db:migrate    # apply pending migrations
bun run db:studio     # open Drizzle Studio (browser-based DB explorer)
```

## Features

| Capability                    | Details                                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------- |
| **File upload**               | Multipart upload with SHA-256 checksum, MIME-type validation, and automatic S3 key generation           |
| **Immutable versioning**      | Every upload creates a new version; existing objects in S3 are never overwritten                        |
| **Presigned downloads**       | Time-limited (default 5 min) pre-signed URLs — files never pass through the API server                  |
| **Role-based access control** | `admin` can do everything; `user` can only read/write their own documents; only `admin` can hard-delete |
| **Rich search**               | Filter by name (ILIKE), content-type, owner, tags (array containment), and arbitrary JSONB metadata     |
| **Soft delete**               | Documents are marked `deleted_at`; all queries exclude them without physically removing data            |
| **Audit log**                 | Append-only record of every significant action (upload, version, delete)                                |
| **Structured logging**        | pino NDJSON to stdout in production; pretty-printed in development                                      |
| **Swagger UI**                | Auto-generated at `/swagger` for interactive exploration                                                |

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

| Layer          | Directory          | Responsibility                                                             |
| -------------- | ------------------ | -------------------------------------------------------------------------- |
| **Controller** | `src/controllers/` | Parse HTTP input, call services, return DTOs or error responses            |
| **Service**    | `src/services/`    | Business rules, permission checks, upload orchestration, search parsing    |
| **Model**      | `src/models/`      | Database schema (Drizzle), repository queries, S3 storage operations       |
| **View**       | `src/dto/`         | DTO types and mapper functions — the outbound JSON shape of every response |

Services are pure functions that return `Effect<T, AppError>` — no I/O, no HTTP, tested in isolation without mocking. Repositories and storage are the only places where side effects occur.

---

## Tech Stack

| Layer             | Technology                              |
| ----------------- | --------------------------------------- |
| Runtime           | [Bun](https://bun.sh) v1.x              |
| HTTP framework    | [Elysia](https://elysiajs.com) v1.4     |
| Effect system     | [Effect](https://effect.website) v3     |
| ORM               | [Drizzle ORM](https://orm.drizzle.team) |
| Database          | PostgreSQL 16                           |
| Object storage    | MinIO (dev) / AWS S3 (prod)             |
| Auth              | HS256 JWT via `@elysiajs/jwt`           |
| Password hashing  | bcryptjs                                |
| Schema validation | Zod v4 + `@carbonteq/refined-type`      |
| Logging           | pino v10 + pino-pretty (dev)            |
| Testing           | Bun test runner + `@faker-js/faker`     |

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

| Variable               | Required | Default       | Description                                                  |
| ---------------------- | -------- | ------------- | ------------------------------------------------------------ |
| `DATABASE_URL`         | ✅       | —             | PostgreSQL connection string                                 |
| `JWT_SECRET`           | ✅       | —             | Secret for signing JWTs (≥32 chars in production)            |
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

All document endpoints require an `Authorization: Bearer <token>` header. Obtain a token via `/auth/login`.

### Auth

| Method | Path             | Auth | Description                                                                       |
| ------ | ---------------- | ---- | --------------------------------------------------------------------------------- |
| `POST` | `/auth/register` | None | Register a new user. Body: `{ email, password, role? }`                           |
| `POST` | `/auth/login`    | None | Login. Returns `{ token, user }`. Always 401 on any failure (no user enumeration) |

### Documents

| Method   | Path                                          | Auth           | Description                                                                    |
| -------- | --------------------------------------------- | -------------- | ------------------------------------------------------------------------------ |
| `POST`   | `/documents`                                  | Any            | Upload a new document (multipart: `file`, optional `name`, `tags`, `metadata`) |
| `GET`    | `/documents`                                  | Any            | Search / list documents with pagination                                        |
| `GET`    | `/documents/:id`                              | Any            | Get a document by ID                                                           |
| `GET`    | `/documents/:id/download`                     | Any            | Pre-signed URL for the current version                                         |
| `DELETE` | `/documents/:id`                              | Admin          | Soft-delete a document                                                         |
| `POST`   | `/documents/:id/versions`                     | Owner or Admin | Upload a new version of an existing document                                   |
| `GET`    | `/documents/:id/versions`                     | Any            | List all versions of a document                                                |
| `GET`    | `/documents/:id/versions/:versionId/download` | Any            | Pre-signed URL for a specific version                                          |

#### Search query parameters (`GET /documents`)

| Parameter     | Type   | Description                                                         |
| ------------- | ------ | ------------------------------------------------------------------- |
| `name`        | string | Case-insensitive substring match                                    |
| `contentType` | string | Exact MIME type match                                               |
| `tags`        | string | Comma-separated list; returns docs containing **all** provided tags |
| `metadata`    | string | URL-encoded JSON object; JSONB containment filter                   |
| `ownerId`     | string | Filter by owner (admin only; regular users always see their own)    |
| `page`        | number | 1-based page number (default: 1)                                    |
| `limit`       | number | Items per page, 1–100 (default: 20)                                 |
| `sortBy`      | string | `createdAt` \| `updatedAt` \| `name` (default: `createdAt`)         |
| `sortOrder`   | string | `asc` \| `desc` (default: `desc`)                                   |

### Audit

| Method | Path     | Auth  | Description                                                                  |
| ------ | -------- | ----- | ---------------------------------------------------------------------------- |
| `GET`  | `/audit` | Admin | List audit log entries. Optional `?resourceType=` and `?resourceId=` filters |

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
Option.fromNullable(query.name);

// Domain: consume safely without null checks
Option.getOrElse(input.name, () => file.name);
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

| File                              | Coverage                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------- |
| `auth.service.test.ts`            | `hashPassword`, `verifyPassword`, `buildJwtClaims`                                          |
| `document.service.test.ts`        | RBAC (`canRead/Write/Delete`), `buildBucketKey`, `nextVersionNumber`, `validateContentType` |
| `document.upload.service.test.ts` | `parseOptionalJson`, `parseTags`                                                            |
| `search.service.test.ts`          | `parseSearchParams` — all pagination, sorting, filtering, and validation edge cases         |
| `http.test.ts`                    | `mapErrorToResponse` — all 6 `AppError` variants, body shape invariants                     |
| `dto.test.ts`                     | `toUserDTO`, `toDocumentDTO`, `toVersionDTO`, `toPaginatedDocumentsDTO`                     |

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
