// ---------------------------------------------------------------------------
// DI Tokens
//
// Symbol-keyed injection tokens for tsyringe. Using Symbols ensures that
// token lookups are always unambiguous, even if two interfaces happen to
// share the same name.
//
// Usage:
//   @inject(TOKENS.DocumentRepository) private repo: IDocumentRepository
// ---------------------------------------------------------------------------

export const TOKENS = {
  // -------------------------------------------------------------------------
  // Repositories
  // -------------------------------------------------------------------------
  DocumentRepository: Symbol("DocumentRepository"),
  UserRepository: Symbol("UserRepository"),
  AuditRepository: Symbol("AuditRepository"),
  AccessPolicyRepository: Symbol("AccessPolicyRepository"),

  // -------------------------------------------------------------------------
  // Infrastructure services
  // -------------------------------------------------------------------------
  StorageService: Symbol("StorageService"),
  AuthService: Symbol("AuthService"),

  // -------------------------------------------------------------------------
  // Application workflow classes
  // -------------------------------------------------------------------------
  DocumentWorkflows: Symbol("DocumentWorkflows"),
  UserWorkflows: Symbol("UserWorkflows"),
  AuditWorkflows: Symbol("AuditWorkflows"),
  AccessPolicyWorkflows: Symbol("AccessPolicyWorkflows"),
} as const;

export type TokenKey = keyof typeof TOKENS;
