import { and, eq } from "drizzle-orm";
import type { BridgeStore, ConversationThreadRecord } from "../lib/contracts.js";
import type { EventSource, MessageDirection } from "../types/events.js";
import { conversationThreads, messageLinks, processedEvents } from "./schema.js";
import type { getDb } from "./client.js";

export class PostgresBridgeStore implements BridgeStore {
  constructor(private readonly db: ReturnType<typeof getDb>) {}

  async markEventProcessed(source: EventSource, externalEventId: string): Promise<boolean> {
    const inserted = await this.db
      .insert(processedEvents)
      .values({ source, externalEventId })
      .onConflictDoNothing({ target: [processedEvents.source, processedEvents.externalEventId] })
      .returning({ id: processedEvents.id });

    return inserted.length > 0;
  }

  async getThreadByIntercomConversationId(
    intercomConversationId: string,
  ): Promise<ConversationThreadRecord | null> {
    const rows = await this.db
      .select()
      .from(conversationThreads)
      .where(eq(conversationThreads.intercomConversationId, intercomConversationId))
      .limit(1);

    return rows[0] ?? null;
  }

  async getThreadBySlackThread(
    slackChannelId: string,
    slackThreadTs: string,
  ): Promise<ConversationThreadRecord | null> {
    const rows = await this.db
      .select()
      .from(conversationThreads)
      .where(
        and(
          eq(conversationThreads.slackChannelId, slackChannelId),
          eq(conversationThreads.slackThreadTs, slackThreadTs),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  async createConversationThread(input: {
    intercomConversationId: string;
    intercomContactId: string | null;
    slackChannelId: string;
    slackThreadTs: string;
  }): Promise<ConversationThreadRecord> {
    const created = await this.db
      .insert(conversationThreads)
      .values(input)
      .onConflictDoNothing({ target: [conversationThreads.intercomConversationId] })
      .returning();

    if (created.length > 0) {
      return created[0];
    }

    const existing = await this.getThreadByIntercomConversationId(input.intercomConversationId);
    if (!existing) {
      throw new Error("Conversation thread conflict without existing row");
    }

    return existing;
  }

  async touchConversationThread(threadId: string): Promise<void> {
    await this.db
      .update(conversationThreads)
      .set({ lastSyncedAt: new Date() })
      .where(eq(conversationThreads.id, threadId));
  }

  async createMessageLink(input: {
    intercomConversationId: string;
    intercomPartId: string | null;
    slackChannelId: string;
    slackTs: string;
    direction: MessageDirection;
  }): Promise<void> {
    await this.db
      .insert(messageLinks)
      .values(input)
      .onConflictDoNothing({
        target: [messageLinks.slackChannelId, messageLinks.slackTs, messageLinks.direction],
      });
  }
}
