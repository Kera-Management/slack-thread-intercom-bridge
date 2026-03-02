import type { QueuePublisher } from "../lib/contracts.js";
import { inngest } from "./inngest.js";

export class InngestPublisher implements QueuePublisher {
  async publishIntercomEvent(payload: unknown): Promise<void> {
    await inngest.send({
      name: "intercom/event.received",
      data: {
        payload,
      },
    });
  }

  async publishSlackEvent(payload: unknown): Promise<void> {
    await inngest.send({
      name: "slack/event.received",
      data: {
        payload,
      },
    });
  }
}
