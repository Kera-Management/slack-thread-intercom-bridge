import {
  boolean,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const eventSourceEnum = pgEnum("event_source", ["intercom", "slack"]);
export const messageDirectionEnum = pgEnum("message_direction", [
  "intercom_to_slack",
  "slack_to_intercom",
]);
export const bridgeModeEnum = pgEnum("bridge_mode", ["escalated"]);
export const activationReasonEnum = pgEnum("activation_reason", [
  "admin_assigned_or_replied",
]);

export const conversationThreads = pgTable(
  "conversation_threads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    intercomConversationId: text("intercom_conversation_id").notNull(),
    intercomContactId: text("intercom_contact_id"),
    slackChannelId: text("slack_channel_id").notNull(),
    slackThreadTs: text("slack_thread_ts").notNull(),
    bridgeMode: bridgeModeEnum("bridge_mode").notNull().default("escalated"),
    activatedAt: timestamp("activated_at", { withTimezone: true }).notNull().defaultNow(),
    activationReason: activationReasonEnum("activation_reason")
      .notNull()
      .default("admin_assigned_or_replied"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueIntercomConversationId: uniqueIndex("conversation_threads_intercom_conversation_id_idx").on(
      table.intercomConversationId,
    ),
    uniqueSlackThread: uniqueIndex("conversation_threads_slack_channel_thread_idx").on(
      table.slackChannelId,
      table.slackThreadTs,
    ),
  }),
);

export const conversationLifecycle = pgTable(
  "conversation_lifecycle",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    intercomConversationId: text("intercom_conversation_id").notNull(),
    lastTopic: text("last_topic").notNull(),
    aiActive: boolean("ai_active").notNull().default(false),
    humanHandoffDetected: boolean("human_handoff_detected").notNull().default(false),
    lastCustomerMessageId: text("last_customer_message_id"),
    lastCustomerMessageText: text("last_customer_message_text"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueIntercomConversationId: uniqueIndex("conversation_lifecycle_intercom_conversation_id_idx").on(
      table.intercomConversationId,
    ),
  }),
);

export const processedEvents = pgTable(
  "processed_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    source: eventSourceEnum("source").notNull(),
    externalEventId: text("external_event_id").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueSourceEvent: uniqueIndex("processed_events_source_external_event_id_idx").on(
      table.source,
      table.externalEventId,
    ),
  }),
);

export const messageLinks = pgTable(
  "message_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    intercomConversationId: text("intercom_conversation_id").notNull(),
    intercomPartId: text("intercom_part_id"),
    slackChannelId: text("slack_channel_id").notNull(),
    slackTs: text("slack_ts").notNull(),
    direction: messageDirectionEnum("direction").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueSlackDirection: uniqueIndex("message_links_slack_channel_ts_direction_idx").on(
      table.slackChannelId,
      table.slackTs,
      table.direction,
    ),
    intercomConversationIdx: index("message_links_intercom_conversation_id_idx").on(
      table.intercomConversationId,
    ),
  }),
);

export type ConversationThread = typeof conversationThreads.$inferSelect;
