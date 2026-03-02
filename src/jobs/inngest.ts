import { Inngest } from "inngest";
import { getEnv } from "../config/env.js";

const env = getEnv();

export const inngest = new Inngest({
  id: "intercom-slack-bridge",
  eventKey: env.INGGEST_EVENT_KEY,
});
