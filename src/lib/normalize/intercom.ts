import { createHash } from "node:crypto";
import type {
  HandoffReason,
  NormalizedIntercomCustomerMessageEvent,
  NormalizedIntercomWebhookEvent,
} from "../../types/events.js";

const CUSTOMER_AUTHOR_TYPES = new Set(["user", "lead", "contact", "visitor"]);
const HANDOFF_TOPICS = new Set(["conversation.admin.assigned", "conversation.admin.open.assigned"]);

interface MessageCandidate {
  messageText: string;
  messageId: string | null;
  occurredAt: string | null;
  authorType: string | null;
  authorFromAiAgent: boolean;
  authorIsAiAnswer: boolean;
}

function toStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function toBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    return text === "true" || text === "1" || text === "yes";
  }

  if (typeof value === "number") {
    return value === 1;
  }

  return false;
}

function toIsoTimestampOrNull(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = value > 1_000_000_000_000 ? value : value * 1000;
    return new Date(millis).toISOString();
  }

  const text = toStringOrNull(value);
  if (!text) {
    return null;
  }

  const asNumber = Number(text);
  if (Number.isFinite(asNumber) && text.match(/^\d+$/)) {
    const millis = asNumber > 1_000_000_000_000 ? asNumber : asNumber * 1000;
    return new Date(millis).toISOString();
  }

  const parsed = Date.parse(text);
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toISOString();
  }

  return text;
}

function htmlToText(value: string): string {
  const withBreaks = value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<p[^>]*>/gi, "");
  const stripped = withBreaks.replace(/<[^>]+>/g, "");
  return stripped
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function isCustomerAuthor(authorType: unknown): boolean {
  const text = toStringOrNull(authorType);
  return text ? CUSTOMER_AUTHOR_TYPES.has(text.toLowerCase()) : false;
}

function deriveConversation(payload: any): any {
  return payload?.data?.item ?? payload?.item ?? payload?.data?.conversation ?? payload?.conversation ?? null;
}

function deriveConversationLink(conversation: any): string | null {
  const candidates = [
    conversation?.links?.conversation_web,
    conversation?.links?.conversation,
    conversation?.link,
    conversation?.url,
  ];

  for (const candidate of candidates) {
    const value = toStringOrNull(candidate);
    if (value) {
      return value;
    }
  }

  return null;
}

function deriveCustomerName(conversation: any): string {
  const contacts = conversation?.contacts?.contacts;
  if (Array.isArray(contacts) && contacts.length > 0) {
    const first = contacts[0];
    return toStringOrNull(first?.name) ?? "Visitor";
  }

  return "Visitor";
}

function deriveContactId(conversation: any): string | null {
  return toStringOrNull(conversation?.contacts?.contacts?.[0]?.id);
}

function buildMessageCandidate(source: any, body: unknown): MessageCandidate | null {
  const rawBody = toStringOrNull(body);
  if (!rawBody) {
    return null;
  }

  const messageText = htmlToText(rawBody);
  if (!messageText) {
    return null;
  }

  return {
    messageText,
    messageId: toStringOrNull(source?.id),
    occurredAt: toIsoTimestampOrNull(source?.created_at),
    authorType: toStringOrNull(source?.author?.type),
    authorFromAiAgent: toBoolean(source?.author?.from_ai_agent),
    authorIsAiAnswer: toBoolean(source?.author?.is_ai_answer),
  };
}

function getSourceCandidate(conversation: any): MessageCandidate | null {
  return buildMessageCandidate(conversation?.source, conversation?.source?.body);
}

function getLatestPartCandidate(conversation: any): MessageCandidate | null {
  const parts = conversation?.conversation_parts?.conversation_parts;
  if (!Array.isArray(parts)) {
    return null;
  }

  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const candidate = buildMessageCandidate(parts[index], parts[index]?.body);
    if (candidate) {
      return candidate;
    }
  }

  return null;
}

function getLatestCustomerCandidate(conversation: any): MessageCandidate | null {
  const parts = conversation?.conversation_parts?.conversation_parts;
  if (Array.isArray(parts)) {
    for (let index = parts.length - 1; index >= 0; index -= 1) {
      const part = parts[index];
      if (!isCustomerAuthor(part?.author?.type)) {
        continue;
      }

      const candidate = buildMessageCandidate(part, part?.body);
      if (candidate) {
        return candidate;
      }
    }
  }

  const source = getSourceCandidate(conversation);
  if (source && isCustomerAuthor(source.authorType)) {
    return source;
  }

  return null;
}

