import type { Logger } from "pino";
import type { BridgeStore, IntercomApi, SlackApi } from "../lib/contracts.js";
import { normalizeIntercomWebhook } from "../lib/normalize/intercom.js";
import { normalizeSlackEvent } from "../lib/normalize/slack.js";
import { redactPii } from "../config/logger.js";

export interface SyncDependencies {
  store: BridgeStore;
  slackClient: SlackApi;
  intercomClient: IntercomApi;
  logger: Logger;
  slackDefaultChannelId: string;
}

export function formatSlackRootMessage(input: {
  customerName: string;
  messageText: string;
  conversationId: string;
  conversationLink: string | null;
}): string {
  const lines = [`*${input.customerName}* wrote:`, input.messageText, `Intercom conversation: ${input.conversationId}`];

  if (input.conversationLink) {
    lines.push(input.conversationLink);
  }

  return lines.join("\n");
}

export function formatSlackThreadCustomerReply(messageText: string): string {
  return `Customer: ${messageText}`;
}

export function createIntercomSyncHandler(deps: SyncDependencies) {
  return {
    handle: async (payload: unknown): Promise<{ status: string }> => {
      const normalized = normalizeIntercomWebhook(payload);
      if (!normalized) {
        deps.logger.debug({ source: "intercom" }, "Skipping non-customer Intercom event");
        return { status: "ignored_non_customer" };
      }

      deps.logger.info(
        {
          source: "intercom",
          eventId: normalized.eventId,
          conversationId: normalized.conversationId,
          messageId: normalized.messageId,
        },
        "Processing normalized Intercom event",
      );

      const isNew = await deps.store.markEventProcessed("intercom", normalized.idempotencyKey);
      if (!isNew) {
        deps.logger.info({ eventId: normalized.eventId }, "Duplicate Intercom event ignored");
        return { status: "duplicate" };
      }

      let thread = await deps.store.getThreadByIntercomConversationId(normalized.conversationId);

      if (!thread) {
        const rootText = formatSlackRootMessage({
          customerName: normalized.customerName,
          messageText: normalized.messageText,
          conversationId: normalized.conversationId,
          conversationLink: normalized.conversationLink,
        });

        const posted = await deps.slackClient.postMessage({
          channelId: deps.slackDefaultChannelId,
          text: rootText,
        });

        thread = await deps.store.createConversationThread({
          intercomConversationId: normalized.conversationId,
          intercomContactId: normalized.contactId,
          slackChannelId: deps.slackDefaultChannelId,
          slackThreadTs: posted.ts,
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
          "Created Slack thread for Intercom conversation",
        );

        return { status: "created_thread" };
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
