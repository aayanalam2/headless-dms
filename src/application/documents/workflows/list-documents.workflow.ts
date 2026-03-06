import { Effect, pipe } from "effect";
import type { IDocumentRepository } from "@domain/document/document.repository.ts";
import { Role } from "@domain/utils/enums.ts";
import { parsePagination } from "@domain/utils/pagination.ts";
import { toPaginatedDocumentsDTO, type PaginatedDocumentsDTO } from "../dtos/document.dto.ts";
import { ListDocumentsQuerySchema, type ListDocumentsQueryEncoded } from "../dtos/commands.dto.ts";
import { decodeCommand } from "@application/shared/decode.ts";
import {
  DocumentWorkflowError,
  type DocumentWorkflowError as WorkflowError,
} from "../document-workflow.errors.ts";

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
      const pagination = parsePagination(query);
      const effectiveOwnerId =
        query.actor.role !== Role.Admin ? query.actor.userId : query.ownerId;
      const search =
        effectiveOwnerId !== undefined
          ? deps.documentRepo.findByOwner(effectiveOwnerId, pagination)
          : deps.documentRepo.search(query.name?.trim() ?? "", pagination);

      return pipe(
        search,
        Effect.mapError((e) => DocumentWorkflowError.unavailable("repo.listDocuments", e)),
        Effect.map(toPaginatedDocumentsDTO),
      );
    }),
  );
}
