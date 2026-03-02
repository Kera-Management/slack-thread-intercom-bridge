import type { Logger } from "pino";
import type {
  BridgeStore,
  IntercomApi,
  SlackApi,
} from "../lib/contracts.js";
import { redactPii } from "../config/logger.js";
import { normalizeIntercomWebhook } from "../lib/normalize/intercom.js";
import { normalizeSlackEvent } from "../lib/normalize/slack.js";
import type { HandoffReason, RoutingMode } from "../types/events.js";

export interface SyncDependencies {
  store: BridgeStore;
  slackClient: SlackApi;
  intercomClient: IntercomApi;
  logger: Logger;
  slackDefaultChannelId: string;
  routingMode: RoutingMode;
}

interface ConversationSummary {
  customerName: string;
  contactId: string | null;
  conversationLink: string | null;
  latestCustomerMessageId: string | null;
  latestCustomerMessageText: string | null;
}

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

function formatSlackQuote(messageText: string): string {
  return messageText
    .split(/\r?\n/)
    .map((line) => (line.trim().length > 0 ? `> ${line}` : ">"))
    .join("\n");
}

function getHandoffReasonLabel(reason: HandoffReason): string {
  if (reason === "assigned_to_admin") {
    return "Assigned to admin";
  }

  return "Admin replied";
}

function deriveConversationRef(input: {
  conversationId: string;
  conversationLink: string | null;
}): string {
  return input.conversationLink
    ? `<${input.conversationLink}|${input.conversationId}>`
    : `\`${input.conversationId}\``;
}

export function formatSlackEscalationRootMessage(input: {
  customerName: string;
  conversationId: string;
  conversationLink: string | null;
  handoffReason: HandoffReason;
  latestCustomerMessageText: string | null;
  aiHandledBeforeEscalation: boolean;
}): string {
  const latestCustomerMessage =
    input.latestCustomerMessageText && input.latestCustomerMessageText.trim().length > 0
      ? input.latestCustomerMessageText
      : "No customer message available yet.";

  const lines = [
    "*Escalated to human support*",
    `*From:* ${input.customerName}`,
    `*Conversation:* ${deriveConversationRef({
      conversationId: input.conversationId,
      conversationLink: input.conversationLink,
    })}`,
    `*Reason:* ${getHandoffReasonLabel(input.handoffReason)}`,
  ];

  if (input.aiHandledBeforeEscalation) {
    lines.push("_AI handled this conversation before escalation._");
  }

  lines.push("*Latest customer message:*");
  lines.push(formatSlackQuote(latestCustomerMessage));

  return lines.join("\n");
}

export function formatSlackThreadCustomerReply(messageText: string): string {
  return `Customer: ${messageText}`;
}

function deriveConversation(payload: any): any {
  return payload?.data?.item ?? payload?.item ?? payload?.data?.conversation ?? payload?.conversation ?? payload;
}

function getLatestCustomerSummary(conversation: any): {
  latestCustomerMessageId: string | null;
  latestCustomerMessageText: string | null;
} {
  const parts = conversation?.conversation_parts?.conversation_parts;
  if (Array.isArray(parts)) {
    for (let index = parts.length - 1; index >= 0; index -= 1) {
      const part = parts[index];
      if (!isCustomerAuthor(part?.author?.type)) {
        continue;
      }

      const body = toStringOrNull(part?.body);
      if (!body) {
        continue;
      }

      const text = htmlToText(body);
      if (!text) {
        continue;
      }

      return {
        latestCustomerMessageId: toStringOrNull(part?.id),
        latestCustomerMessageText: text,
      };
    }
  }

  const sourceBody = toStringOrNull(conversation?.source?.body);
  if (sourceBody && isCustomerAuthor(conversation?.source?.author?.type)) {
    const text = htmlToText(sourceBody);
    if (text) {
      return {
        latestCustomerMessageId: toStringOrNull(conversation?.source?.id),
        latestCustomerMessageText: text,
      };
    }
  }

  return { latestCustomerMessageId: null, latestCustomerMessageText: null };
}

function extractConversationSummary(payload: unknown): ConversationSummary | null {
  const conversation = deriveConversation(payload as any);
  const conversationId = toStringOrNull(conversation?.id);
  if (!conversation || !conversationId) {
    return null;
  }

  const contacts = conversation?.contacts?.contacts;
  const firstContact = Array.isArray(contacts) && contacts.length > 0 ? contacts[0] : null;

  const conversationLink =
    toStringOrNull(conversation?.links?.conversation_web) ??
    toStringOrNull(conversation?.links?.conversation) ??
    toStringOrNull(conversation?.link) ??
    toStringOrNull(conversation?.url);

  const customerName = toStringOrNull(firstContact?.name) ?? "Visitor";
  const contactId = toStringOrNull(firstContact?.id);
  const latestCustomer = getLatestCustomerSummary(conversation);

  return {
    customerName,
    contactId,
    conversationLink,
    latestCustomerMessageId: latestCustomer.latestCustomerMessageId,
    latestCustomerMessageText: latestCustomer.latestCustomerMessageText,
  };
}

