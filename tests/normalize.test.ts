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
      kind: "customer_message",
      eventId: "intercom:ev_123",
      conversationId: "c_1",
      messageId: "m_1",
      messageText: "Hello there",
      customerName: "Jane",
      contactId: "u_1",
    });
  });

  it("normalizes operator reply as ai activity", () => {
    const payload = {
      id: "ev_201",
      topic: "conversation.operator.replied",
      data: {
        item: {
          id: "c_1",
        },
      },
    };

    expect(normalizeIntercomWebhook(payload)).toMatchObject({
      kind: "ai_activity",
      aiSource: "operator_replied",
      eventId: "intercom:ev_201",
      conversationId: "c_1",
    });
  });

  it("normalizes admin replied with AI metadata as ai activity", () => {
    const payload = {
      id: "ev_202",
      topic: "conversation.admin.replied",
      data: {
        item: {
          id: "c_1",
          conversation_parts: {
            conversation_parts: [
              {
                id: "a_1",
                author: { type: "admin", from_ai_agent: true, is_ai_answer: true },
                body: "<p>AI response</p>",
              },
            ],
          },
        },
      },
    };

    expect(normalizeIntercomWebhook(payload)).toMatchObject({
      kind: "ai_activity",
      aiSource: "admin_replied_ai",
      eventId: "intercom:ev_202",
      conversationId: "c_1",
    });
  });

  it("normalizes human admin replied as handoff", () => {
    const payload = {
      id: "ev_203",
      topic: "conversation.admin.replied",
      data: {
        item: {
          id: "c_1",
          contacts: { contacts: [{ id: "u_1", name: "Jane" }] },
          source: {
            id: "s_1",
            author: { type: "user" },
            body: "<p>Need help</p>",
          },
          conversation_parts: {
            conversation_parts: [
              {
                id: "a_2",
                author: { type: "admin", from_ai_agent: false, is_ai_answer: false },
                body: "<p>I can help</p>",
              },
            ],
          },
        },
      },
    };

    expect(normalizeIntercomWebhook(payload)).toMatchObject({
      kind: "handoff",
      handoffReason: "admin_replied",
      eventId: "intercom:ev_203",
      conversationId: "c_1",
      customerName: "Jane",
    });
  });

  it("normalizes assignment handoff topics", () => {
    const assignedPayload = {
      id: "ev_204",
      topic: "conversation.admin.assigned",
      data: {
        item: {
          id: "c_1",
          source: {
            id: "s_1",
            author: { type: "lead" },
            body: "<p>Need help now</p>",
          },
        },
      },
    };

    const openAssignedPayload = {
      id: "ev_205",
      topic: "conversation.admin.open.assigned",
      data: {
        item: {
          id: "c_2",
          source: {
            id: "s_2",
            author: { type: "lead" },
            body: "<p>Hello</p>",
          },
        },
      },
    };

    expect(normalizeIntercomWebhook(assignedPayload)).toMatchObject({
      kind: "handoff",
      handoffReason: "assigned_to_admin",
      eventId: "intercom:ev_204",
      conversationId: "c_1",
    });

    expect(normalizeIntercomWebhook(openAssignedPayload)).toMatchObject({
      kind: "handoff",
      handoffReason: "assigned_to_admin",
      eventId: "intercom:ev_205",
      conversationId: "c_2",
    });
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
      kind: "customer_message",
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
