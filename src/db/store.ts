import { and, eq } from "drizzle-orm";
import type {
  BridgeStore,
  ConversationLifecycleRecord,
  ConversationThreadRecord,
} from "../lib/contracts.js";
import type { ActivationReason, BridgeMode, EventSource, MessageDirection } from "../types/events.js";
import { conversationLifecycle, conversationThreads, messageLinks, processedEvents } from "./schema.js";
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
    bridgeMode: BridgeMode;
    activationReason: ActivationReason;
    activatedAt?: Date;
  }): Promise<ConversationThreadRecord> {
    const created = await this.db
      .insert(conversationThreads)
      .values({
        intercomConversationId: input.intercomConversationId,
        intercomContactId: input.intercomContactId,
        slackChannelId: input.slackChannelId,
        slackThreadTs: input.slackThreadTs,
        bridgeMode: input.bridgeMode,
        activationReason: input.activationReason,
        activatedAt: input.activatedAt ?? new Date(),
      })
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

  async getLifecycleByConversationId(
    intercomConversationId: string,
  ): Promise<ConversationLifecycleRecord | null> {
    const rows = await this.db
      .select()
      .from(conversationLifecycle)
      .where(eq(conversationLifecycle.intercomConversationId, intercomConversationId))
      .limit(1);

    return rows[0] ?? null;
  }

  async upsertLifecycle(input: {
    intercomConversationId: string;
    lastTopic: string;
    aiActive?: boolean;
    humanHandoffDetected?: boolean;
    lastCustomerMessageId?: string | null;
    lastCustomerMessageText?: string | null;
  }): Promise<ConversationLifecycleRecord> {
    const existing = await this.getLifecycleByConversationId(input.intercomConversationId);
    const merged = {
      intercomConversationId: input.intercomConversationId,
      lastTopic: input.lastTopic,
      aiActive: input.aiActive ?? existing?.aiActive ?? false,
      humanHandoffDetected: input.humanHandoffDetected ?? existing?.humanHandoffDetected ?? false,
      lastCustomerMessageId:
        input.lastCustomerMessageId !== undefined
          ? input.lastCustomerMessageId
          : (existing?.lastCustomerMessageId ?? null),
      lastCustomerMessageText:
        input.lastCustomerMessageText !== undefined
          ? input.lastCustomerMessageText
          : (existing?.lastCustomerMessageText ?? null),
      updatedAt: new Date(),
    };

    const rows = await this.db
      .insert(conversationLifecycle)
      .values(merged)
      .onConflictDoUpdate({
        target: [conversationLifecycle.intercomConversationId],
        set: {
          lastTopic: merged.lastTopic,
          aiActive: merged.aiActive,
          humanHandoffDetected: merged.humanHandoffDetected,
          lastCustomerMessageId: merged.lastCustomerMessageId,
          lastCustomerMessageText: merged.lastCustomerMessageText,
          updatedAt: merged.updatedAt,
        },
      })
      .returning();

    return rows[0];
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