export function createIntercomSyncHandler(deps: SyncDependencies) {
  return {
    handle: async (payload: unknown): Promise<{ status: string }> => {
      const normalized = normalizeIntercomWebhook(payload);
      if (!normalized) {
        deps.logger.debug({ source: "intercom" }, "Skipping malformed Intercom event payload");
        return { status: "ignored_malformed" };
      }

      if (normalized.kind === "ignore") {
        deps.logger.debug(
          {
            source: "intercom",
            eventId: normalized.eventId,
            conversationId: normalized.conversationId,
            topic: normalized.topic,
            ignoreReason: normalized.ignoreReason,
          },
          "Ignoring unsupported Intercom event",
        );
        return { status: "ignored_topic" };
      }

      deps.logger.info(
        {
          source: "intercom",
          kind: normalized.kind,
          eventId: normalized.eventId,
          conversationId: normalized.conversationId,
          topic: normalized.topic,
        },
        "Processing normalized Intercom event",
      );

      const isNew = await deps.store.markEventProcessed("intercom", normalized.idempotencyKey);
      if (!isNew) {
        deps.logger.info({ eventId: normalized.eventId }, "Duplicate Intercom event ignored");
        return { status: "duplicate" };
      }

      if (normalized.kind === "ai_activity") {
        await deps.store.upsertLifecycle({
          intercomConversationId: normalized.conversationId,
          lastTopic: normalized.topic,
          aiActive: true,
        });

        deps.logger.info(
          {
            conversationId: normalized.conversationId,
            topic: normalized.topic,
            aiSource: normalized.aiSource,
          },
          "Recorded AI activity for conversation",
        );

        return { status: "tracked_ai_activity" };
      }

      if (normalized.kind === "customer_message") {
        await deps.store.upsertLifecycle({
          intercomConversationId: normalized.conversationId,
          lastTopic: normalized.topic,
          lastCustomerMessageId: normalized.messageId,
          lastCustomerMessageText: normalized.messageText,
        });

        const thread = await deps.store.getThreadByIntercomConversationId(normalized.conversationId);
        if (!thread && deps.routingMode === "escalation_only") {
          deps.logger.info(
            {
              conversationId: normalized.conversationId,
              topic: normalized.topic,
            },
            "Skipping customer message before human handoff",
          );
          return { status: "ignored_pre_handoff" };
        }

        if (!thread) {
          deps.logger.warn(
            { conversationId: normalized.conversationId },
            "Routing mode requires thread, but no thread mapping found",
          );
          return { status: "ignored_missing_thread" };
        }

        const replyText = formatSlackThreadCustomerReply(normalized.messageText);
        const posted = await deps.slackClient.postMessage({
          channelId: thread.slackChannelId,
          threadTs: thread.slackThreadTs,
          text: replyText,
        });

        await deps.store.createMessageLink({
          intercomConversationId: normalized.conversationId,
          intercomPartId: normalized.messageId,
          slackChannelId: thread.slackChannelId,
          slackTs: posted.ts,
          direction: "intercom_to_slack",
        });
        await deps.store.touchConversationThread(thread.id);

        deps.logger.info(
          { conversationId: normalized.conversationId, threadTs: thread.slackThreadTs },
          "Posted Intercom follow-up into Slack thread",
        );

        return { status: "posted_to_thread" };
      }

      if (normalized.kind === "handoff") {
        const lifecycle = await deps.store.upsertLifecycle({
          intercomConversationId: normalized.conversationId,
          lastTopic: normalized.topic,
          humanHandoffDetected: true,
          lastCustomerMessageId:
            normalized.latestCustomerMessageId !== null ? normalized.latestCustomerMessageId : undefined,
          lastCustomerMessageText:
            normalized.latestCustomerMessageText !== null ? normalized.latestCustomerMessageText : undefined,
        });

        const existingThread = await deps.store.getThreadByIntercomConversationId(normalized.conversationId);
        if (existingThread) {
          deps.logger.info(
            { conversationId: normalized.conversationId, threadTs: existingThread.slackThreadTs },
            "Handoff received for already-mapped conversation",
          );
          return { status: "handoff_already_mapped" };
        }

        let summary: ConversationSummary = {
          customerName: normalized.customerName,
          contactId: normalized.contactId,
          conversationLink: normalized.conversationLink,
          latestCustomerMessageId:
            lifecycle.lastCustomerMessageId ?? normalized.latestCustomerMessageId ?? null,
          latestCustomerMessageText:
            lifecycle.lastCustomerMessageText ?? normalized.latestCustomerMessageText ?? null,
        };

        if (!summary.latestCustomerMessageText || !summary.conversationLink) {
          try {
            const fetchedConversation = await deps.intercomClient.getConversation(normalized.conversationId);
            const fetchedSummary = extractConversationSummary(fetchedConversation);
            if (fetchedSummary) {
              summary = {
                customerName: summary.customerName || fetchedSummary.customerName,
                contactId: summary.contactId ?? fetchedSummary.contactId,
                conversationLink: summary.conversationLink ?? fetchedSummary.conversationLink,
                latestCustomerMessageId:
                  summary.latestCustomerMessageId ?? fetchedSummary.latestCustomerMessageId,
                latestCustomerMessageText:
                  summary.latestCustomerMessageText ?? fetchedSummary.latestCustomerMessageText,
              };

              if (!lifecycle.lastCustomerMessageText && fetchedSummary.latestCustomerMessageText) {
                await deps.store.upsertLifecycle({
                  intercomConversationId: normalized.conversationId,
                  lastTopic: normalized.topic,
                  lastCustomerMessageId:
                    fetchedSummary.latestCustomerMessageId !== null
                      ? fetchedSummary.latestCustomerMessageId
                      : undefined,
                  lastCustomerMessageText: fetchedSummary.latestCustomerMessageText,
                });
              }
            }
          } catch (error) {
            deps.logger.warn(
              { err: error, conversationId: normalized.conversationId },
              "Failed to fetch Intercom conversation fallback summary",
            );
          }
        }

        const rootText = formatSlackEscalationRootMessage({
          customerName: summary.customerName || "Visitor",
          conversationId: normalized.conversationId,
          conversationLink: summary.conversationLink,
          handoffReason: normalized.handoffReason,
          latestCustomerMessageText: summary.latestCustomerMessageText,
          aiHandledBeforeEscalation: lifecycle.aiActive,
        });

        const posted = await deps.slackClient.postMessage({
          channelId: deps.slackDefaultChannelId,
          text: rootText,
        });

        const thread = await deps.store.createConversationThread({
          intercomConversationId: normalized.conversationId,
          intercomContactId: summary.contactId,
          slackChannelId: deps.slackDefaultChannelId,
          slackThreadTs: posted.ts,
          bridgeMode: "escalated",
          activationReason: "admin_assigned_or_replied",
        });

        await deps.store.createMessageLink({
          intercomConversationId: normalized.conversationId,
          intercomPartId: summary.latestCustomerMessageId,
          slackChannelId: thread.slackChannelId,
          slackTs: posted.ts,
          direction: "intercom_to_slack",
        });
        await deps.store.touchConversationThread(thread.id);

        deps.logger.info(
          { conversationId: normalized.conversationId, threadTs: thread.slackThreadTs },
          "Created Slack thread on human handoff",
        );

        return { status: "created_thread_on_handoff" };
      }

      return { status: "ignored_topic" };
    },
  };
}

