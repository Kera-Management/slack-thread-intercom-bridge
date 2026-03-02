import type { Context } from "hono";
import type { Logger } from "pino";
import type { QueuePublisher } from "../../lib/contracts.js";
import { verifyIntercomSignature } from "../../lib/security/signatures.js";

export interface IntercomWebhookRouteDeps {
  queuePublisher: QueuePublisher;
  intercomWebhookSecret: string;
  logger: Logger;
}

export function createIntercomWebhookHandler(deps: IntercomWebhookRouteDeps) {
  return async (c: Context) => {
    const rawBody = await c.req.raw.text();
    const signature = c.req.header("x-hub-signature") ?? null;
    const signature256 = c.req.header("x-hub-signature-256") ?? null;

    const verified = verifyIntercomSignature({
      rawBody,
      webhookSecret: deps.intercomWebhookSecret,
      signature,
      signature256,
    });

    if (!verified.ok) {
      deps.logger.warn({ reason: verified.reason }, "Rejected Intercom webhook: invalid signature");
      return c.json({ error: "Invalid signature" }, 401);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return c.json({ error: "Malformed JSON payload" }, 400);
    }

    try {
      await deps.queuePublisher.publishIntercomEvent(parsed);
    } catch (error) {
      deps.logger.error({ err: error }, "Failed to enqueue Intercom event");
      return c.json({ error: "Event enqueue failed" }, 500);
    }

    return c.json({ ok: true }, 200);
  };
}
