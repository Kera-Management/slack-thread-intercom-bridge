import { createHmac } from "node:crypto";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app-factory.js";
import type { QueuePublisher } from "../src/lib/contracts.js";

class FakeQueuePublisher implements QueuePublisher {
  public intercomEvents: unknown[] = [];
  public slackEvents: unknown[] = [];

  async publishIntercomEvent(payload: unknown): Promise<void> {
    this.intercomEvents.push(payload);
  }

  async publishSlackEvent(payload: unknown): Promise<void> {
    this.slackEvents.push(payload);
  }
}

function signIntercom(rawBody: string, secret: string): string {
  return `sha1=${createHmac("sha1", secret).update(rawBody).digest("hex")}`;
}

function signSlack(rawBody: string, secret: string, timestamp: string): string {
  return `v0=${createHmac("sha256", secret)
    .update(`v0:${timestamp}:${rawBody}`)
    .digest("hex")}`;
}

describe("webhook routes", () => {
  it("accepts valid Intercom webhook and enqueues payload", async () => {
    const queue = new FakeQueuePublisher();
    const app = createApp({
      queuePublisher: queue,
      logger: pino({ enabled: false }),
      intercomWebhookSecret: "intercom-secret",
      slackSigningSecret: "slack-secret",
      inngestHandler: async () => new Response("ok", { status: 200 }),
    });

    const payload = { id: "ev_1", topic: "conversation.user.created" };
    const rawBody = JSON.stringify(payload);

    const response = await app.request("/webhooks/intercom", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-hub-signature": signIntercom(rawBody, "intercom-secret"),
      },
      body: rawBody,
    });

    expect(response.status).toBe(200);
    expect(queue.intercomEvents).toHaveLength(1);
  });

  it("rejects invalid Slack signature", async () => {
    const queue = new FakeQueuePublisher();
    const app = createApp({
      queuePublisher: queue,
      logger: pino({ enabled: false }),
      intercomWebhookSecret: "intercom-secret",
      slackSigningSecret: "slack-secret",
      inngestHandler: async () => new Response("ok", { status: 200 }),
    });

    const payload = { type: "event_callback", event_id: "Ev_1", event: { type: "message" } };
    const rawBody = JSON.stringify(payload);

    const response = await app.request("/webhooks/slack/events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-slack-signature": "v0=invalid",
        "x-slack-request-timestamp": Math.floor(Date.now() / 1000).toString(),
      },
      body: rawBody,
    });

    expect(response.status).toBe(401);
    expect(queue.slackEvents).toHaveLength(0);
  });

  it("handles Slack url_verification challenge", async () => {
    const queue = new FakeQueuePublisher();
    const app = createApp({
      queuePublisher: queue,
      logger: pino({ enabled: false }),
      intercomWebhookSecret: "intercom-secret",
      slackSigningSecret: "slack-secret",
      inngestHandler: async () => new Response("ok", { status: 200 }),
    });

    const payload = { type: "url_verification", challenge: "abc123" };
    const rawBody = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000).toString();

    const response = await app.request("/webhooks/slack/events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-slack-signature": signSlack(rawBody, "slack-secret", timestamp),
        "x-slack-request-timestamp": timestamp,
      },
      body: rawBody,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ challenge: "abc123" });
    expect(queue.slackEvents).toHaveLength(0);
  });
});
