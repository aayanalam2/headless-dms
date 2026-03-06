import { Option as O } from "effect";
import type { Document } from "./document.entity.ts";
import type { UserId } from "@domain/utils/refined.types.ts";

export function isOwner(document: Document, actorId: UserId): boolean {
  return document.ownerId === actorId;
}

export function isDeleted(document: Document): boolean {
  return O.isSome(document.deletedAt);
}

export function isActive(document: Document): boolean {
  return O.isNone(document.deletedAt);
}

export function hasVersion(document: Document): boolean {
  return O.isSome(document.currentVersionId);
}
