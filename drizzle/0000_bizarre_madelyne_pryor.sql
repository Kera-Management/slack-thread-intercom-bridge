CREATE TYPE "public"."event_source" AS ENUM('intercom', 'slack');--> statement-breakpoint
CREATE TYPE "public"."message_direction" AS ENUM('intercom_to_slack', 'slack_to_intercom');--> statement-breakpoint
CREATE TABLE "conversation_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"intercom_conversation_id" text NOT NULL,
	"intercom_contact_id" text,
	"slack_channel_id" text NOT NULL,
	"slack_thread_ts" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"intercom_conversation_id" text NOT NULL,
	"intercom_part_id" text,
	"slack_channel_id" text NOT NULL,
	"slack_ts" text NOT NULL,
	"direction" "message_direction" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processed_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "event_source" NOT NULL,
	"external_event_id" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_threads_intercom_conversation_id_idx" ON "conversation_threads" USING btree ("intercom_conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_threads_slack_channel_thread_idx" ON "conversation_threads" USING btree ("slack_channel_id","slack_thread_ts");--> statement-breakpoint
CREATE UNIQUE INDEX "message_links_slack_channel_ts_direction_idx" ON "message_links" USING btree ("slack_channel_id","slack_ts","direction");--> statement-breakpoint
CREATE INDEX "message_links_intercom_conversation_id_idx" ON "message_links" USING btree ("intercom_conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "processed_events_source_external_event_id_idx" ON "processed_events" USING btree ("source","external_event_id");