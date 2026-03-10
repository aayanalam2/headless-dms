import { Effect as E } from "effect";
import { makeEmit } from "@application/shared/event.helpers.ts";
import {
  DocumentEvent,
  type DocumentUploadedEvent,
  type DocumentVersionCreatedEvent,
  type DocumentDeletedEvent,
} from "@domain/events/document.events.ts";
import type { DocumentActorCtx } from "@application/shared/actor.ts";
import type {
  UploadContextCommitted,
  VersionUploadCtxCommitted,
} from "../workflows/steps/document.context.steps.ts";

// ---------------------------------------------------------------------------
// Raw event emitters (plain event payload)
// ---------------------------------------------------------------------------

export const emitDocumentUploaded = makeEmit<DocumentUploadedEvent>(DocumentEvent.Uploaded);

export const emitVersionCreated = makeEmit<DocumentVersionCreatedEvent>(
  DocumentEvent.VersionCreated,
);

export const emitDocumentDeleted = makeEmit<DocumentDeletedEvent>(DocumentEvent.Deleted);

// ---------------------------------------------------------------------------
// Context-aware emitters (accept pipeline context objects)
// ---------------------------------------------------------------------------

export const emitUploadedCtx = (ctx: UploadContextCommitted): E.Effect<void, never> =>
  emitDocumentUploaded({
    actorId: ctx.actorId,
    resourceId: ctx.updated.id,
    versionId: ctx.version.id,
    filename: ctx.filename,
    contentType: ctx.updated.contentType,
  });

export const emitVersionCreatedCtx = (
  ctx: Pick<
    VersionUploadCtxCommitted,
    "actor" | "documentId" | "version" | "versionNumber" | "filename"
  >,
): E.Effect<void, never> =>
  emitVersionCreated({
    actorId: ctx.actor.userId,
    resourceId: ctx.documentId,
    versionId: ctx.version.id,
    versionNumber: ctx.versionNumber,
    filename: ctx.filename,
  });

export const emitDocumentDeletedCtx = (ctx: DocumentActorCtx): E.Effect<void, never> =>
  emitDocumentDeleted({ actorId: ctx.actor.userId, resourceId: ctx.documentId });
