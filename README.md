# slack-thread-intercom-bridge

Open-source Intercom-to-Slack bridge that posts customer Intercom conversations into Slack threads and supports replying from Slack back to Intercom.

## Features

- Receives Intercom webhooks and posts into a configured Slack channel.
- Creates one Slack thread per Intercom conversation only after human handoff (escalation).
- Syncs Slack thread replies back to Intercom as admin comments.
- Suppresses AI-only conversations from Slack to avoid double customer responses.
- Verifies Slack and Intercom webhook signatures.
- Handles duplicate deliveries with idempotency tracking.
- Uses Inngest for asynchronous processing and retries.

## Stack

- Runtime: Node.js 20 + TypeScript + Hono
- Deploy target: Vercel (Node runtime)
- Database: Postgres + Drizzle ORM
- Queue/retries: Inngest
- Integrations: Slack Web API + Intercom REST API

## Quickstart

1. Install dependencies:

```bash
npm install
```

2. Copy environment file and update values:

```bash
cp .env.example .env
```

3. Create database schema:

```bash
npm run db:generate
npm run db:push
```

4. Start local server:

```bash
npm run dev
```

5. Expose local server for webhooks (example with ngrok):

```bash
ngrok http 3000
```

6. Configure providers:

- Intercom webhook URL: `https://<public-url>/webhooks/intercom`
- Slack Events URL: `https://<public-url>/webhooks/slack/events`
- Inngest endpoint: `https://<public-url>/api/inngest`

## HTTP Endpoints

- `GET /healthz`
- `POST /webhooks/intercom`
- `POST /webhooks/slack/events`
- `GET|POST|PUT /api/inngest`

## Required Slack App Settings

- Bot scopes:
  - `chat:write`
  - `channels:history`
  - `groups:history` (only if using private channels)
- Event subscriptions:
  - `message.channels`
  - `message.groups` (only if using private channels)
- Install app and invite bot user to `SLACK_DEFAULT_CHANNEL_ID`.

## Required Intercom Settings

- Personal access token with conversation read/write permissions.
- Webhook configured with secret and these topics:
  - `conversation.user.created`
  - `conversation.user.replied`
  - `conversation.admin.assigned`
  - `conversation.admin.open.assigned`
  - `conversation.admin.replied`
  - `conversation.operator.replied` (if available in your Intercom API version)
- `INTERCOM_ADMIN_ID` set to teammate/admin ID for outbound Slack replies.
- `INTERCOM_WEBHOOK_SECRET` set to your Intercom App Client Secret.
- `ROUTING_MODE=escalation_only` (default) to keep Slack silent until human handoff.

## Security Notes

- Keep tokens and secrets in environment variables only.
- Rotate leaked tokens immediately.
- Signature verification is enforced before payload processing.

## Testing

```bash
npm test
npm run build
```

## Deploying to Vercel

1. Create a Vercel project from this repository.
2. Set all env vars from `.env.example` in Vercel Project Settings.
3. Attach managed Postgres (Neon/Supabase/etc) and set `DATABASE_URL`.
4. Deploy.
5. Update Slack/Intercom webhook URLs to your Vercel domain.

See [docs/architecture.md](./docs/architecture.md) and [docs/troubleshooting.md](./docs/troubleshooting.md) for operational details.
