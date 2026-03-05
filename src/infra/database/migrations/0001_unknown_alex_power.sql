CREATE TYPE "public"."audit_action" AS ENUM('document.upload', 'document.version.create', 'document.delete');--> statement-breakpoint
CREATE TYPE "public"."audit_resource_type" AS ENUM('document');--> statement-breakpoint
ALTER TABLE "audit_logs" ALTER COLUMN "action" SET DATA TYPE "public"."audit_action" USING "action"::"public"."audit_action";--> statement-breakpoint
ALTER TABLE "audit_logs" ALTER COLUMN "resource_type" SET DATA TYPE "public"."audit_resource_type" USING "resource_type"::"public"."audit_resource_type";--> statement-breakpoint
ALTER TABLE "audit_logs" ALTER COLUMN "resource_id" SET DATA TYPE uuid USING "resource_id"::uuid;