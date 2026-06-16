import type {
  CampaignCopy,
  ChannelKey,
  LaunchBrief,
  LaunchCalendarItem,
  LaunchPlan,
  LeadSegment,
} from "./types.js";

const channelLabels: Record<ChannelKey, string> = {
  x: "X / Twitter",
  linkedin: "LinkedIn",
  xiaohongshu: "小紅書",
  youtube_shorts: "YouTube Shorts",
  discord: "Discord",
  telegram: "Telegram",
  product_hunt: "Product Hunt",
  hacker_news: "Hacker News",
  indie_hackers: "Indie Hackers",
  email: "Email",
  bluesky: "Bluesky",
  threads: "Threads",
  reddit: "Reddit",
  tiktok: "TikTok",
  wechat: "WeChat",
  substack: "Substack",
  medium: "Medium",
  youtube: "YouTube",
  press: "Press / Media",
};

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "openlaunch";
}

function compact(input: string, fallback: string): string {
  const value = input.trim();
  return value.length > 0 ? value : fallback;
}

function titleCase(input: string): string {
  const value = input.trim();
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function makeCampaignCopy(brief: LaunchBrief, productName: string): CampaignCopy[] {
  const copyByChannel: Record<ChannelKey, CampaignCopy> = {
    x: {
      channel: "x",
      title: `${productName} is launching soon`,
      body: `We are building ${productName} for ${compact(brief.audience, "early adopters")} who struggle with ${compact(brief.problem, "a painful workflow")}. Join the waitlist and help shape the launch.`,
      cta: "Join the waitlist",
    },
    linkedin: {
      channel: "linkedin",
      title: `Announcing ${productName}: ${brief.oneLiner}`,
      body: `We are validating ${productName}, a new way to help ${compact(brief.audience, "teams")} solve ${compact(brief.problem, "an important problem")}. If this is relevant to your network, I would love your feedback before launch.`,
      cta: "Request early access",
    },
    xiaohongshu: {
      channel: "xiaohongshu",
      title: `我把 ${productName} 做成了一個新產品`,
      body: `目標用戶：${compact(brief.audience, "正在尋找更高效工具的人")}。核心痛點：${compact(brief.problem, "流程太慢、資訊太分散")}。現在開放候客名單，前 100 位會拿到早期體驗與專屬更新。`,
      cta: "留言「Launch」取得連結",
    },
    youtube_shorts: {
      channel: "youtube_shorts",
      title: `${productName} in 30 seconds`,
      body: `Hook: ${compact(brief.problem, "This workflow is broken")}. Solution: ${productName} helps ${compact(brief.audience, "you")} get ${compact(brief.launchGoal, "early access")} faster. CTA: join the waitlist today.`,
      cta: "Link in bio",
    },
    discord: {
      channel: "discord",
      title: `Building ${productName} in public`,
      body: `Hey everyone — we are validating ${productName} for ${compact(brief.audience, "this community")}. The problem we are solving: ${compact(brief.problem, "fragmented launch workflows")}. Would love 10 people to try the beta.`,
      cta: "React if you want beta access",
    },
    telegram: {
      channel: "telegram",
      title: `${productName} early access`,
      body: `We are opening early access for ${productName}. If you care about ${compact(brief.problem, "better launch execution")}, join the list and get launch updates first.`,
      cta: "Join early access",
    },
    product_hunt: {
      channel: "product_hunt",
      title: `${productName}: ${brief.oneLiner}`,
      body: `${productName} helps ${compact(brief.audience, "founders and operators")} turn one idea into a full launch campaign: landing page, waitlist, content, follow-up and investor room.`,
      cta: "Support the launch",
    },
    hacker_news: {
      channel: "hacker_news",
      title: `Show HN: ${productName}`,
      body: `${productName} is a Launch-as-a-Service prototype. You enter a one-line product idea and it generates a landing page, waitlist, launch copy, follow-up plan and investor one-pager.`,
      cta: "Try the prototype",
    },
    indie_hackers: {
      channel: "indie_hackers",
      title: `Building ${productName}: from idea to launch campaign`,
      body: `I am building ${productName} to solve ${compact(brief.problem, "the fragmented launch process")}. The first version generates the full launch pack from a short product brief. Looking for feedback from other builders.`,
      cta: "Leave feedback",
    },
    email: {
      channel: "email",
      title: `Early access: ${productName}`,
      body: `Hi {{first_name}}, we are launching ${productName}, built for ${compact(brief.audience, "people like you")}. It helps solve ${compact(brief.problem, "a key workflow problem")} by turning a product idea into a launch campaign in minutes.`,
      cta: "Join the waitlist",
    },
    bluesky: {
      channel: "bluesky",
      title: `${productName} is launching soon`,
      body: `We are building ${productName} for ${compact(brief.audience, "early adopters")} who struggle with ${compact(brief.problem, "a painful workflow")}. Early access opens soon — join the waitlist if you want updates.`,
      cta: "Join the waitlist",
    },
    threads: {
      channel: "threads",
      title: `Launching ${productName}`,
      body: `${productName} helps ${compact(brief.audience, "builders")} solve ${compact(brief.problem, "fragmented launch execution")}. We are collecting early users before launch.`,
      cta: "Request early access",
    },
    reddit: {
      channel: "reddit",
      title: `Show HN-style: ${productName}`,
      body: `I am validating ${productName}, a Launch-as-a-Service prototype for ${compact(brief.audience, "founders")}. The problem: ${compact(brief.problem, "launches are too fragmented")}. Looking for honest feedback before public launch.`,
      cta: "Leave feedback",
    },
    tiktok: {
      channel: "tiktok",
      title: `${productName} in 20 seconds`,
      body: `Hook: ${compact(brief.problem, "launches take forever")}. Solution: ${productName} turns one idea into a launch campaign. CTA: join the waitlist and see the demo.`,
      cta: "Link in bio",
    },
    wechat: {
      channel: "wechat",
      title: `${productName} 早期體驗開放`,
      body: `我們在為 ${compact(brief.audience, "目標用戶")} 打造 ${productName}，解決 ${compact(brief.problem, "launch 流程太分散")} 的問題。現在開放早期體驗名單，歡迎留言或私訊。`,
      cta: "留言「體驗」取得連結",
    },
    substack: {
      channel: "substack",
      title: `How ${productName} turns one idea into a launch campaign`,
      body: `A short founder note on why ${compact(brief.problem, "launch execution")} is fragmented, how ${productName} helps ${compact(brief.audience, "builders")} move faster, and what we are validating before launch.`,
      cta: "Subscribe for launch updates",
    },
    medium: {
      channel: "medium",
      title: `From one product idea to a full launch system with ${productName}`,
      body: `${productName} is a Launch-as-a-Service prototype for ${compact(brief.audience, "founders and operators")}. It generates landing page copy, channel campaigns, lead segments, investor narrative and a 30-day launch calendar.`,
      cta: "Read the launch story",
    },
    youtube: {
      channel: "youtube",
      title: `${productName} demo: launch campaign in minutes`,
      body: `In this demo, we turn a one-line product idea into a landing page, launch copy, lead segments and investor one-pager. Built for ${compact(brief.audience, "founders")} who need distribution before they are ready.`,
      cta: "Watch the demo",
    },
    press: {
      channel: "press",
      title: `Press note: ${productName} launches AI-native launch command center`,
      body: `${productName} helps ${compact(brief.audience, "startup teams")} convert a product brief into a complete launch system: narrative, landing page, multi-channel copy, lead follow-up and investor room.`,
      cta: "Request founder interview",
    },
  };

  return brief.channels.map((channel) => copyByChannel[channel]);
}

function makeCalendar(brief: LaunchBrief): LaunchCalendarItem[] {
  const goalCopy: Record<LaunchBrief["launchGoal"], string> = {
    waitlist: "達到第一批 500 位候客名單",
    funding: "產生 20 位投資人對話與 5 場會議",
    partnership: "取得 10 個渠道合作意向",
    sales: "完成 30 個早期付費或預購意向",
    community: "建立 300 人核心社群",
  };

  const base: LaunchCalendarItem[] = [
    { day: 1, title: "Launch brief freeze", action: "鎖定一句話定位、ICP、痛點與 launch goal。", channel: "all" },
    { day: 2, title: "Landing page live", action: "發布 waitlist 頁面並安裝事件追蹤。", channel: "all" },
    { day: 3, title: "Founder story", action: "發布創始人為什麼做這個產品的故事。", channel: brief.channels[0] ?? "all" },
    { day: 5, title: "Problem proof", action: "發布 3 個真實痛點案例或截圖。", channel: "all" },
    { day: 7, title: "Community seeding", action: "在 5 個社群提出問題，不直接硬推。", channel: "discord" },
    { day: 10, title: "Influencer outreach", action: "送出 20 封個人化合作邀請。", channel: "email" },
    { day: 14, title: "Demo teaser", action: "發布 30 秒產品演示短片。", channel: "youtube_shorts" },
    { day: 21, title: "Social proof sprint", action: "收集 beta 反饋、截圖、推薦語。", channel: "all" },
    { day: 28, title: "Investor / partner update", action: "發送 traction update 與資料室連結。", channel: "email" },
    { day: 30, title: "Launch recap", action: `复盘數據並設定下一階段目標：${goalCopy[brief.launchGoal]}。`, channel: "all" },
  ];

  return base;
}

function makeLeadSegments(brief: LaunchBrief): LeadSegment[] {
  return [
    {
      name: "高匹配早期用戶",
      description: `符合 ${compact(brief.audience, "目標用戶")} 描述，並明確表達痛點的人。`,
      firstMessage: `看到你也在處理 ${compact(brief.problem, "這個問題")}，我們正在做 ${brief.productName}，想邀請你試早期版本。`,
    },
    {
      name: "渠道合作夥伴",
      description: "擁有目標受眾社群、newsletter、播客或內容渠道的人。",
      firstMessage: `你的受眾似乎很適合 ${brief.productName}，我們可以一起做一場 early access campaign。`,
    },
    {
      name: "潛在投資人 / advisor",
      description: "看過類似市場、懂分發或 B2B/B2C growth 的投資人與顧問。",
      firstMessage: `我們在驗證 ${brief.productName}，目前目標是 ${brief.launchGoal}，想請你看看這個市場切入是否成立。`,
    },
  ];
}

export function generateLaunchPlan(brief: LaunchBrief): LaunchPlan {
  const productName = titleCase(compact(brief.productName, "OpenLaunch"));
  const oneLiner = compact(brief.oneLiner, "Turn one product idea into a complete launch campaign.");
  const audience = compact(brief.audience, "founders, operators and early adopters");
  const problem = compact(brief.problem, "fragmented launch execution");
  const targetMarket = compact(brief.targetMarket ?? "", "global indie builders and startup teams");
  const pricingHint = compact(brief.pricingHint ?? "", "freemium with Pro launch automation");
  const id = `${slugify(productName)}-${Date.now().toString(36)}`;

  return {
    id,
    productName,
    createdAt: new Date().toISOString(),
    landingPage: {
      eyebrow: `AI-native launch campaign for ${targetMarket}`,
      heroTitle: `Launch ${productName} before you are ready.`,
      heroSubtitle: `${oneLiner} Built for ${audience} who need to turn one idea into a waitlist, content engine and investor conversation.`,
      primaryCta: "Join the waitlist",
      secondaryCta: "View investor one-pager",
      valueBullets: [
        `Generate landing page copy from: ${oneLiner}`,
        `Solve this pain: ${problem}`,
        `Target audience: ${audience}`,
        `Launch goal: ${brief.launchGoal}`,
        `Pricing hypothesis: ${pricingHint || "to be validated"}`,
      ],
      faq: [
        {
          question: "What is OpenLaunch generating?",
          answer: "A complete launch pack: landing page, waitlist, multi-channel copy, 30-day calendar, lead segments and investor one-pager.",
        },
        {
          question: "Who is this for?",
          answer: `Founders and operators targeting ${audience}.`,
        },
        {
          question: "Can this connect to real launch tools later?",
          answer: "Yes. The architecture reserves adapters for MCP servers, CRM, Notion, Slack, GitHub, R2/S3 and Cloudflare/Vercel/Kubernetes deployments.",
        },
      ],
    },
    campaignCopy: makeCampaignCopy({ ...brief, productName, oneLiner, audience, problem }, productName),
    calendar: makeCalendar({ ...brief, productName, oneLiner, audience, problem }),
    investorOnePager: {
      problem,
      solution: `${productName} turns a short product brief into a complete launch system: narrative, landing page, waitlist, distribution copy, follow-up automation and investor room.`,
      market: targetMarket,
      tractionGoal: goalToTraction(brief.launchGoal),
      ask: brief.launchGoal === "funding" ? "Seeking angels and operators who understand distribution-led startups." : "Seeking early users, partners and advisors.",
      whyNow: "AI agents and MCP tool adapters make it possible to automate launch operations that previously required founders to stitch together many tools.",
    },
    leadSegments: makeLeadSegments(brief),
    nextActions: [
      "Publish the generated landing page and collect first 100 emails.",
      "Send 20 personalized founder-led messages to high-fit users.",
      "Post one problem-validation thread in two communities.",
      "Create a private investor update with waitlist growth and feedback.",
      "Run a 30-minute demo call with the first 5 qualified leads.",
    ],
    metrics: [
      { name: "Waitlist conversion", target: ">= 25% from landing page visitors" },
      { name: "Founder outreach reply rate", target: ">= 20%" },
      { name: "Qualified lead interviews", target: "10 in first 14 days" },
      { name: "Channel experiments", target: "5 channels tested in first 30 days" },
      { name: "Investor / partner meetings", target: brief.launchGoal === "funding" ? "5 in first 30 days" : "3 in first 30 days" },
    ],
  };
}

function goalToTraction(goal: LaunchBrief["launchGoal"]): string {
  switch (goal) {
    case "waitlist":
      return "500 waitlist subscribers and 50 qualified interviews.";
    case "funding":
      return "20 investor conversations, 5 meetings and a live traction dashboard.";
    case "partnership":
      return "10 channel partner conversations and 3 active distribution experiments.";
    case "sales":
      return "30 early purchase intents or paid pilots.";
    case "community":
      return "300 community members and 30 active weekly participants.";
  }
}