import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyIntercomSignature, verifySlackSignature } from "../src/lib/security/signatures.js";

describe("verifySlackSignature", () => {
  it("accepts valid Slack signature", () => {
    const rawBody = JSON.stringify({ hello: "world" });
    const secret = "slack-secret";
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const base = `v0:${timestamp}:${rawBody}`;
    const signature = `v0=${createHmac("sha256", secret).update(base).digest("hex")}`;

    const result = verifySlackSignature({
      rawBody,
      signingSecret: secret,
      signature,
      timestamp,
    });

    expect(result.ok).toBe(true);
  });

  it("rejects stale timestamp", () => {
    const rawBody = JSON.stringify({ hello: "world" });
    const secret = "slack-secret";
    const nowMs = Date.now();
    const timestamp = Math.floor(nowMs / 1000 - 301).toString();
    const base = `v0:${timestamp}:${rawBody}`;
    const signature = `v0=${createHmac("sha256", secret).update(base).digest("hex")}`;

    const result = verifySlackSignature({
      rawBody,
      signingSecret: secret,
      signature,
      timestamp,
      nowMs,
    });

    expect(result).toEqual({ ok: false, reason: "Slack timestamp outside replay window" });
  });
});

describe("verifyIntercomSignature", () => {
  it("accepts valid Intercom sha1 signature", () => {
    const rawBody = JSON.stringify({ test: true });
    const secret = "intercom-secret";
    const digest = createHmac("sha1", secret).update(rawBody).digest("hex");

    const result = verifyIntercomSignature({
      rawBody,
      webhookSecret: secret,
      signature: `sha1=${digest}`,
    });

    expect(result.ok).toBe(true);
  });

  it("rejects invalid Intercom signature", () => {
    const result = verifyIntercomSignature({
      rawBody: JSON.stringify({ test: true }),
      webhookSecret: "intercom-secret",
      signature: "sha1=bad",
    });

    expect(result).toEqual({ ok: false, reason: "Intercom signature mismatch" });
  });
});
