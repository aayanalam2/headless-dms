import { Option } from "effect";
import type { Document } from "./document.entity.ts";
import type { UserId } from "@domain/utils/refined.types.ts";


export function isOwner(document: Document, actorId: UserId): boolean {
  return document.ownerId === actorId;
}

export function isDeleted(document: Document): boolean {
  return Option.isSome(document.deletedAt);
}

export function isActive(document: Document): boolean {
  return Option.isNone(document.deletedAt);
}

export function hasVersion(document: Document): boolean {
  return Option.isSome(document.currentVersionId);
}
