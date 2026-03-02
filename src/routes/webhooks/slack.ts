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
      deps.logger.warn({ reason: verified.reason }, "Rejected Slack webhook: invalid signature");
      return c.json({ error: "Invalid signature" }, 401);
    }

    let parsed: any;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return c.json({ error: "Malformed JSON payload" }, 400);
    }

    if (parsed?.type === "url_verification" && typeof parsed.challenge === "string") {
      return c.json({ challenge: parsed.challenge }, 200);
    }

    try {
      await deps.queuePublisher.publishSlackEvent(parsed);
    } catch (error) {
      deps.logger.error({ err: error }, "Failed to enqueue Slack event");
      return c.json({ error: "Event enqueue failed" }, 500);
    }

    return c.json({ ok: true }, 200);
  };
}
