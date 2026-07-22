import { WebClient } from "@slack/web-api";

const DEFAULT_BLOCKED_KEYWORDS: string[] = [
  "ooo",
  "out of office",
  "pto",
  "vacation",
  "vacationing",
  "holiday",
  "holidays",
  "sick",
  "sickness",
  "medical",
  "medical appointment",
  "medical leave",
  "appointment",
  "leave",
  "personal leave",
  "unavailable"
];

const DEFAULT_BLOCKED_EMOJIS: string[] = [
  ":palm_tree:",
  ":no_entry:",
  ":x:",
  ":beach_with_umbrella:",
  ":umbrella_on_ground:"
];

type SlackAvailabilityServiceConfig = {
  client: WebClient;
  blockedKeywords?: string[];
  blockedEmojis?: string[];
};

export class SlackAvailabilityService {
  private client: WebClient;
  private blockedKeywords: string[];
  private blockedEmojis: string[];

  constructor(config: SlackAvailabilityServiceConfig) {
    this.client = config.client;
    this.blockedKeywords = config.blockedKeywords ?? DEFAULT_BLOCKED_KEYWORDS;
    this.blockedEmojis = config.blockedEmojis ?? DEFAULT_BLOCKED_EMOJIS;
  }

  private getBlockReason(text: string, emoji: string): string | null {
    const normalized: string = text.toLowerCase();

    for (const keyword of this.blockedKeywords) {
      if (normalized.includes(keyword)) return keyword;
    }

    if (this.blockedEmojis.includes(emoji)) return emoji;

    return null;
  }

 async isUserAvailable(
  userId: string
): Promise<{ available: boolean; reason: string | null }> {
  try {
    const response = await this.client.users.profile.get({ user: userId });
    const profile = response.profile;
    if (!profile) return { available: true, reason: null };

    const text: string = profile.status_text ?? "";
    const emoji: string = profile.status_emoji ?? "";

    const reason = this.getBlockReason(text, emoji);

    return { available: !reason, reason };
  } catch (error) {
    const e = error as { data?: { error?: string } };
    console.log("SlackAvailabilityService.users.profile.get failed", {
      userId,
      slackError: e.data?.error
    });
    return { available: true, reason: null };
  }
}

  async filterUsers(
    reviewers: string[]
  ): Promise<{ available: string[]; unavailable: { user: string; reason: string }[] }> {
    const checks = await Promise.all(
      reviewers.map(async (user: string) => {
        const { available, reason } = await this.isUserAvailable(user);
        return { user, available, reason };
      })
    );

    return {
      available: checks.filter((c: { available: boolean }) => c.available).map((c: { user: string }) => c.user),
      unavailable: checks
        .filter((c: { available: boolean; reason: string | null }) => !c.available && c.reason)
        .map((c: { user: string; reason: string | null }) => ({ user: c.user, reason: c.reason! }))
    };
  }
}
