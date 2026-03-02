CREATE TYPE "public"."activation_reason" AS ENUM('admin_assigned_or_replied');--> statement-breakpoint
CREATE TYPE "public"."bridge_mode" AS ENUM('escalated');--> statement-breakpoint
CREATE TABLE "conversation_lifecycle" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"intercom_conversation_id" text NOT NULL,
	"last_topic" text NOT NULL,
	"ai_active" boolean DEFAULT false NOT NULL,
	"human_handoff_detected" boolean DEFAULT false NOT NULL,
	"last_customer_message_id" text,
	"last_customer_message_text" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation_threads" ADD COLUMN "bridge_mode" "bridge_mode" DEFAULT 'escalated' NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_threads" ADD COLUMN "activated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "conversation_threads" ADD COLUMN "activation_reason" "activation_reason" DEFAULT 'admin_assigned_or_replied' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_lifecycle_intercom_conversation_id_idx" ON "conversation_lifecycle" USING btree ("intercom_conversation_id");