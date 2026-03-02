# Troubleshooting

## Slack events not arriving

- Confirm Event Subscriptions are enabled.
- Verify Request URL points to `/webhooks/slack/events`.
- Check bot scopes and reinstall app after scope changes.
- Confirm bot has been invited to target channel.

## Intercom webhooks failing

- Confirm webhook URL points to `/webhooks/intercom`.
- Ensure `INTERCOM_WEBHOOK_SECRET` matches Intercom configuration.
- Verify server returns 200 for valid signed payloads.

## Messages not appearing in thread

- Check `conversation_threads` table for mapping row.
- In escalation-only mode, no mapping is created until handoff event arrives.
- Verify `SLACK_DEFAULT_CHANNEL_ID` is correct.
- Check logs for Slack API errors.

## AI conversations not visible in Slack

- This is expected when `ROUTING_MODE=escalation_only`.
- Verify Intercom webhook includes handoff topics:
  - `conversation.admin.assigned`
  - `conversation.admin.open.assigned`
  - `conversation.admin.replied`
- Verify AI topic is enabled for tracking:
  - `conversation.operator.replied` (if supported)
- Confirm logs include `Created Slack thread on human handoff` after escalation.

## Slack replies not reaching Intercom

- Ensure replies are posted in thread, not channel root.
- Confirm `INTERCOM_ADMIN_ID` is valid for the workspace.
- Verify Intercom access token has write permission.

## High duplicate volume

- Inspect provider retry behavior and endpoint availability.
- Confirm unique indexes exist in database tables.
- Ensure enqueue failures return non-2xx to trigger proper retries.
