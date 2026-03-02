export type EventSource = "intercom" | "slack";
export type MessageDirection = "intercom_to_slack" | "slack_to_intercom";
export type RoutingMode = "escalation_only";
export type BridgeMode = "escalated";
export type ActivationReason = "admin_assigned_or_replied";
export type HandoffReason = "assigned_to_admin" | "admin_replied";

interface IntercomEventBase {
  eventId: string;
  idempotencyKey: string;
  conversationId: string;
  topic: string;
  occurredAt: string;
}

export interface NormalizedIntercomCustomerMessageEvent extends IntercomEventBase {
  kind: "customer_message";
  contactId: string | null;
  messageId: string | null;
  messageText: string;
  customerName: string;
  conversationLink: string | null;
}

export interface NormalizedIntercomHandoffEvent extends IntercomEventBase {
  kind: "handoff";
  handoffReason: HandoffReason;
  customerName: string;
  contactId: string | null;
  conversationLink: string | null;
  latestCustomerMessageId: string | null;
  latestCustomerMessageText: string | null;
}

export interface NormalizedIntercomAiActivityEvent extends IntercomEventBase {
  kind: "ai_activity";
  aiSource: "operator_replied" | "admin_replied_ai";
}

export interface NormalizedIntercomIgnoreEvent extends IntercomEventBase {
  kind: "ignore";
  ignoreReason: string;
}

export type NormalizedIntercomWebhookEvent =
  | NormalizedIntercomCustomerMessageEvent
  | NormalizedIntercomHandoffEvent
  | NormalizedIntercomAiActivityEvent
  | NormalizedIntercomIgnoreEvent;

export interface NormalizedSlackEvent {
  eventId: string;
  idempotencyKey: string;
  channelId: string;
  threadTs: string;
  messageTs: string;
  userId: string;
  text: string;
}
