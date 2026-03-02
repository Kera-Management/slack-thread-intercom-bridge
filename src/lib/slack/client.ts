import { WebClient } from "@slack/web-api";
import type { SlackApi } from "../contracts.js";

export class SlackClient implements SlackApi {
  private readonly webClient: WebClient;

  constructor(token: string) {
    this.webClient = new WebClient(token);
  }

  async postMessage(input: {
    channelId: string;
    text: string;
    threadTs?: string;
  }): Promise<{ ts: string }> {
    const response = await this.webClient.chat.postMessage({
      channel: input.channelId,
      text: input.text,
      thread_ts: input.threadTs,
      unfurl_links: false,
      unfurl_media: false,
    });

    if (!response.ts) {
      throw new Error("Slack API did not return message timestamp");
    }

    return { ts: response.ts };
  }
}
