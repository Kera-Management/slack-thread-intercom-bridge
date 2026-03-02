import { randomUUID } from "node:crypto";
import type { Context } from "hono";
import type { Logger } from "pino";
import type { QueuePublisher } from "../../lib/contracts.js";
import { verifySlackSignature } from "../../lib/security/signatures.js";

export interface SlackWebhookRouteDeps {
  queuePublisher: QueuePublisher;
  slackSigningSecret: string;
  logger: Logger;
}

export function createSlackWebhookHandler(deps: SlackWebhookRouteDeps) {
  return async (c: Context) => {
    const requestId = c.req.header("x-request-id") ?? randomUUID();
    const rawBody = await c.req.raw.text();
    const signature = c.req.header("x-slack-signature") ?? null;
    const timestamp = c.req.header("x-slack-request-timestamp") ?? null;

    const verified = verifySlackSignature({
      rawBody,
      signingSecret: deps.slackSigningSecret,
      signature,
      timestamp,
    });

    if (!verified.ok) {
      deps.logger.warn({ requestId, reason: verified.reason }, "Rejected Slack webhook: invalid signature");
      return c.json({ error: "Invalid signature" }, 401);
    }

    let parsed: any;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      deps.logger.warn({ requestId }, "Rejected Slack webhook: malformed JSON payload");
      return c.json({ error: "Malformed JSON payload" }, 400);
    }

    if (parsed?.type === "url_verification" && typeof parsed.challenge === "string") {
      deps.logger.info({ requestId, eventSource: "slack" }, "Handled Slack URL verification challenge");
      return c.json({ challenge: parsed.challenge }, 200);
    }

    deps.logger.info(
      {
        requestId,
        eventSource: "slack",
        slackEventId: parsed?.event_id ?? null,
        slackEventType: parsed?.event?.type ?? parsed?.type ?? null,
      },
      "Accepted Slack webhook payload",
    );

    try {
      await deps.queuePublisher.publishSlackEvent(parsed);
    } catch (error) {
      deps.logger.error({ err: error, requestId }, "Failed to enqueue Slack event");
      return c.json({ error: "Event enqueue failed" }, 500);
    }

    deps.logger.info({ requestId, eventSource: "slack" }, "Slack webhook enqueued");
    return c.json({ ok: true }, 200);
  };
}