function getLatestAdminCandidate(conversation: any): MessageCandidate | null {
  const parts = conversation?.conversation_parts?.conversation_parts;
  if (Array.isArray(parts)) {
    for (let index = parts.length - 1; index >= 0; index -= 1) {
      const part = parts[index];
      const authorType = toStringOrNull(part?.author?.type)?.toLowerCase();
      if (authorType !== "admin") {
        continue;
      }

      const candidate = buildMessageCandidate(part, part?.body);
      if (candidate) {
        return candidate;
      }
    }
  }

  const source = getSourceCandidate(conversation);
  if (source && toStringOrNull(source.authorType)?.toLowerCase() === "admin") {
    return source;
  }

  return null;
}

function deriveOccurredAt(payload: any, conversation: any, message: MessageCandidate | null): string {
  return (
    message?.occurredAt ??
    toIsoTimestampOrNull(payload?.created_at) ??
    toIsoTimestampOrNull(conversation?.updated_at) ??
    toIsoTimestampOrNull(conversation?.created_at) ??
    new Date().toISOString()
  );
}

function buildFallbackEventKey(input: {
  conversationId: string;
  topic: string;
  occurredAt: string;
  messageId: string | null;
  messageText: string | null;
}): string {
  const hash = createHash("sha256")
    .update(
      `${input.conversationId}:${input.topic}:${input.occurredAt}:${input.messageId ?? "none"}:${input.messageText ?? "none"}`,
    )
    .digest("hex");
  return `intercom-fallback:${hash}`;
}

function getEventId(payload: any, fallbackInput: {
  conversationId: string;
  topic: string;
  occurredAt: string;
  messageId: string | null;
  messageText: string | null;
}): string {
  const rawEventId = toStringOrNull(payload?.id);
  if (rawEventId) {
    return `intercom:${rawEventId}`;
  }

  return buildFallbackEventKey(fallbackInput);
}

function normalizeCustomerMessageEvent(input: {
  payload: any;
  conversation: any;
  topic: string;
  conversationId: string;
  sourceCandidate: MessageCandidate | null;
  latestCustomerCandidate: MessageCandidate | null;
}): NormalizedIntercomCustomerMessageEvent | null {
  const prefersReplyPart = input.topic.includes(".user.replied");
  const prefersCreatedSource = input.topic.includes(".user.created");
  const selected = prefersReplyPart
    ? (input.latestCustomerCandidate ?? input.sourceCandidate)
    : prefersCreatedSource
      ? (input.sourceCandidate ?? input.latestCustomerCandidate)
      : (input.latestCustomerCandidate ?? input.sourceCandidate);

  if (!selected || !isCustomerAuthor(selected.authorType)) {
    return null;
  }

  const occurredAt = deriveOccurredAt(input.payload, input.conversation, selected);
  const eventId = getEventId(input.payload, {
    conversationId: input.conversationId,
    topic: input.topic,
    occurredAt,
    messageId: selected.messageId,
    messageText: selected.messageText,
  });

  return {
    kind: "customer_message",
    eventId,
    idempotencyKey: eventId,
    conversationId: input.conversationId,
    topic: input.topic,
    occurredAt,
    contactId: deriveContactId(input.conversation),
    messageId: selected.messageId,
    messageText: selected.messageText,
    customerName: deriveCustomerName(input.conversation),
    conversationLink: deriveConversationLink(input.conversation),
  };
}

function normalizeHandoffEvent(input: {
  payload: any;
  conversation: any;
  topic: string;
  conversationId: string;
  handoffReason: HandoffReason;
}): NormalizedIntercomWebhookEvent {
  const latestCustomer = getLatestCustomerCandidate(input.conversation);
  const occurredAt = deriveOccurredAt(input.payload, input.conversation, latestCustomer);
  const eventId = getEventId(input.payload, {
    conversationId: input.conversationId,
    topic: input.topic,
    occurredAt,
    messageId: latestCustomer?.messageId ?? null,
    messageText: latestCustomer?.messageText ?? null,
  });

  return {
    kind: "handoff",
    eventId,
    idempotencyKey: eventId,
    conversationId: input.conversationId,
    topic: input.topic,
    occurredAt,
    handoffReason: input.handoffReason,
    customerName: deriveCustomerName(input.conversation),
    contactId: deriveContactId(input.conversation),
    conversationLink: deriveConversationLink(input.conversation),
    latestCustomerMessageId: latestCustomer?.messageId ?? null,
    latestCustomerMessageText: latestCustomer?.messageText ?? null,
  };
}

