import { createHmac, timingSafeEqual } from "node:crypto";

function safeCompare(expected: string, received: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);

  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, receivedBuffer);
}

export function verifySlackSignature(input: {
  rawBody: string;
  signingSecret: string;
  signature: string | null;
  timestamp: string | null;
  nowMs?: number;
}): { ok: true } | { ok: false; reason: string } {
  const { rawBody, signingSecret, signature, timestamp } = input;
  const nowMs = input.nowMs ?? Date.now();

  if (!signature || !timestamp) {
    return { ok: false, reason: "Missing Slack signature headers" };
  }

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) {
    return { ok: false, reason: "Invalid Slack timestamp" };
  }

  const ageSeconds = Math.abs(nowMs / 1000 - timestampSeconds);
  if (ageSeconds > 60 * 5) {
    return { ok: false, reason: "Slack timestamp outside replay window" };
  }

  const base = `v0:${timestamp}:${rawBody}`;
  const expected = `v0=${createHmac("sha256", signingSecret).update(base).digest("hex")}`;

  if (!safeCompare(expected, signature)) {
    return { ok: false, reason: "Slack signature mismatch" };
  }

  return { ok: true };
}

function parseIntercomSignature(signatureHeader: string): {
  algorithm: "sha1" | "sha256";
  digest: string;
} | null {
  const trimmed = signatureHeader.trim();
  if (!trimmed) {
    return null;
  }

  if (!trimmed.includes("=")) {
    return { algorithm: "sha1", digest: trimmed };
  }

  const [prefix, digest] = trimmed.split("=", 2);
  if (!digest) {
    return null;
  }

  if (prefix === "sha1") {
    return { algorithm: "sha1", digest };
  }

  if (prefix === "sha256") {
    return { algorithm: "sha256", digest };
  }

  return null;
}

export function verifyIntercomSignature(input: {
  rawBody: string;
  webhookSecret: string;
  signature: string | null;
  signature256?: string | null;
}): { ok: true } | { ok: false; reason: string } {
  const { rawBody, webhookSecret, signature, signature256 } = input;

  const parsed256 = signature256 ? parseIntercomSignature(signature256) : null;
  if (parsed256) {
    const expected = createHmac(parsed256.algorithm, webhookSecret).update(rawBody).digest("hex");
    if (safeCompare(expected, parsed256.digest)) {
      return { ok: true };
    }
  }

  const parsed = signature ? parseIntercomSignature(signature) : null;
  if (!parsed) {
    return { ok: false, reason: "Missing Intercom signature header" };
  }

  const expected = createHmac(parsed.algorithm, webhookSecret).update(rawBody).digest("hex");
  if (!safeCompare(expected, parsed.digest)) {
    return { ok: false, reason: "Intercom signature mismatch" };
  }

  return { ok: true };
}
