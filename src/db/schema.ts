import {
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

export const conversationThreads = pgTable(
  "conversation_threads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    intercomConversationId: text("intercom_conversation_id").notNull(),
    intercomContactId: text("intercom_contact_id"),
    slackChannelId: text("slack_channel_id").notNull(),
    slackThreadTs: text("slack_thread_ts").notNull(),
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
