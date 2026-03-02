import type {
  ActivationReason,
  BridgeMode,
  EventSource,
  MessageDirection,
  NormalizedIntercomWebhookEvent,
  NormalizedSlackEvent,
} from "../types/events.js";

export interface ConversationThreadRecord {
  id: string;
  intercomConversationId: string;
  intercomContactId: string | null;
  slackChannelId: string;
  slackThreadTs: string;
  bridgeMode: BridgeMode;
  activatedAt: Date;
  activationReason: ActivationReason;
  firstSeenAt: Date;
  lastSyncedAt: Date;
}

export interface ConversationLifecycleRecord {
  id: string;
  intercomConversationId: string;
  lastTopic: string;
  aiActive: boolean;
  humanHandoffDetected: boolean;
  lastCustomerMessageId: string | null;
  lastCustomerMessageText: string | null;
  updatedAt: Date;
}

export interface BridgeStore {
  markEventProcessed(source: EventSource, externalEventId: string): Promise<boolean>;
  getThreadByIntercomConversationId(
    intercomConversationId: string,
  ): Promise<ConversationThreadRecord | null>;
  getThreadBySlackThread(
    slackChannelId: string,
    slackThreadTs: string,
  ): Promise<ConversationThreadRecord | null>;
  createConversationThread(input: {
    intercomConversationId: string;
    intercomContactId: string | null;
    slackChannelId: string;
    slackThreadTs: string;
    bridgeMode: BridgeMode;
    activationReason: ActivationReason;
    activatedAt?: Date;
  }): Promise<ConversationThreadRecord>;
  getLifecycleByConversationId(
    intercomConversationId: string,
  ): Promise<ConversationLifecycleRecord | null>;
  upsertLifecycle(input: {
    intercomConversationId: string;
    lastTopic: string;
    aiActive?: boolean;
    humanHandoffDetected?: boolean;
    lastCustomerMessageId?: string | null;
    lastCustomerMessageText?: string | null;
  }): Promise<ConversationLifecycleRecord>;
  touchConversationThread(threadId: string): Promise<void>;
  createMessageLink(input: {
    intercomConversationId: string;
    intercomPartId: string | null;
    slackChannelId: string;
    slackTs: string;
    direction: MessageDirection;
  }): Promise<void>;
}

export interface SlackApi {
  postMessage(input: {
    channelId: string;
    text: string;
    threadTs?: string;
  }): Promise<{ ts: string }>;
}

export interface IntercomApi {
  replyToConversation(input: {
    conversationId: string;
    messageText: string;
  }): Promise<void>;
  getConversation(conversationId: string): Promise<unknown>;
}

export interface QueuePublisher {
  publishIntercomEvent(payload: unknown): Promise<void>;
  publishSlackEvent(payload: unknown): Promise<void>;
}

export interface IntercomEventHandler {
  handle(payload: unknown): Promise<{ status: string }>;
}

export interface SlackEventHandler {
  handle(payload: unknown): Promise<{ status: string }>;
}

export type { NormalizedIntercomWebhookEvent, NormalizedSlackEvent };
