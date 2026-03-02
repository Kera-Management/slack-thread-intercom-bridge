import { describe, expect, it } from "vitest";
import { normalizeIntercomWebhook } from "../src/lib/normalize/intercom.js";
import { normalizeSlackEvent } from "../src/lib/normalize/slack.js";

describe("normalizeIntercomWebhook", () => {
  it("normalizes customer source message", () => {
    const payload = {
      id: "ev_123",
      topic: "conversation.user.created",
      data: {
        item: {
          id: "c_1",
          source: {
            id: "m_1",
            body: "<p>Hello there</p>",
            author: { type: "user" },
            created_at: "2026-03-02T10:00:00Z",
          },
          contacts: { contacts: [{ id: "u_1", name: "Jane" }] },
        },
      },
    };

    const normalized = normalizeIntercomWebhook(payload);

    expect(normalized).toMatchObject({
      eventId: "intercom:ev_123",
      conversationId: "c_1",
      messageId: "m_1",
      messageText: "Hello there",
      customerName: "Jane",
      contactId: "u_1",
    });
  });

  it("returns null when no customer-authored message exists", () => {
    const payload = {
      id: "ev_124",
      topic: "conversation.admin.replied",
      data: {
        item: {
          id: "c_1",
          conversation_parts: {
            conversation_parts: [
              {
                id: "p_1",
                author: { type: "admin" },
                body: "<p>Agent reply</p>",
              },
            ],
          },
        },
      },
    };

    expect(normalizeIntercomWebhook(payload)).toBeNull();
  });

  it("prefers latest customer part for conversation.user.replied events", () => {
    const payload = {
      id: "ev_125",
      topic: "conversation.user.replied",
      data: {
        item: {
          id: "c_1",
          source: {
            id: "m_1",
            body: "<p>Initial message</p>",
            author: { type: "lead" },
            created_at: "2026-03-02T10:00:00Z",
          },
          conversation_parts: {
            conversation_parts: [
              {
                id: "p_1",
                author: { type: "admin" },
                body: "<p>Agent reply</p>",
              },
              {
                id: "p_2",
                author: { type: "lead" },
                body: "<p>Follow-up question</p>",
                created_at: "2026-03-02T10:05:00Z",
              },
            ],
          },
        },
      },
    };

    const normalized = normalizeIntercomWebhook(payload);

    expect(normalized).toMatchObject({
      eventId: "intercom:ev_125",
      conversationId: "c_1",
      messageId: "p_2",
      messageText: "Follow-up question",
    });
  });
});

describe("normalizeSlackEvent", () => {
  it("normalizes threaded human message event", () => {
    const payload = {
      event_id: "Ev123",
      event: {
        type: "message",
        channel: "C123",
        thread_ts: "1710.1",
        ts: "1710.2",
        user: "U123",
        text: "Reply from support",
      },
    };

    expect(normalizeSlackEvent(payload)).toMatchObject({
      eventId: "slack:Ev123",
      channelId: "C123",
      threadTs: "1710.1",
      messageTs: "1710.2",
      userId: "U123",
      text: "Reply from support",
    });
  });

  it("ignores bot events", () => {
    const payload = {
      event_id: "Ev124",
      event: {
        type: "message",
        channel: "C123",
        thread_ts: "1710.1",
        ts: "1710.2",
        bot_id: "B1",
        text: "bot",
      },
    };

    expect(normalizeSlackEvent(payload)).toBeNull();
  });
});
