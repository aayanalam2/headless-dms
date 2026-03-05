import { pgEnum } from "drizzle-orm/pg-core";
import { AuditAction, AuditResourceType, Role } from "@domain/utils/enums.ts";
import {
  PermissionAction,
  PolicyEffect,
} from "@domain/access-policy/value-objects/permission-action.vo.ts";

export const roleEnum = pgEnum("role", [Role.Admin, Role.User]);

export const permissionActionEnum = pgEnum("permission_action", [
  PermissionAction.Read,
  PermissionAction.Write,
  PermissionAction.Delete,
  PermissionAction.Share,
]);

export const policyEffectEnum = pgEnum("policy_effect", [PolicyEffect.Allow, PolicyEffect.Deny]);

export const auditActionEnum = pgEnum("audit_action", [
  AuditAction.DocumentUpload,
  AuditAction.DocumentVersionCreate,
  AuditAction.DocumentDelete,
]);

export const auditResourceTypeEnum = pgEnum("audit_resource_type", [
  AuditResourceType.Document,
]);
