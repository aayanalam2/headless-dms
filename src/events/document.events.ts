// ---------------------------------------------------------------------------
// Domain events emitted by document services.
// Consumers (e.g. audit listener) subscribe without being coupled to the
// emitting service.
// ---------------------------------------------------------------------------

export enum DocumentEvent {
  Uploaded = "document.uploaded",
  VersionCreated = "document.version.created",
  Deleted = "document.deleted",
}

export type DocumentUploadedEvent = {
  readonly actorId: string;
  readonly resourceId: string;
  readonly versionId: string;
  readonly filename: string;
  readonly contentType: string;
};

export type DocumentVersionCreatedEvent = {
  readonly actorId: string;
  readonly resourceId: string;
  readonly versionId: string;
  readonly versionNumber: number;
  readonly filename: string;
};

export type DocumentDeletedEvent = {
  readonly actorId: string;
  readonly resourceId: string;
};

export type DocumentEventMap = {
  [DocumentEvent.Uploaded]: DocumentUploadedEvent;
  [DocumentEvent.VersionCreated]: DocumentVersionCreatedEvent;
  [DocumentEvent.Deleted]: DocumentDeletedEvent;
};
