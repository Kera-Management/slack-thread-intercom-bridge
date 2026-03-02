import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { Context } from "hono";
import type { Logger } from "pino";
import type { QueuePublisher } from "./lib/contracts.js";
import { getHeader } from "./lib/http/headers.js";
import { createIntercomWebhookHandler } from "./routes/webhooks/intercom.js";
import { createSlackWebhookHandler } from "./routes/webhooks/slack.js";

export interface AppDependencies {
  queuePublisher: QueuePublisher;
  logger: Logger;
  intercomWebhookSecret: string;
  slackSigningSecret: string;
  inngestHandler: (c: Context) => Promise<Response>;
}

function getRequestMeta(c: Context): { method: string; path: string } {
  const rawRequest = c.req.raw as { method?: unknown; url?: unknown } | undefined;
  const method = typeof rawRequest?.method === "string" ? rawRequest.method : c.req.method;

  if (typeof rawRequest?.url === "string") {
    try {
      return {
        method,
        path: new URL(rawRequest.url, "http://localhost").pathname,
      };
    } catch {
      return { method, path: rawRequest.url };
    }
  }

  return { method, path: c.req.path };
}

export function createApp(deps: AppDependencies) {
  const app = new Hono();

  app.use("*", async (c, next) => {
    const requestId = getHeader(c, "x-request-id") ?? randomUUID();
    const startMs = Date.now();
    const requestMeta = getRequestMeta(c);

    deps.logger.info(
      {
        requestId,
        method: requestMeta.method,
        path: requestMeta.path,
      },
      "Incoming request",
    );

    await next();
    c.header("x-request-id", requestId);

    deps.logger.info(
      {
        requestId,
        method: requestMeta.method,
        path: requestMeta.path,
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
