import type { Logger } from "pino";
import type { QueuePublisher } from "../lib/contracts.js";
import { inngest } from "./inngest.js";

export class InngestPublisher implements QueuePublisher {
  constructor(private readonly logger: Logger) {}

  async publishIntercomEvent(payload: unknown): Promise<void> {
    const intercomPayload = payload as any;
    this.logger.info(
      {
        eventSource: "intercom",
        ingressEvent: "intercom/event.received",
        intercomEventId: intercomPayload?.id ?? null,
        topic: intercomPayload?.topic ?? null,
      },
      "Publishing Intercom event to Inngest",
    );

    await inngest.send({
      name: "intercom/event.received",
      data: {
        payload,
      },
    });
  }

  async publishSlackEvent(payload: unknown): Promise<void> {
    const slackPayload = payload as any;
    this.logger.info(
      {
        eventSource: "slack",
        ingressEvent: "slack/event.received",
        slackEventId: slackPayload?.event_id ?? null,
        slackEventType: slackPayload?.event?.type ?? slackPayload?.type ?? null,
      },
      "Publishing Slack event to Inngest",
    );

    await inngest.send({
      name: "slack/event.received",
      data: {
        payload,
      },
    });
  }
}
