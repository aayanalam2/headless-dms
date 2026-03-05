export enum BaseErrorTags {
  NotFound = "NotFound",
  AlreadyExists = "AlreadyExists",
  Validation = "Validation",
  AccessDenied = "AccessDenied",
  Conflict = "Conflict",
}

export abstract class DomainError extends Error {
  abstract readonly _tag: string;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    // Restore prototype chain so `instanceof` checks work correctly after TS
    // compilation to ES5/CJS targets.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ---------------------------------------------------------------------------
// General-purpose shared domain errors
//
// Sub-domains define their own more specific errors (e.g. DocumentNotFoundError)
// but these cover cross-cutting concerns.
// ---------------------------------------------------------------------------

/** A lookup by ID found no matching entity. */
export class NotFoundError extends DomainError {
  readonly _tag = BaseErrorTags.NotFound as const;
  constructor(message: string) {
    super(message);
  }
}

/** An operation would create a duplicate of a unique entity. */
export class AlreadyExistsError extends DomainError {
  readonly _tag = BaseErrorTags.AlreadyExists as const;
  constructor(message: string) {
    super(message);
  }
}

/** A field or value failed a domain invariant check. */
export class ValidationError extends DomainError {
  readonly _tag = BaseErrorTags.Validation as const;
  constructor(message: string) {
    super(message);
  }
}

/** An actor attempted an operation they are not authorised to perform. */
export class AccessDeniedError extends DomainError {
  readonly _tag = BaseErrorTags.AccessDenied as const;
  constructor(message: string) {
    super(message);
  }
}

/** A state conflict prevented the operation from succeeding. */
export class ConflictError extends DomainError {
  readonly _tag = BaseErrorTags.Conflict as const;
  constructor(message: string) {
    super(message);
  }
}

/** Union of all shared domain errors. */
export type AnyDomainError =
  | NotFoundError
  | AlreadyExistsError
  | ValidationError
  | AccessDeniedError
  | ConflictError;
