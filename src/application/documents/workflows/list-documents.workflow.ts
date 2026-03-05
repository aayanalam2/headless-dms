import { Effect, pipe } from "effect";
import type { IDocumentRepository } from "@domain/document/document.repository.ts";
import { UserId } from "@domain/utils/refined.types.ts";
import { Role } from "@domain/utils/enums.ts";
import { toPaginatedDocumentsDTO, type PaginatedDocumentsDTO } from "../dtos/document.dto.ts";
import { ListDocumentsQuerySchema, type ListDocumentsQueryEncoded } from "../dtos/commands.dto.ts";
import { decodeCommand } from "@application/shared/decode.ts";
import {
  DocumentWorkflowError,
  type DocumentWorkflowError as WorkflowError,
} from "../document-workflow.errors.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;
const DEFAULT_PAGE = 1;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ListDocumentsDeps = { readonly documentRepo: IDocumentRepository };

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

export function listDocuments(
  deps: ListDocumentsDeps,
  raw: ListDocumentsQueryEncoded,
): Effect.Effect<PaginatedDocumentsDTO, WorkflowError> {
  return pipe(
    decodeCommand(ListDocumentsQuerySchema, raw, DocumentWorkflowError.invalidInput),
    Effect.flatMap((query) => {
      const page = Math.max(1, Math.floor(query.page ?? DEFAULT_PAGE));
      const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(query.limit ?? DEFAULT_LIMIT)));
      const pagination = { page, limit };

      const effectiveOwnerId =
        query.actor.role !== Role.Admin
          ? UserId.create(query.actor.userId).unwrap()
          : query.ownerId !== undefined
            ? UserId.create(query.ownerId).unwrap()
            : undefined;

      const resultEffect =
        effectiveOwnerId !== undefined
          ? deps.documentRepo.findByOwner(effectiveOwnerId, pagination)
          : deps.documentRepo.search(query.name?.trim() ?? "", pagination);

      return pipe(
        resultEffect,
        Effect.mapError((e) => DocumentWorkflowError.unavailable("repo.listDocuments", e)),
        Effect.map(toPaginatedDocumentsDTO),
      );
    }),
  );
}
