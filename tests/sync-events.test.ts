import pino from "pino";
import { describe, expect, it } from "vitest";
import {
  createIntercomSyncHandler,
  createSlackSyncHandler,
  formatSlackEscalationRootMessage,
  type SyncDependencies,
} from "../src/jobs/sync-events.js";
import type {
  BridgeStore,
  ConversationLifecycleRecord,
  ConversationThreadRecord,
  IntercomApi,
  SlackApi,
} from "../src/lib/contracts.js";
import type {
  ActivationReason,
  BridgeMode,
  EventSource,
  MessageDirection,
  RoutingMode,
} from "../src/types/events.js";

class InMemoryStore implements BridgeStore {
  private readonly processed = new Set<string>();
  private readonly byIntercom = new Map<string, ConversationThreadRecord>();
  private readonly bySlack = new Map<string, ConversationThreadRecord>();
  private readonly links = new Set<string>();
  private readonly lifecycle = new Map<string, ConversationLifecycleRecord>();

  async markEventProcessed(source: EventSource, externalEventId: string): Promise<boolean> {
    const key = `${source}:${externalEventId}`;
    if (this.processed.has(key)) {
      return false;
    }
    this.processed.add(key);
    return true;
  }

  async getThreadByIntercomConversationId(intercomConversationId: string): Promise<ConversationThreadRecord | null> {
    return this.byIntercom.get(intercomConversationId) ?? null;
  }

  async getThreadBySlackThread(
    slackChannelId: string,
    slackThreadTs: string,
  ): Promise<ConversationThreadRecord | null> {
    return this.bySlack.get(`${slackChannelId}:${slackThreadTs}`) ?? null;
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
    const existing = this.byIntercom.get(input.intercomConversationId);
    if (existing) {
      return existing;
    }

    const now = new Date();
    const created: ConversationThreadRecord = {
      id: `thread-${this.byIntercom.size + 1}`,
      intercomConversationId: input.intercomConversationId,
      intercomContactId: input.intercomContactId,
      slackChannelId: input.slackChannelId,
      slackThreadTs: input.slackThreadTs,
      bridgeMode: input.bridgeMode,
      activationReason: input.activationReason,
      activatedAt: input.activatedAt ?? now,
      firstSeenAt: now,
      lastSyncedAt: now,
    };
    this.byIntercom.set(created.intercomConversationId, created);
    this.bySlack.set(`${created.slackChannelId}:${created.slackThreadTs}`, created);
    return created;
  }

  async getLifecycleByConversationId(
    intercomConversationId: string,
  ): Promise<ConversationLifecycleRecord | null> {
    return this.lifecycle.get(intercomConversationId) ?? null;
  }

  async upsertLifecycle(input: {
    intercomConversationId: string;
    lastTopic: string;
    aiActive?: boolean;
    humanHandoffDetected?: boolean;
    lastCustomerMessageId?: string | null;
    lastCustomerMessageText?: string | null;
  }): Promise<ConversationLifecycleRecord> {
    const existing = this.lifecycle.get(input.intercomConversationId);
    const now = new Date();
    const record: ConversationLifecycleRecord = {
      id: existing?.id ?? `lifecycle-${this.lifecycle.size + 1}`,
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
      updatedAt: now,
    };
    this.lifecycle.set(input.intercomConversationId, record);
    return record;
  }

  async touchConversationThread(threadId: string): Promise<void> {
    for (const thread of this.byIntercom.values()) {
      if (thread.id === threadId) {
        thread.lastSyncedAt = new Date();
      }
    }
  }

  async createMessageLink(input: {
    intercomConversationId: string;
    intercomPartId: string | null;
    slackChannelId: string;
    slackTs: string;
    direction: MessageDirection;
  }): Promise<void> {
    this.links.add(`${input.slackChannelId}:${input.slackTs}:${input.direction}`);
  }

  linkCount(): number {
    return this.links.size;
  }
}

class FakeSlackClient implements SlackApi {
  public readonly calls: Array<{ channelId: string; text: string; threadTs?: string }> = [];

  async postMessage(input: { channelId: string; text: string; threadTs?: string }): Promise<{ ts: string }> {
    this.calls.push(input);
    return { ts: `${this.calls.length}.0001` };
  }
}

class FakeIntercomClient implements IntercomApi {
  public readonly replyCalls: Array<{ conversationId: string; messageText: string }> = [];
  public readonly fetchCalls: string[] = [];
  public conversationToReturn: unknown = null;

