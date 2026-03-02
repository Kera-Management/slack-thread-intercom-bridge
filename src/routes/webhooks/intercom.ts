import { randomUUID } from "node:crypto";
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
    const requestId = c.req.header("x-request-id") ?? randomUUID();
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
      deps.logger.warn(
        { requestId, reason: verified.reason },
        "Rejected Intercom webhook: invalid signature",
      );
      return c.json({ error: "Invalid signature" }, 401);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      deps.logger.warn({ requestId }, "Rejected Intercom webhook: malformed JSON payload");
      return c.json({ error: "Malformed JSON payload" }, 400);
    }

    const payload = parsed as any;
    deps.logger.info(
      {
        requestId,
        eventSource: "intercom",
        intercomEventId: payload?.id ?? null,
        topic: payload?.topic ?? null,
      },
      "Accepted Intercom webhook payload",
    );

    try {
      await deps.queuePublisher.publishIntercomEvent(parsed);
    } catch (error) {
      deps.logger.error({ err: error, requestId }, "Failed to enqueue Intercom event");
      return c.json({ error: "Event enqueue failed" }, 500);
    }

    deps.logger.info({ requestId, eventSource: "intercom" }, "Intercom webhook enqueued");
    return c.json({ ok: true }, 200);
  };
}
