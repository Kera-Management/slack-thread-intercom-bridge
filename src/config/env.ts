import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_BASE_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),
  SLACK_BOT_TOKEN: z.string().min(1),
  SLACK_SIGNING_SECRET: z.string().min(1),
  SLACK_DEFAULT_CHANNEL_ID: z.string().min(1),
  INTERCOM_ACCESS_TOKEN: z.string().min(1),
  INTERCOM_ADMIN_ID: z.string().min(1),
  INTERCOM_WEBHOOK_SECRET: z.string().min(1),
  ROUTING_MODE: z.enum(["escalation_only"]).default("escalation_only"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  INGGEST_EVENT_KEY: z.string().min(1),
  INGGEST_SIGNING_KEY: z.string().min(1),
});

export type Env = z.infer<typeof EnvSchema>;

let cachedEnv: Env | null = null;

export function getEnv(): Env {
  if (cachedEnv) {
    return cachedEnv;
  }

  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment variables: ${parsed.error.message}`);
  }

  cachedEnv = parsed.data;
  return cachedEnv;
}
