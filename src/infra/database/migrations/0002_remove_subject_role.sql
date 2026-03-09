ALTER TABLE "access_policies" DROP CONSTRAINT IF EXISTS "access_policies_subject_xor_chk";--> statement-breakpoint
ALTER TABLE "access_policies" DROP COLUMN IF EXISTS "subject_role";--> statement-breakpoint
ALTER TABLE "access_policies" ALTER COLUMN "subject_id" SET NOT NULL;
