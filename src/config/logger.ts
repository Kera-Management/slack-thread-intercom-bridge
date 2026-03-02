import pino from "pino";

const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_REGEX = /\+?[0-9][0-9\-().\s]{7,}[0-9]/g;

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.x-hub-signature",
      "req.headers.x-hub-signature-256",
      "req.headers.x-slack-signature",
      "headers.authorization",
      "headers.x-hub-signature",
      "headers.x-hub-signature-256",
      "headers.x-slack-signature",
      "*.token",
      "*.secret",
    ],
    censor: "[REDACTED]",
  },
});

export function redactPii(input: string): string {
  return input.replace(EMAIL_REGEX, "[REDACTED_EMAIL]").replace(PHONE_REGEX, "[REDACTED_PHONE]");
}
