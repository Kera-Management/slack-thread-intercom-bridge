import { createHash } from "node:crypto";
import type { NormalizedIntercomEvent } from "../../types/events.js";

const CUSTOMER_AUTHOR_TYPES = new Set(["user", "lead", "contact", "visitor"]);

function toStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();
  return text.length > 0 ? text : null;
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

interface MessageCandidate {
  messageText: string;
  messageId: string | null;
  occurredAt: string | null;
}

function deriveConversation(payload: any): any {
  return payload?.data?.item ?? payload?.item ?? payload?.data?.conversation ?? payload?.conversation ?? null;
}

function deriveCustomerName(conversation: any): string {
  const contacts = conversation?.contacts?.contacts;
  if (Array.isArray(contacts) && contacts.length > 0) {
    const first = contacts[0];
    return toStringOrNull(first?.name) ?? "Visitor";
  }

  return "Visitor";
}

function buildFallbackEventKey(input: {
  conversationId: string;
  messageId: string | null;
  messageText: string;
  topic: string;
  occurredAt: string | null;
}): string {
  const hash = createHash("sha256")
    .update(
      `${input.conversationId}:${input.messageId ?? "source"}:${input.topic}:${input.occurredAt ?? "unknown"}:${input.messageText}`,
    )
    .digest("hex");
  return `intercom-fallback:${hash}`;
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

function getSourceCandidate(conversation: any): MessageCandidate | null {
  const sourceBody = toStringOrNull(conversation?.source?.body);
  const sourceAuthorType = toStringOrNull(conversation?.source?.author?.type);

  if (!sourceBody || !isCustomerAuthor(sourceAuthorType)) {
    return null;
  }

  const messageText = htmlToText(sourceBody);
  if (!messageText) {
    return null;
  }

  return {
    messageText,
    messageId: toStringOrNull(conversation?.source?.id),
    occurredAt: toStringOrNull(conversation?.source?.created_at),
  };
}

function getLatestCustomerPartCandidate(conversation: any): MessageCandidate | null {
  const parts = conversation?.conversation_parts?.conversation_parts;
  if (!Array.isArray(parts)) {
    return null;
  }

  const part = [...parts].reverse().find((item) => {
    if (!isCustomerAuthor(item?.author?.type)) {
      return false;
    }

    const body = toStringOrNull(item?.body);
    return Boolean(body && htmlToText(body));
  });

  if (!part) {
    return null;
  }

  return {
    messageText: htmlToText(String(part.body)),
    messageId: toStringOrNull(part.id),
    occurredAt: toStringOrNull(part.created_at),
  };
}

export function normalizeIntercomWebhook(payload: unknown): NormalizedIntercomEvent | null {
  const data = payload as any;
  const conversation = deriveConversation(data);
  if (!conversation) {
    return null;
  }

  const conversationId = toStringOrNull(conversation?.id);
  if (!conversationId) {
    return null;
  }

  const topic = toStringOrNull(data?.topic)?.toLowerCase() ?? "";
  const sourceCandidate = getSourceCandidate(conversation);
  const partCandidate = getLatestCustomerPartCandidate(conversation);
  const prefersReplyPart = topic.includes(".user.replied");
  const prefersCreatedSource = topic.includes(".user.created");
  const selected = prefersReplyPart
    ? (partCandidate ?? sourceCandidate)
    : prefersCreatedSource
      ? (sourceCandidate ?? partCandidate)
      : (partCandidate ?? sourceCandidate);

  if (!selected) {
    return null;
  }

  const messageText = selected.messageText;
  const messageId = selected.messageId;
  const occurredAt = selected.occurredAt;

  const rawEventId = toStringOrNull(data?.id);
  const timestamp = occurredAt ?? new Date().toISOString();
  const eventId = rawEventId
    ? `intercom:${rawEventId}`
    : buildFallbackEventKey({
        conversationId,
        messageId,
        messageText,
        topic,
        occurredAt,
      });

  return {
    eventId,
    idempotencyKey: eventId,
    conversationId,
    contactId: toStringOrNull(conversation?.contacts?.contacts?.[0]?.id),
    messageId,
    messageText,
    customerName: deriveCustomerName(conversation),
    conversationLink: deriveConversationLink(conversation),
    occurredAt: timestamp,
  };
}
