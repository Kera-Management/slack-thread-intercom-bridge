import { createHash } from "node:crypto";
import type { NormalizedSlackEvent } from "../../types/events.js";

function toStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function buildFallbackEventId(input: {
  channelId: string;
  threadTs: string;
  messageTs: string;
  userId: string;
}): string {
  const hash = createHash("sha256")
    .update(`${input.channelId}:${input.threadTs}:${input.messageTs}:${input.userId}`)
    .digest("hex");
  return `slack-fallback:${hash}`;
}

export function normalizeSlackEvent(payload: unknown): NormalizedSlackEvent | null {
  const body = payload as any;
  const event = body?.event;

  if (!event || event.type !== "message") {
    return null;
  }

  if (event.subtype || event.bot_id || event.app_id) {
    return null;
  }

  const channelId = toStringOrNull(event.channel);
  const threadTs = toStringOrNull(event.thread_ts);
  const messageTs = toStringOrNull(event.ts);
  const userId = toStringOrNull(event.user);
  const text = toStringOrNull(event.text);

  if (!channelId || !threadTs || !messageTs || !userId || !text) {
    return null;
  }

  const rawEventId = toStringOrNull(body?.event_id);
  const eventId = rawEventId
    ? `slack:${rawEventId}`
    : buildFallbackEventId({ channelId, threadTs, messageTs, userId });

  return {
    eventId,
    idempotencyKey: eventId,
    channelId,
    threadTs,
    messageTs,
    userId,
    text,
  };
}
