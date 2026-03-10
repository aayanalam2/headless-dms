// ---------------------------------------------------------------------------
// DI Container
//
// Wires up all infrastructure dependencies into the tsyringe container.
// This is the composition root for the application.
//
// Only infrastructure/concrete implementations are registered here.
// Workflow classes decorated with @injectable() are resolved automatically.
// ---------------------------------------------------------------------------

import "reflect-metadata";
import { container } from "tsyringe";
import { TOKENS } from "./tokens.ts";
import type { AppDb } from "@infra/database/utils/connection.ts";
import type { IStorage } from "@infra/repositories/storage.port.ts";
import { DrizzleDocumentRepository } from "@infra/repositories/drizzle-document.repository.ts";
import { DrizzleUserRepository } from "@infra/repositories/drizzle-user.repository.ts";
import { DrizzleAuditRepository } from "@infra/repositories/drizzle-audit.repository.ts";
import { DrizzleAccessPolicyRepository } from "@infra/repositories/drizzle-access-policy.repository.ts";
import { AuthService } from "@infra/services/auth.service.ts";
import { DocumentAccessGuard } from "@application/security/document-access.guard.ts";

// ---------------------------------------------------------------------------
// buildContainer
//
// Called once at startup with fully-constructed infra dependencies.
// Returns the configured container so callers can resolve workflow classes.
// ---------------------------------------------------------------------------

export function buildContainer(db: AppDb, storage: IStorage): typeof container {
  // -------------------------------------------------------------------------
  // Repositories — registered as pre-built values so tsyringe doesn't attempt
  // to construct them (they need `db` which isn't injectable itself).
  // -------------------------------------------------------------------------
  const documentRepo = new DrizzleDocumentRepository(db);
  container.registerInstance(TOKENS.DocumentRepository, documentRepo);
  container.registerInstance(TOKENS.UserRepository, new DrizzleUserRepository(db));
  container.registerInstance(TOKENS.AuditRepository, new DrizzleAuditRepository(db));
  container.registerInstance(TOKENS.AccessPolicyRepository, new DrizzleAccessPolicyRepository(db));

  // -------------------------------------------------------------------------
  // Storage — passed in from the caller (created with s3 config).
  // -------------------------------------------------------------------------
  container.registerInstance(TOKENS.StorageService, storage);

  // -------------------------------------------------------------------------
  // AuthService — singleton; no external deps (reads config internally).
  // -------------------------------------------------------------------------
  container.registerInstance(TOKENS.AuthService, new AuthService());

  // -------------------------------------------------------------------------
  // DocumentAccessGuard — depends on the document repository.
  // -------------------------------------------------------------------------
  container.registerInstance(TOKENS.DocumentAccessGuard, new DocumentAccessGuard(documentRepo));

  return container;
}
