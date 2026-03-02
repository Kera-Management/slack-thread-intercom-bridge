# Architecture

## Flow: Intercom -> Slack

1. Intercom sends webhook to `/webhooks/intercom`.
2. Service verifies `X-Hub-Signature` / `X-Hub-Signature-256`.
3. Payload is enqueued in Inngest (`intercom/event.received`).
4. Worker normalizes event and applies idempotency check (`processed_events`).
5. Worker finds or creates `conversation_threads` mapping.
6. Worker posts message to Slack root/thread and stores `message_links` audit row.

## Flow: Slack -> Intercom

1. Slack Events API sends webhook to `/webhooks/slack/events`.
2. Service verifies Slack signature and timestamp replay window.
3. Payload is enqueued in Inngest (`slack/event.received`).
4. Worker normalizes threaded human messages and deduplicates by event id.
5. Worker looks up `conversation_threads` mapping by `(channel, thread_ts)`.
6. Worker replies to Intercom conversation as configured admin.

## Data Model

- `conversation_threads`: conversation/thread mapping.
- `processed_events`: inbound idempotency ledger.
- `message_links`: audit trail for sent messages.

## Failure Handling

- Webhooks are fast-acknowledged only after enqueue succeeds.
- Inngest retries jobs up to 6 attempts with backoff.
- Duplicate webhooks are ignored via unique key constraints.
- Unmapped Slack threads are ignored safely.
