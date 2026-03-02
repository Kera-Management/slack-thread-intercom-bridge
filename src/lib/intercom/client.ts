import type { IntercomApi } from "../contracts.js";

export class IntercomClient implements IntercomApi {
  constructor(
    private readonly accessToken: string,
    private readonly adminId: string,
  ) {}

  async replyToConversation(input: { conversationId: string; messageText: string }): Promise<void> {
    const adminId = Number(this.adminId);
    const normalizedAdminId = Number.isFinite(adminId) ? adminId : this.adminId;

    const response = await fetch(
      `https://api.intercom.io/conversations/${encodeURIComponent(input.conversationId)}/reply`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          "Intercom-Version": "2.11",
        },
        body: JSON.stringify({
          message_type: "comment",
          type: "admin",
          admin_id: normalizedAdminId,
          body: input.messageText,
        }),
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Intercom reply failed (${response.status}): ${text}`);
    }
  }
}
