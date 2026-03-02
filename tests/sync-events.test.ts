import pino from "pino";
import { describe, expect, it } from "vitest";
import {
  createIntercomSyncHandler,
  createSlackSyncHandler,
  type SyncDependencies,
} from "../src/jobs/sync-events.js";
import type { BridgeStore, ConversationThreadRecord, IntercomApi, SlackApi } from "../src/lib/contracts.js";
import type { EventSource, MessageDirection } from "../src/types/events.js";

class InMemoryStore implements BridgeStore {
  private readonly processed = new Set<string>();
  private readonly byIntercom = new Map<string, ConversationThreadRecord>();
  private readonly bySlack = new Map<string, ConversationThreadRecord>();
  private readonly links = new Set<string>();

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
      firstSeenAt: now,
      lastSyncedAt: now,
    };
    this.byIntercom.set(created.intercomConversationId, created);
    this.bySlack.set(`${created.slackChannelId}:${created.slackThreadTs}`, created);
    return created;
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
  public readonly calls: Array<{ conversationId: string; messageText: string }> = [];

  async replyToConversation(input: { conversationId: string; messageText: string }): Promise<void> {
    this.calls.push(input);
  }
}

function makeDeps() {
  const store = new InMemoryStore();
  const slackClient = new FakeSlackClient();
  const intercomClient = new FakeIntercomClient();

  const deps: SyncDependencies = {
    store,
    slackClient,
    intercomClient,
    logger: pino({ enabled: false }),
    slackDefaultChannelId: "C_DEFAULT",
  };

  return { deps, store, slackClient, intercomClient };
}

describe("sync handlers", () => {
  it("creates new Slack thread for first Intercom customer message", async () => {
    const { deps, slackClient } = makeDeps();
    const handler = createIntercomSyncHandler(deps);

    const result = await handler.handle({
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

    expect(result.status).toBe("created_thread");
    expect(slackClient.calls).toHaveLength(1);
    expect(slackClient.calls[0]).toMatchObject({ channelId: "C_DEFAULT" });
    expect(slackClient.calls[0].threadTs).toBeUndefined();
  });

  it("posts follow-up Intercom customer message into existing thread", async () => {
    const { deps, slackClient } = makeDeps();
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

    expect(result.status).toBe("posted_to_thread");
    expect(slackClient.calls).toHaveLength(2);
    expect(slackClient.calls[1].threadTs).toBe("1.0001");
    expect(slackClient.calls[1].text).toContain("Customer:");
  });

  it("syncs Slack thread reply back to Intercom conversation", async () => {
    const { deps, intercomClient } = makeDeps();
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

    const result = await slackHandler.handle({
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

    expect(result.status).toBe("replied_to_intercom");
    expect(intercomClient.calls).toHaveLength(1);
    expect(intercomClient.calls[0]).toEqual({
      conversationId: "conv_1",
      messageText: "Absolutely, working on it.",
    });
  });

  it("deduplicates duplicate deliveries", async () => {
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

    const duplicateIntercom = await intercomHandler.handle({
      id: "ev_1",
      topic: "conversation.user.created",
      data: {
        item: {
          id: "conv_1",
          source: { id: "src_1", body: "<p>Hello</p>", author: { type: "user" } },
        },
      },
    });

    await slackHandler.handle({
      event_id: "Ev_1",
      event: {
        type: "message",
        channel: "C_DEFAULT",
        thread_ts: "1.0001",
        ts: "1.0002",
        user: "U_1",
        text: "First response",
      },
    });

    const duplicateSlack = await slackHandler.handle({
      event_id: "Ev_1",
      event: {
        type: "message",
        channel: "C_DEFAULT",
        thread_ts: "1.0001",
        ts: "1.0002",
        user: "U_1",
        text: "First response",
      },
    });

    expect(duplicateIntercom.status).toBe("duplicate");
    expect(duplicateSlack.status).toBe("duplicate");
    expect(slackClient.calls).toHaveLength(1);
    expect(intercomClient.calls).toHaveLength(1);
  });
});
