import { serve as serveInngest } from "inngest/hono";
import { createApp } from "./app-factory.js";
import { getEnv } from "./config/env.js";
import { logger } from "./config/logger.js";
import { inngestFunctions } from "./jobs/functions.js";
import { inngest } from "./jobs/inngest.js";
import { InngestPublisher } from "./jobs/publisher.js";

export function createProductionApp() {
  const env = getEnv();
  const queuePublisher = new InngestPublisher(logger);

  const inngestHandler = serveInngest({
    client: inngest,
    functions: inngestFunctions,
    signingKey: env.INGGEST_SIGNING_KEY,
  });

  const app = createApp({
    queuePublisher,
    logger,
    intercomWebhookSecret: env.INTERCOM_WEBHOOK_SECRET,
    slackSigningSecret: env.SLACK_SIGNING_SECRET,
    inngestHandler,
  });

  logger.info(
    {
      service: "slack-thread-intercom-bridge",
      appBaseUrl: env.APP_BASE_URL,
      slackDefaultChannelId: env.SLACK_DEFAULT_CHANNEL_ID,
      nodeEnv: env.NODE_ENV,
    },
    "Application runtime initialized",
  );

  return app;
}
