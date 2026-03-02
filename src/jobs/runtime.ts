import { logger } from "../config/logger.js";
import { getEnv } from "../config/env.js";
import { getDb } from "../db/client.js";
import { PostgresBridgeStore } from "../db/store.js";
import { IntercomClient } from "../lib/intercom/client.js";
import { SlackClient } from "../lib/slack/client.js";
import { createIntercomSyncHandler, createSlackSyncHandler } from "./sync-events.js";

const env = getEnv();

const store = new PostgresBridgeStore(getDb());
const slackClient = new SlackClient(env.SLACK_BOT_TOKEN);
const intercomClient = new IntercomClient(env.INTERCOM_ACCESS_TOKEN, env.INTERCOM_ADMIN_ID);

const deps = {
  store,
  slackClient,
  intercomClient,
  logger,
  slackDefaultChannelId: env.SLACK_DEFAULT_CHANNEL_ID,
};

export const intercomSyncHandler = createIntercomSyncHandler(deps);
export const slackSyncHandler = createSlackSyncHandler(deps);
