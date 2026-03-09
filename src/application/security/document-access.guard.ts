import { Effect as E, Option as O, pipe } from "effect";
import type { IDocumentRepository } from "@domain/document/document.repository.ts";
import type { Document } from "@domain/document/document.entity.ts";
import { DocumentAccessService } from "@domain/services/document-access.service.ts";
import { PermissionAction } from "@domain/access-policy/value-objects/permission-action.vo.ts";
import type { DocumentId } from "@domain/utils/refined.types.ts";
import type { Actor } from "@application/shared/actor.ts";

export type GuardErrors<Err> = {
  readonly notFound: (resource: string) => Err;
  readonly accessDenied: (reason: string) => Err;
  readonly unavailable: (cause?: unknown) => Err;
};

export class DocumentAccessGuard {
  constructor(private readonly documentRepo: IDocumentRepository) {}

  require<Err>(
    documentId: DocumentId,
    actor: Actor,
    action: PermissionAction,
    errors: GuardErrors<Err>,
  ): E.Effect<Document, Err> {
    return pipe(
      this.documentRepo.findActiveByIdWithPolicies(documentId, actor.userId),
      E.mapError((e) => errors.unavailable(e)),
      E.flatMap(
        O.match({
          onNone: () => E.fail(errors.notFound(`Document '${documentId}'`)),
          onSome: ({ document, policies }) =>
            DocumentAccessService.evaluate(
              { id: actor.userId, role: actor.role },
              policies,
              document,
              action,
            )
              ? E.succeed(document)
              : E.fail(
                  errors.accessDenied(
                    `User '${actor.userId}' cannot ${action} document '${documentId}'`,
                  ),
                ),
        }),
      ),
    );
  }
}
