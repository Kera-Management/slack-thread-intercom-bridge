import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { Context } from "hono";
import type { Logger } from "pino";
import type { QueuePublisher } from "./lib/contracts.js";
import { createIntercomWebhookHandler } from "./routes/webhooks/intercom.js";
import { createSlackWebhookHandler } from "./routes/webhooks/slack.js";

export interface AppDependencies {
  queuePublisher: QueuePublisher;
  logger: Logger;
  intercomWebhookSecret: string;
  slackSigningSecret: string;
  inngestHandler: (c: Context) => Promise<Response>;
}

export function createApp(deps: AppDependencies) {
  const app = new Hono();

  app.use("*", async (c, next) => {
    const requestId = c.req.header("x-request-id") ?? randomUUID();
    const startMs = Date.now();

    deps.logger.info(
      {
        requestId,
        method: c.req.method,
        path: c.req.path,
      },
      "Incoming request",
    );

    await next();
    c.header("x-request-id", requestId);

    deps.logger.info(
      {
        requestId,
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs: Date.now() - startMs,
      },
      "Request completed",
    );
  });

  app.get("/healthz", (c) => c.json({ ok: true, service: "slack-thread-intercom-bridge" }, 200));

  app.post(
    "/webhooks/intercom",
    createIntercomWebhookHandler({
      queuePublisher: deps.queuePublisher,
      intercomWebhookSecret: deps.intercomWebhookSecret,
      logger: deps.logger,
    }),
  );

  app.post(
    "/webhooks/slack/events",
    createSlackWebhookHandler({
      queuePublisher: deps.queuePublisher,
      slackSigningSecret: deps.slackSigningSecret,
      logger: deps.logger,
    }),
  );

  app.on(["GET", "POST", "PUT"], "/api/inngest", deps.inngestHandler);

  app.onError((error, c) => {
    deps.logger.error({ err: error }, "Unhandled application error");
    return c.json({ error: "Internal server error" }, 500);
  });

  return app;
}
