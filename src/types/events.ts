export type EventSource = "intercom" | "slack";
export type MessageDirection = "intercom_to_slack" | "slack_to_intercom";

export interface NormalizedIntercomEvent {
  eventId: string;
  idempotencyKey: string;
  conversationId: string;
  contactId: string | null;
  messageId: string | null;
  messageText: string;
  customerName: string;
  conversationLink: string | null;
  occurredAt: string;
}

export interface NormalizedSlackEvent {
  eventId: string;
  idempotencyKey: string;
  channelId: string;
  threadTs: string;
  messageTs: string;
  userId: string;
  text: string;
}