export function createSlackSyncHandler(deps: SyncDependencies) {
  return {
    handle: async (payload: unknown): Promise<{ status: string }> => {
      const normalized = normalizeSlackEvent(payload);
      if (!normalized) {
        deps.logger.debug({ source: "slack" }, "Skipping unsupported Slack event");
        return { status: "ignored_unsupported" };
      }

      deps.logger.info(
        {
          source: "slack",
          eventId: normalized.eventId,
          channelId: normalized.channelId,
          threadTs: normalized.threadTs,
          messageTs: normalized.messageTs,
        },
        "Processing normalized Slack event",
      );

      const isNew = await deps.store.markEventProcessed("slack", normalized.idempotencyKey);
      if (!isNew) {
        deps.logger.info({ eventId: normalized.eventId }, "Duplicate Slack event ignored");
        return { status: "duplicate" };
      }

      const thread = await deps.store.getThreadBySlackThread(normalized.channelId, normalized.threadTs);
      if (!thread) {
        deps.logger.info(
          { channelId: normalized.channelId, threadTs: normalized.threadTs },
          "Slack thread has no Intercom mapping, ignoring",
        );
        return { status: "ignored_unmapped_thread" };
      }

      await deps.intercomClient.replyToConversation({
        conversationId: thread.intercomConversationId,
        messageText: normalized.text,
      });

      await deps.store.createMessageLink({
        intercomConversationId: thread.intercomConversationId,
        intercomPartId: null,
        slackChannelId: normalized.channelId,
        slackTs: normalized.messageTs,
        direction: "slack_to_intercom",
      });
      await deps.store.touchConversationThread(thread.id);

      deps.logger.info(
        {
          conversationId: thread.intercomConversationId,
          channelId: normalized.channelId,
          threadTs: normalized.threadTs,
          messageTs: normalized.messageTs,
          slackUserId: normalized.userId,
          preview: redactPii(normalized.text),
        },
        "Synced Slack thread reply to Intercom",
      );

      return { status: "replied_to_intercom" };
    },
  };
}
