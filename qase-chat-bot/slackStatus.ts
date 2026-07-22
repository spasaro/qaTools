import type { WebClient } from "@slack/web-api";

export type SlackUserMap = {
  names: string[];
  ids: string[];
};

export type AvailableReviewers = {
  ids: string[];
  names: string[];
};

export type UnavailableReviewer = {
  id: string;
  name: string;
  reason: string;
  rawStatusText: string;
  rawStatusEmoji: string;
};

type SlackProfile = {
  status_text?: string;
  status_emoji?: string;
};

type SlackStatusOptions = {
  ptoTextPatterns?: string[];
  ptoEmojis?: string[];
};

export class SlackStatus {
  private api: WebClient;

  private ptoTextPatterns: string[];

  private ptoEmojis: string[];

  constructor(api: WebClient, options?: SlackStatusOptions) {
    this.api = api;
    this.ptoTextPatterns =
      options?.ptoTextPatterns ??
      [
        "ooo",
        "out of office",
        "vacation",
        "vacaciones",
        "pto",
        "on leave",
        "sick",
        "sick leave",
        "enfermo",
        "out today",
        "holiday",
      ];
    this.ptoEmojis =
      options?.ptoEmojis ??
      [
        ":palm_tree:",
        ":beach_with_umbrella:",
        ":airplane:",
        ":palm_tree",
        "🌴",
        "🏖️",
        "✈️",
        "🏝️",
      ];
  }

  async partitionReviewers(
    slackMap: SlackUserMap,
  ): Promise<{
    available: AvailableReviewers;
    unavailable: UnavailableReviewer[];
  }> {
    const availableIds: string[] = [];
    const availableNames: string[] = [];
    const unavailable: UnavailableReviewer[] = [];

    for (let i = 0; i < slackMap.ids.length; i += 1) {
      const id = slackMap.ids[i];
      const name = slackMap.names[i];

      try {
        const res = await this.api.users.profile.get({ user: id });
        const profile = res.profile as SlackProfile | undefined;
        const statusText = profile?.status_text ?? "";
        const statusEmoji = profile?.status_emoji ?? "";

        if (this.isUserOutOfOffice(statusText, statusEmoji)) {
          const reason = this.buildReason(statusText, statusEmoji);
          unavailable.push({
            id,
            name,
            reason,
            rawStatusText: statusText,
            rawStatusEmoji: statusEmoji,
          });
        } else {
          availableIds.push(id);
          availableNames.push(name);
        }
      } catch {
        availableIds.push(id);
        availableNames.push(name);
      }
    }

    return {
      available: { ids: availableIds, names: availableNames },
      unavailable,
    };
  }

  async getAvailableReviewers(slackMap: SlackUserMap): Promise<AvailableReviewers> {
    const { available } = await this.partitionReviewers(slackMap);
    return available;
  }

  async getUnavailableReviewers(slackMap: SlackUserMap): Promise<UnavailableReviewer[]> {
    const { unavailable } = await this.partitionReviewers(slackMap);
    return unavailable;
  }

  private isUserOutOfOffice(statusText: string, statusEmoji: string): boolean {
    const text = statusText.toLowerCase().trim();
    const emoji = statusEmoji.trim();

    if (!text && !emoji) {
      return false;
    }

    if (text.length > 0) {
      if (this.ptoTextPatterns.some(pattern => text.includes(pattern))) {
        return true;
      }
    }

    if (emoji.length > 0) {
      if (this.ptoEmojis.includes(emoji)) {
        return true;
      }
    }

    return false;
  }

  private buildReason(statusText: string, statusEmoji: string): string {
    const text = statusText.trim();
    if (text.length > 0) {
      return text;
    }
    const emoji = statusEmoji.trim();
    if (emoji.length > 0) {
      return emoji;
    }
    return "out of office";
  }
}
