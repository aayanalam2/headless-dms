// ---------------------------------------------------------------------------
// Domain events emitted by document services.
// Consumers (e.g. audit listener) subscribe without being coupled to the
// emitting service.
// ---------------------------------------------------------------------------

import type { UserId, DocumentId, VersionId } from "@domain/utils/refined.types.ts";

export enum DocumentEvent {
  Uploaded = "document.uploaded",
  VersionCreated = "document.version.created",
  Deleted = "document.deleted",
}

export type DocumentUploadedEvent = {
  readonly actorId: UserId;
  readonly resourceId: DocumentId;
  readonly versionId: VersionId;
  readonly filename: string;
  readonly contentType: string;
};

export type DocumentVersionCreatedEvent = {
  readonly actorId: UserId;
  readonly resourceId: DocumentId;
  readonly versionId: VersionId;
  readonly versionNumber: number;
  readonly filename: string;
};

export type DocumentDeletedEvent = {
  readonly actorId: UserId;
  readonly resourceId: DocumentId;
};

export type DocumentEventMap = {
  [DocumentEvent.Uploaded]: DocumentUploadedEvent;
  [DocumentEvent.VersionCreated]: DocumentVersionCreatedEvent;
  [DocumentEvent.Deleted]: DocumentDeletedEvent;
};