function normalizeAiActivityEvent(input: {
  payload: any;
  conversation: any;
  topic: string;
  conversationId: string;
  aiSource: "operator_replied" | "admin_replied_ai";
}): NormalizedIntercomWebhookEvent {
  const latestAdmin = getLatestAdminCandidate(input.conversation);
  const occurredAt = deriveOccurredAt(input.payload, input.conversation, latestAdmin);
  const eventId = getEventId(input.payload, {
    conversationId: input.conversationId,
    topic: input.topic,
    occurredAt,
    messageId: latestAdmin?.messageId ?? null,
    messageText: latestAdmin?.messageText ?? null,
  });

  return {
    kind: "ai_activity",
    eventId,
    idempotencyKey: eventId,
    conversationId: input.conversationId,
    topic: input.topic,
    occurredAt,
    aiSource: input.aiSource,
  };
}

function normalizeIgnoreEvent(input: {
  payload: any;
  conversation: any;
  topic: string;
  conversationId: string;
  ignoreReason: string;
}): NormalizedIntercomWebhookEvent {
  const occurredAt = deriveOccurredAt(input.payload, input.conversation, null);
  const eventId = getEventId(input.payload, {
    conversationId: input.conversationId,
    topic: input.topic,
    occurredAt,
    messageId: null,
    messageText: null,
  });

  return {
    kind: "ignore",
    eventId,
    idempotencyKey: eventId,
    conversationId: input.conversationId,
    topic: input.topic,
    occurredAt,
    ignoreReason: input.ignoreReason,
  };
}

export function normalizeIntercomWebhook(payload: unknown): NormalizedIntercomWebhookEvent | null {
  const data = payload as any;
  const conversation = deriveConversation(data);
  if (!conversation) {
    return null;
  }

  const conversationId = toStringOrNull(conversation?.id);
  if (!conversationId) {
    return null;
  }

  const topic = toStringOrNull(data?.topic)?.toLowerCase() ?? "unknown";
  const sourceCandidate = getSourceCandidate(conversation);
  const latestCustomerCandidate = getLatestCustomerCandidate(conversation);

  if (topic === "conversation.user.created" || topic === "conversation.user.replied") {
    const customerEvent = normalizeCustomerMessageEvent({
      payload: data,
      conversation,
      topic,
      conversationId,
      sourceCandidate,
      latestCustomerCandidate,
    });

    if (!customerEvent) {
      return normalizeIgnoreEvent({
        payload: data,
        conversation,
        topic,
        conversationId,
        ignoreReason: "no_customer_message",
      });
    }

    return customerEvent;
  }

  if (topic === "conversation.operator.replied") {
    return normalizeAiActivityEvent({
      payload: data,
      conversation,
      topic,
      conversationId,
      aiSource: "operator_replied",
    });
  }

  if (HANDOFF_TOPICS.has(topic)) {
    return normalizeHandoffEvent({
      payload: data,
      conversation,
      topic,
      conversationId,
      handoffReason: "assigned_to_admin",
    });
  }

  if (topic === "conversation.admin.replied") {
    const latestAdmin = getLatestAdminCandidate(conversation) ?? sourceCandidate;
    const isAiReply = Boolean(latestAdmin?.authorFromAiAgent || latestAdmin?.authorIsAiAnswer);

    if (isAiReply) {
      return normalizeAiActivityEvent({
        payload: data,
        conversation,
        topic,
        conversationId,
        aiSource: "admin_replied_ai",
      });
    }

    return normalizeHandoffEvent({
      payload: data,
      conversation,
      topic,
      conversationId,
      handoffReason: "admin_replied",
    });
  }

  return normalizeIgnoreEvent({
    payload: data,
    conversation,
    topic,
    conversationId,
    ignoreReason: "unsupported_topic",
  });
}
