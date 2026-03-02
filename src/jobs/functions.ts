import { inngest } from "./inngest.js";
import { intercomSyncHandler, slackSyncHandler } from "./runtime.js";

export const processIntercomEvent = inngest.createFunction(
  { id: "process-intercom-event", retries: 6 },
  { event: "intercom/event.received" },
  async ({ event }) => {
    return intercomSyncHandler.handle(event.data.payload);
  },
);

export const processSlackEvent = inngest.createFunction(
  { id: "process-slack-event", retries: 6 },
  { event: "slack/event.received" },
  async ({ event }) => {
    return slackSyncHandler.handle(event.data.payload);
  },
);

export const inngestFunctions = [processIntercomEvent, processSlackEvent];