  async replyToConversation(input: { conversationId: string; messageText: string }): Promise<void> {
    this.replyCalls.push(input);
  }

  async getConversation(conversationId: string): Promise<unknown> {
    this.fetchCalls.push(conversationId);
    if (this.conversationToReturn === null) {
      throw new Error("no conversation configured");
    }
    return this.conversationToReturn;
  }
}

function makeDeps(routingMode: RoutingMode = "escalation_only") {
  const store = new InMemoryStore();
  const slackClient = new FakeSlackClient();
  const intercomClient = new FakeIntercomClient();

  const deps: SyncDependencies = {
    store,
    slackClient,
    intercomClient,
    logger: pino({ enabled: false }),
    slackDefaultChannelId: "C_DEFAULT",
    routingMode,
  };

  return { deps, store, slackClient, intercomClient };
}

describe("sync handlers", () => {
  it("formats escalation root Slack message", () => {
    const message = formatSlackEscalationRootMessage({
      customerName: "Visitor",
      conversationId: "215473306294334",
      conversationLink: "https://app.intercom.com/a/inbox/abc/inbox/123/conversation/215473306294334",
      handoffReason: "assigned_to_admin",
      latestCustomerMessageText: "Need help now",
      aiHandledBeforeEscalation: true,
    });

    expect(message).toContain("*Escalated to human support*");
    expect(message).toContain("*From:* Visitor");
    expect(message).toContain(
      "*Conversation:* <https://app.intercom.com/a/inbox/abc/inbox/123/conversation/215473306294334|215473306294334>",
    );
    expect(message).toContain("*Reason:* Assigned to admin");
    expect(message).toContain("_AI handled this conversation before escalation._");
    expect(message).toContain("> Need help now");
  });

  it("keeps AI-only flow out of Slack until handoff", async () => {
    const { deps, slackClient, store } = makeDeps();
    const intercomHandler = createIntercomSyncHandler(deps);

    const first = await intercomHandler.handle({
      id: "ev_1",
      topic: "conversation.user.created",
      data: {
        item: {
          id: "conv_1",
          source: { id: "src_1", body: "<p>Hello</p>", author: { type: "user" } },
          contacts: { contacts: [{ id: "contact_1", name: "Jane" }] },
        },
      },
    });

    const ai = await intercomHandler.handle({
      id: "ev_2",
      topic: "conversation.operator.replied",
      data: {
        item: { id: "conv_1" },
      },
    });

    const followUp = await intercomHandler.handle({
      id: "ev_3",
      topic: "conversation.user.replied",
      data: {
        item: {
          id: "conv_1",
          conversation_parts: {
            conversation_parts: [
              {
                id: "part_1",
                author: { type: "user" },
                body: "<p>Still there?</p>",
              },
            ],
          },
        },
      },
    });

    expect(first.status).toBe("ignored_pre_handoff");
    expect(ai.status).toBe("tracked_ai_activity");
    expect(followUp.status).toBe("ignored_pre_handoff");
    expect(slackClient.calls).toHaveLength(0);
    expect(await store.getThreadByIntercomConversationId("conv_1")).toBeNull();
  });

  it("creates one Slack thread when assignment handoff arrives", async () => {
    const { deps, slackClient, store } = makeDeps();
    const intercomHandler = createIntercomSyncHandler(deps);

    await intercomHandler.handle({
      id: "ev_1",
      topic: "conversation.user.created",
      data: {
        item: {
          id: "conv_1",
          source: { id: "src_1", body: "<p>Hello</p>", author: { type: "user" } },
          contacts: { contacts: [{ id: "contact_1", name: "Jane" }] },
        },
      },
    });

    const result = await intercomHandler.handle({
      id: "ev_2",
      topic: "conversation.admin.assigned",
      data: {
        item: {
          id: "conv_1",
          contacts: { contacts: [{ id: "contact_1", name: "Jane" }] },
          source: {
            id: "src_1",
            author: { type: "user" },
            body: "<p>Hello</p>",
          },
        },
      },
    });

    expect(result.status).toBe("created_thread_on_handoff");
    expect(slackClient.calls).toHaveLength(1);
    expect(slackClient.calls[0].threadTs).toBeUndefined();
    expect(slackClient.calls[0].text).toContain("*Escalated to human support*");

    const thread = await store.getThreadByIntercomConversationId("conv_1");
    expect(thread).not.toBeNull();
    expect(thread?.bridgeMode).toBe("escalated");
  });

  it("keeps continuity after handoff in both directions", async () => {
    const { deps, slackClient, intercomClient } = makeDeps();
    const intercomHandler = createIntercomSyncHandler(deps);
    const slackHandler = createSlackSyncHandler(deps);

    await intercomHandler.handle({
      id: "ev_1",
      topic: "conversation.user.created",
      data: {
        item: {
          id: "conv_1",
          source: { id: "src_1", body: "<p>Hello</p>", author: { type: "user" } },
          contacts: { contacts: [{ id: "contact_1", name: "Jane" }] },
        },
      },
    });

    await intercomHandler.handle({
      id: "ev_2",
      topic: "conversation.admin.assigned",
      data: {
        item: {
          id: "conv_1",
          contacts: { contacts: [{ id: "contact_1", name: "Jane" }] },
          source: { id: "src_1", body: "<p>Hello</p>", author: { type: "user" } },
        },
      },
    });

    const followUp = await intercomHandler.handle({
      id: "ev_3",
      topic: "conversation.user.replied",
      data: {
        item: {
          id: "conv_1",
          conversation_parts: {
            conversation_parts: [
              {
                id: "part_2",
                author: { type: "user" },
                body: "<p>Any updates?</p>",
              },
            ],
          },
        },
      },
    });

    const slackResult = await slackHandler.handle({
      event_id: "Ev_1",
      event: {
        type: "message",
        channel: "C_DEFAULT",
        thread_ts: "1.0001",
        ts: "1.0002",
        user: "U_1",
        text: "Absolutely, working on it.",
      },
    });

    expect(followUp.status).toBe("posted_to_thread");
    expect(slackResult.status).toBe("replied_to_intercom");
    expect(slackClient.calls).toHaveLength(2);
    expect(slackClient.calls[1]).toMatchObject({
      channelId: "C_DEFAULT",
      threadTs: "1.0001",
    });
    expect(intercomClient.replyCalls).toHaveLength(1);
    expect(intercomClient.replyCalls[0]).toEqual({
      conversationId: "conv_1",
      messageText: "Absolutely, working on it.",
    });
  });

  it("deduplicates repeated handoff events", async () => {
    const { deps, slackClient } = makeDeps();
    const intercomHandler = createIntercomSyncHandler(deps);

    const first = await intercomHandler.handle({
      id: "ev_1",
      topic: "conversation.admin.assigned",
      data: {
        item: {
          id: "conv_1",
          source: { id: "src_1", body: "<p>Need help</p>", author: { type: "user" } },
        },
      },
    });

    const duplicate = await intercomHandler.handle({
      id: "ev_1",
      topic: "conversation.admin.assigned",
      data: {
        item: {
          id: "conv_1",
          source: { id: "src_1", body: "<p>Need help</p>", author: { type: "user" } },
        },
      },
    });

    expect(first.status).toBe("created_thread_on_handoff");
    expect(duplicate.status).toBe("duplicate");
    expect(slackClient.calls).toHaveLength(1);
  });

  it("uses Intercom fetch fallback when handoff has no cached customer summary", async () => {
    const { deps, slackClient, intercomClient } = makeDeps();
    const intercomHandler = createIntercomSyncHandler(deps);

    intercomClient.conversationToReturn = {
      id: "conv_1",
      source: {
        id: "src_1",
        body: "<p>Fallback body</p>",
        author: { type: "lead" },
      },
      contacts: {
        contacts: [{ id: "contact_1", name: "Fallback User" }],
      },
      links: {
        conversation_web: "https://app.intercom.com/a/inbox/abc/inbox/123/conversation/conv_1",
      },
    };

    const result = await intercomHandler.handle({
      id: "ev_1",
      topic: "conversation.admin.assigned",
      data: {
        item: {
          id: "conv_1",
          contacts: { contacts: [{ id: "contact_1", name: "Fallback User" }] },
        },
      },
    });

    expect(result.status).toBe("created_thread_on_handoff");
    expect(intercomClient.fetchCalls).toEqual(["conv_1"]);
    expect(slackClient.calls).toHaveLength(1);
    expect(slackClient.calls[0].text).toContain("Fallback body");
  });
});
