export type ChannelKey =
  | "x"
  | "linkedin"
  | "xiaohongshu"
  | "youtube_shorts"
  | "discord"
  | "telegram"
  | "product_hunt"
  | "hacker_news"
  | "indie_hackers"
  | "email"
  | "bluesky"
  | "threads"
  | "reddit"
  | "tiktok"
  | "wechat"
  | "substack"
  | "medium"
  | "youtube"
  | "press";

export type ThirdPartyIntegrationKey =
  | "notion"
  | "slack"
  | "github"
  | "crm"
  | "email"
  | "object_storage"
  | "webhook"
  | "filesystem"
  | "git"
  | "fetch"
  | "ai"
  | "deployment";

export type IntegrationCapability = "read" | "write" | "delete" | "search" | "webhook" | "ai";

export interface ThirdPartyIntegrationConfig {
  id: ThirdPartyIntegrationKey;
  name: string;
  enabled: boolean;
  capabilities?: IntegrationCapability[];
  env?: Record<string, string | undefined>;
}

export interface LaunchPackArtifact {
  kind: "landing_page" | "campaign_copy" | "lead_segments" | "investor_one_pager" | "calendar" | "metrics";
  title: string;
  content: unknown;
}

export interface LaunchPack {
  plan: LaunchPlan;
  artifacts: LaunchPackArtifact[];
}

export interface LaunchBrief {
  productName: string;
  oneLiner: string;
  audience: string;
  problem: string;
  launchGoal: "waitlist" | "funding" | "partnership" | "sales" | "community";
  channels: ChannelKey[];
  targetMarket?: string;
  pricingHint?: string;
  founderNote?: string;
}

export interface LandingPageSection {
  eyebrow: string;
  heroTitle: string;
  heroSubtitle: string;
  primaryCta: string;
  secondaryCta: string;
  valueBullets: string[];
  faq: Array<{ question: string; answer: string }>;
}

export interface CampaignCopy {
  channel: ChannelKey;
  title: string;
  body: string;
  cta: string;
}

export interface LaunchCalendarItem {
  day: number;
  title: string;
  action: string;
  channel: ChannelKey | "all";
}

export interface InvestorOnePager {
  problem: string;
  solution: string;
  market: string;
  tractionGoal: string;
  ask: string;
  whyNow: string;
}

export interface LeadSegment {
  name: string;
  description: string;
  firstMessage: string;
}

export interface LaunchPlan {
  id: string;
  productName: string;
  createdAt: string;
  landingPage: LandingPageSection;
  campaignCopy: CampaignCopy[];
  calendar: LaunchCalendarItem[];
  investorOnePager: InvestorOnePager;
  leadSegments: LeadSegment[];
  nextActions: string[];
  metrics: Array<{ name: string; target: string }>;
}