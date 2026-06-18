#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPORT_ID = "AT-WFY-001";
const CADENCE_HOURS = 3;
const FETCH_WINDOW_HOURS = 12;
const CADENCE_MS = CADENCE_HOURS * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const USER_AGENT = "OpenLaunch-AT-WFY-001/1.0 (+AI API startup market journal)";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const artifactsDir = resolve(root, "artifacts");
const reportDir = resolve(artifactsDir, "at-wfy-001");
const reportPath = resolve(reportDir, "market-journal.md");
const relativeReportPath = "artifacts/at-wfy-001/market-journal.md";
const relativeStatePath = "artifacts/at-wfy-001-last-run.json";
const statePath = resolve(artifactsDir, "at-wfy-001-last-run.json");

const isSpecial = process.env.AT_WFY_001_SPECIAL === "1" || process.argv.includes("--special");
const force = process.env.AT_WFY_001_FORCE === "1" || process.argv.includes("--force");

const queries = [
  {
    topic: "AI 模型發布與評測",
    focus: "新模型、benchmark、eval、API 可用性",
    query: "AI model release benchmark evaluation startup API when:3h",
  },
  {
    topic: "蒸餾模型與小型模型",
    focus: "distillation、small model、edge inference、成本下降",
    query: "distilled AI model small model startup API when:3h",
  },
  {
    topic: "AI API 基礎設施",
    focus: "inference API、developer platform、gateway、observability",
    query: "AI API infrastructure startup developer platform when:3h",
  },
  {
    topic: "AI 初創融資",
    focus: "seed、Series A/B、valuation、M&A、資本流向",
    query: "AI startup funding seed Series A API when:3h",
  },
  {
    topic: "市場變化與企業採用",
    focus: "enterprise adoption、regulation、market shift、privacy",
    query: "AI market enterprise adoption regulation API when:3h",
  },
  {
    topic: "華語 AI 生態",
    focus: "香港、台灣、新加坡、中國 AI 初創與 API 市場",
    query: "AI startup Hong Kong Taiwan Singapore China API when:3h",
  },
  {
    topic: "AI Agent 與 API Workflow",
    focus: "agent、workflow、MCP、developer tooling",
    query: "AI agent startup API workflow MCP when:3h",
  },
  {
    topic: "開源與 Hugging Face 生態",
    focus: "open source model、Hugging Face、API deployment",
    query: "Hugging Face open source model API startup when:3h",
  },
];

const rssSources = [
  {
    topic: "TechCrunch AI",
    source: "TechCrunch AI",
    focus: "初創、融資、產品發布",
    url: "https://techcrunch.com/category/artificial-intelligence/feed/",
  },
  {
    topic: "VentureBeat AI",
    source: "VentureBeat AI",
    focus: "企業 AI、市場、模型發布",
    url: "https://venturebeat.com/category/ai/feed/",
  },
  {
    topic: "The Decoder",
    source: "The Decoder",
    focus: "模型、研究、開源、評測",
    url: "https://the-decoder.com/feed/",
  },
  {
    topic: "Hugging Face Blog",
    source: "Hugging Face Blog",
    focus: "模型、資料集、API、開源工具",
    url: "https://huggingface.co/blog/feed.xml",
  },
];

const categories = ["資金", "模型/技術", "API/基建", "市場/治理", "產品/願景"];

function addHours(date, hours) {
  return new Date(date.getTime() + hours * HOUR_MS);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatDate(date) {
  return new Intl.DateTimeFormat("zh-Hant-HK", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, code) => {
      const parsed = Number(code);
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
      const parsed = Number.parseInt(code, 16);
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : "";
    });
}

function stripHtml(value) {
  return decodeEntities(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTag(block, tagName) {
  const match = block.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, "i"));
  return decodeEntities(match?.[1] || "");
}

function extractLink(block) {
  const href = block.match(/<link\s+[^>]*href=["']([^"']+)["']/i);
  if (href?.[1]) return decodeEntities(href[1]);

  const text = extractTag(block, "link");
  return stripHtml(text);
}

function extractBlocks(xml, tagName) {
  const blocks = [];
  let cursor = 0;
  const startTag = `<${tagName}`;
  const endTag = `</${tagName}>`;

  while ((cursor = xml.indexOf(startTag, cursor)) !== -1) {
    const end = xml.indexOf(endTag, cursor);
    if (end === -1) break;

    const block = xml.slice(cursor, end + endTag.length);
    blocks.push(block);
    cursor = end + endTag.length;
  }

  return blocks;
}

function parseFeed(xml, defaultSource = "RSS") {
  const items = [];

  for (const block of [...extractBlocks(xml, "item"), ...extractBlocks(xml, "entry")]) {
    const title = stripHtml(extractTag(block, "title"));
    const link = extractLink(block);
    const pubDate =
      extractTag(block, "pubDate") ||
      extractTag(block, "published") ||
      extractTag(block, "updated");
    const source = stripHtml(extractTag(block, "source") || extractTag(block, "author") || defaultSource);
    const description = stripHtml(
      extractTag(block, "description") ||
        extractTag(block, "summary") ||
        extractTag(block, "content:encoded"),
    );
    const date = pubDate ? new Date(pubDate) : new Date(0);

    items.push({
      title: title || "未命名來源",
      link,
      pubDate: date.toISOString(),
      date,
      source: source || defaultSource,
      description,
    });
  }

  return items;
}

function googleNewsUrl(query) {
  const params = new URLSearchParams({
    q: query,
    hl: "zh-Hant-HK",
    gl: "HK",
    ceid: "HK:zh-Hant",
  });
  return `https://news.google.com/rss/search?${params.toString()}`;
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/rss+xml,application/json,text/xml,text/html;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url) {
  const text = await fetchText(url);
  return JSON.parse(text);
}

function normalize(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, "");
}

function canonicalKey(item) {
  const raw = item.link || item.title;

  try {
    const url = new URL(raw);
    if (url.hostname.includes("news.google.com")) {
      const article = url.pathname.split("/").pop() || url.searchParams.get("url") || raw;
      return `google:${normalize(article)}`;
    }

    url.search = "";
    url.hash = "";
    return url.toString().toLowerCase();
  } catch {
    return normalize(raw);
  }
}

function dedupe(items) {
  const seen = new Set();
  const output = [];

  for (const item of items) {
    const urlKey = canonicalKey(item);
    const titleKey = `title:${normalize(item.title)}`;

    if ((!urlKey || seen.has(urlKey)) && (!titleKey || seen.has(titleKey))) {
      continue;
    }

    if (urlKey) seen.add(urlKey);
    if (titleKey) seen.add(titleKey);
    output.push(item);
  }

  return output.sort((a, b) => b.date - a.date);
}

function matchesWatchKeywords(item) {
  const text = `${item.title} ${item.description}`.toLowerCase();
  const keywordPattern = /(ai|artificial intelligence|llm|model|api|startup|funding|seed|series|distill|inference|gateway|agent|mcp|benchmark|eval|openai|anthropic|mistral|deepseek|hugging face|模型|初創|融資|蒸餾|評測|推理|代理|接口|平台)/i;
  return keywordPattern.test(text);
}

function filterFreshRelevant(items) {
  const now = Date.now();
  const maxAgeMs = FETCH_WINDOW_HOURS * HOUR_MS;

  return items.filter((item) => {
    const age = now - item.date.getTime();
    return Number.isFinite(item.date.getTime()) && age <= maxAgeMs && matchesWatchKeywords(item);
  });
}

async function collectGoogleNews() {
  const failures = [];
  const settled = await Promise.allSettled(
    queries.map(async (entry) => {
      const xml = await fetchText(googleNewsUrl(entry.query));
      return parseFeed(xml, "Google News RSS").map((item) => ({ ...item, ...entry }));
    }),
  );

  const items = [];
  for (const [index, result] of settled.entries()) {
    if (result.status === "fulfilled") {
      items.push(...result.value);
    } else {
      failures.push({ topic: queries[index].topic, error: result.reason?.message || "unknown" });
    }
  }

  return { items, failures };
}

async function collectRssSources() {
  const failures = [];
  const settled = await Promise.allSettled(
    rssSources.map(async (entry) => {
      const xml = await fetchText(entry.url);
      return parseFeed(xml, entry.source).map((item) => ({ ...item, topic: entry.topic, focus: entry.focus }));
    }),
  );

  const items = [];
  for (const [index, result] of settled.entries()) {
    if (result.status === "fulfilled") {
      items.push(...result.value);
    } else {
      failures.push({ topic: rssSources[index].topic, error: result.reason?.message || "unknown" });
    }
  }

  return { items, failures };
}

async function collectHackerNews() {
  const url = "https://hn.algolia.com/api/v1/search_by_date?tags=story&hitsPerPage=50&query=AI%20startup%20API%20model%20funding%20distillation%20LLM";
  const json = await fetchJson(url);

  return (json.hits || []).map((hit) => ({
    title: hit.title || "Hacker News story",
    link: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
    pubDate: new Date(hit.created_at).toISOString(),
    date: new Date(hit.created_at),
    source: "Hacker News",
    description: `${hit.author || ""} ${hit.story_title || ""}`,
    topic: "Hacker News AI/API",
    focus: "社群熱度、開發者討論、早期採用訊號",
  }));
}

async function collectItems() {
  const failures = [];
  const [googleResult, rssResult, hnResult] = await Promise.allSettled([
    collectGoogleNews(),
    collectRssSources(),
    collectHackerNews(),
  ]);

  const items = [];

  if (googleResult.status === "fulfilled") {
    items.push(...googleResult.value.items);
    failures.push(...googleResult.value.failures);
  } else {
    failures.push({ topic: "Google News RSS", error: googleResult.reason?.message || "unknown" });
  }

  if (rssResult.status === "fulfilled") {
    items.push(...rssResult.value.items);
    failures.push(...rssResult.value.failures);
  } else {
    failures.push({ topic: "精選科技 RSS", error: rssResult.reason?.message || "unknown" });
  }

  if (hnResult.status === "fulfilled") {
    items.push(...hnResult.value);
  } else {
    failures.push({ topic: "Hacker News Algolia", error: hnResult.reason?.message || "unknown" });
  }

  return { items: dedupe(filterFreshRelevant(items)), failures };
}

function classify(item) {
  const text = `${item.title} ${item.description}`.toLowerCase();
  const rules = [
    {
      category: "市場/治理",
      keywords: ["market", "regulation", "privacy", "safety", "enterprise", "adoption", "policy", "customer", "bubble", "geopolitical", "sovereignty", "governance", "市場", "監管", "企業", "泡沫", "地緣", "主權", "治理"],
    },
    {
      category: "資金",
      keywords: ["funding", "raised", "series", "seed", "investment", "investor", "valuation", "acquired", "acquisition", "round", "capital", "fund", "venture capital", "venture-backed", "融資", "投資", "估值", "輪"],
    },
    {
      category: "模型/技術",
      keywords: ["model", "release", "launch", "benchmark", "evaluation", "eval", "distill", "small model", "open source", "llm", "reasoning", "模型", "評測", "蒸餾"],
    },
    {
      category: "API/基建",
      keywords: ["api", "inference", "gateway", "platform", "developer", "latency", "cost", "throughput", "infrastructure", "接口", "平台"],
    },
  ];

  return rules.find((rule) => rule.keywords.some((keyword) => text.includes(keyword.toLowerCase())))?.category || "產品/願景";
}

function sourceLabel(item) {
  return item.source || "未知來源";
}

function countBy(items, fn) {
  return items.reduce((acc, item) => {
    const key = fn(item);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function table(headers, rows) {
  if (rows.length === 0) {
    return `| ${headers.join(" | ")} |\n| ${headers.map(() => "---").join(" | ")} |`;
  }

  const escape = (value) =>
    String(value ?? "")
      .replace(/\|/g, "\\|")
      .replace(/\r?\n/g, "<br>");

  const head = `| ${headers.map(escape).join(" | ")} |`;
  const sep = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${headers.map((header) => escape(row[header])).join(" | ")} |`);
  return [head, sep, ...body].join("\n");
}

function itemLine(item) {
  return `- ${formatDate(item.date)}｜${sourceLabel(item)}｜${item.title} — ${item.link}`;
}

function summarizeProduct(item) {
  const category = classify(item);
  if (category === "資金") return "融資或併購訊號，反映資本對該賽道與商業化路徑的押注。";
  if (category === "模型/技術") return "模型發布、benchmark 或評測訊號，重點看能力邊界與可複製性。";
  if (category === "API/基建") return "API、inference 或開發者平台訊號，重點看延遲、成本與整合深度。";
  if (category === "市場/治理") return "企業採用、法規或安全訊號，重點看市場阻力與合規成本。";
  return "產品敘事或願景訊號，重點看是否解決明確痛點與是否有可衡量採用。";
}

function summarizeTech(item) {
  const text = `${item.title} ${item.description}`.toLowerCase();
  if (/(distill|small model|edge|latency|cost|token|throughput)/.test(text)) {
    return "偏向小型化、低成本、低延遲或高吞吐的 API 化技術路徑。";
  }
  if (/(benchmark|eval|evaluation|score|reasoning|multimodal)/.test(text)) {
    return "偏向能力評測、reasoning、multimodal 或模型品質比較。";
  }
  if (/(api|platform|gateway|developer|agent|mcp)/.test(text)) {
    return "偏向開發者工具、API gateway、agent workflow 或 MCP 類整合。";
  }
  return "暫未見明確技術細節，需等待白皮書、API docs、benchmark 或試用資料。";
}

function summarizeMarket(item) {
  const category = classify(item);
  if (category === "資金") return "資本仍流向能縮短 AI 產品落地時間的基礎設施與垂直應用。";
  if (category === "市場/治理") return "市場焦點轉向合規、隱私、安全與企業級採用。";
  if (category === "API/基建") return "API 基礎設施的價值來自穩定性、可觀測性、成本透明與易整合。";
  return "產品需證明可被反覆使用，而不只是單次演示。";
}

function notableItems(items, isSpecialReport) {
  const textPattern = /(funding|raised|series|release|launch|new model|benchmark|api|platform|acquisition|market|regulation|distill|agent|mcp)/i;
  const selected = items.filter((item) => textPattern.test(`${item.title} ${item.description}`));
  return (selected.length ? selected : items).slice(0, isSpecialReport ? 8 : 5);
}

function buildReport({ pkg, items, failures, now, plan, sourceDiversity }) {
  const isSpecialReport = plan.isSpecial;
  const periodStart = addDays(now, -3);
  const categoryCounts = countBy(items, classify);
  const selected = notableItems(items, isSpecialReport);
  const fundingItems = items.filter((item) => classify(item) === "資金");
  const modelItems = items.filter((item) => classify(item) === "模型/技術");
  const apiItems = items.filter((item) => classify(item) === "API/基建");

  const sourceStatus =
    failures.length > 0
      ? `部分查詢失敗：${failures.map((item) => `${item.topic}: ${item.error}`).join("；")}。`
      : "所有公開 RSS/搜尋查詢均完成。";

  const title = isSpecialReport
    ? "AT-WFY-001｜AI 與 API 初創特別報導"
    : "AT-WFY-001｜AI 與 API 初創三小時市場快報";

  const marketSummary = [
    `本輪共整理 ${items.length} 條去重公開來源，覆蓋 ${sourceDiversity} 個來源站與 ${Object.keys(categoryCounts).length || 0} 個主題分類。`,
    categories.map((category) => `${category}：${categoryCounts[category] || 0} 條`).join("；") + "。",
    items.length > 0 ? `最高優先級來源：${selected[0].title}（${sourceLabel(selected[0])}）。` : "本輪未能取得可用來源，下一輪需手動補上公司訪談或指定 RSS。",
  ];

  const notable = selected.length > 0
    ? selected.map(itemLine).join("\n")
    : "- 本輪沒有可確認的特別報導對象。";

  const interviewRows = selected.map((item) => ({
    主題: classify(item),
    對象: sourceLabel(item),
    "產品/願景訊號": summarizeProduct(item),
    "新事物/技術": summarizeTech(item),
    "市場價值": summarizeMarket(item),
  }));

  const distilledWatch = modelItems.length > 0
    ? modelItems.slice(0, 6).map((item) => `- ${item.title}：${summarizeTech(item)}`).join("\n")
    : "- 本輪未出現明確蒸餾模型案例；下一輪優先追蹤 small model、distillation、edge inference、cost/token 與 latency。";

  const apiWatch = apiItems.length > 0
    ? apiItems.slice(0, 6).map((item) => `- ${item.title}：${summarizeTech(item)}`).join("\n")
    : "- 本輪未出現明確 API 基建案例；下一輪優先追蹤 inference API、gateway、observability、agent workflow 與 MCP 整合。";

  const fundingWatch = fundingItems.length > 0
    ? fundingItems.slice(0, 6).map((item) => `- ${item.title}：${summarizeMarket(item)}`).join("\n")
    : "- 本輪未見明確融資新聞；資金判斷仍需交叉驗證 Crunchbase、公司公告、LinkedIn hiring signal 與 cloud spend 趨勢。";

  const sourceRows = items.slice(0, 30).map((item) => ({
    時間: formatDate(item.date),
    主題: classify(item),
    來源: sourceLabel(item),
    標題: item.title,
    連結: item.link,
  }));

  const report = [
    `# ${title}`,
    "",
    "> 定位：以採訪式日誌追蹤 AI 與 API 初創公司的產品、願景、新事物、蒸餾模型技術、新作品、前瞻、新模型發布、評測及試用心得、資金走向、市場變化與前景。",
    "",
    `發行日：${formatDate(now)}`,
    `報導週期：每 3 小時；本次類型：${isSpecialReport ? "特別報導" : "例行三小時快報"}`,
    `資料窗口：${formatDate(periodStart)} 至 ${formatDate(now)}`,
    `來源抓取容忍窗口：最近 ${FETCH_WINDOW_HOURS} 小時，用於補足 3 小時快報所需個案素材。`,
    `來源狀態：${sourceStatus}`,
    `來源組合：Google News RSS、精選科技 RSS、Hacker News Algolia；去重後 ${sourceDiversity} 個來源站。`,
    `作業原則：JDD、KISS、DRY、LOG。`,
    "",
    "## 1. 三日市場摘要",
    "",
    ...marketSummary.map((line) => `- ${line}`),
    "",
    "## 2. 值得特別報",
    "",
    notable,
    "",
    "## 3. 公司/產品採訪筆記",
    "",
    table(["主題", "對象", "產品/願景訊號", "新事物/技術", "市場價值"], interviewRows),
    "",
    "## 4. 新模型、蒸餾與 API 技術雷達",
    "",
    "### 蒸餾模型/小型模型",
    "",
    distilledWatch,
    "",
    "### API/基建",
    "",
    apiWatch,
    "",
    "## 5. 評測與試用心得",
    "",
    "- 評測不只看 benchmark 分數，也要記錄 context length、latency、cost/token、錯誤率、穩定性、文件完整度與 API 易用性。",
    "- 試用 AI/API 初創產品時，先用一個固定 prompt、固定資料集與固定預算跑 A/B，避免被 demo 敘事誤導。",
    "- 對蒸餾模型要同時看「能力保留率」與「推理成本下降」，單看速度或單看分數都不足。",
    "- 對 API 基礎設施要記錄 SDK、streaming、retry、rate limit、observability、data residency 與支援 SLA。",
    "",
    "## 6. 資金走向與市場變化",
    "",
    fundingWatch,
    "",
    "## 7. 前景判斷",
    "",
    "1. API 初創的護城河會從「接到模型」轉為「穩定、低成本、可觀測、易整合」。",
    "2. 蒸餾與小型模型若能在垂直任務保持 80% 以上能力、同時顯著降低延遲與成本，會成為企業落地首選。",
    "3. 資金會繼續偏向能縮短 AI 產品上市時間的基礎設施、資料管線、安全合規與垂直 workflow。",
    "4. 市場敘事需從「新模型發布」轉向「可衡量採用」：留存、付費轉化、部署週期與支援成本。",
    "",
    "## 8. 下一步追蹤清單",
    "",
    "- 建立固定公司名單：模型公司、API gateway/inference 平台、AI agent workflow、資料與安全合規初創。",
    "- 每輪保留 3 個深度試用對象，記錄測試 prompt、成本、延遲、錯誤樣本與產品體驗。",
    "- 對特別報導對象補做一手訪談：產品願景、技術路線、客戶案例、融資節奏、未來 90 日里程碑。",
    "",
    "## 9. 來源日誌",
    "",
    table(["時間", "主題", "來源", "標題", "連結"], sourceRows),
    "",
    "## 10. 執行狀態",
    "",
    `- Package: ${pkg.name || "openlaunch"} ${pkg.version || "0.1.0"}`,
    `- Google News 查詢數：${queries.length}`,
    `- 精選 RSS 數：${rssSources.length}`,
    `- 去重後條目：${items.length}`,
    `- 去重後來源站：${sourceDiversity}`,
    `- 失敗查詢：${failures.length}`,
    `- 下次例行預計：${plan.nextRoutineDueAt ? formatDate(new Date(plan.nextRoutineDueAt)) : "尚未排程"}`,
    "",
  ].join("\n");

  return report;
}

async function readPackageJson() {
  try {
    return JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  } catch {
    return { name: "openlaunch", version: "0.1.0" };
  }
}

async function readState() {
  try {
    return JSON.parse(await readFile(statePath, "utf8"));
  } catch {
    return {};
  }
}

async function resolvePlan(state) {
  const now = new Date();
  const lastRoutineRunAt = state.lastRoutineRunAt ? new Date(state.lastRoutineRunAt) : null;
  const elapsed = lastRoutineRunAt && Number.isFinite(lastRoutineRunAt.getTime())
    ? now.getTime() - lastRoutineRunAt.getTime()
    : Number.POSITIVE_INFINITY;
  const due = isSpecial || force || !lastRoutineRunAt || elapsed >= CADENCE_MS;

  return {
    now,
    isSpecial,
    force,
    due,
    nextRoutineDueAt: isSpecial
      ? state.nextRoutineDueAt || now.toISOString()
      : addHours(now, CADENCE_HOURS).toISOString(),
  };
}

async function writeState({ pkg, plan, items, failures, sourceDiversity }) {
  const nowIso = plan.now.toISOString();
  const state = {
    id: REPORT_ID,
    cadenceHours: CADENCE_HOURS,
    lastRunAt: nowIso,
    lastRoutineRunAt: plan.isSpecial ? undefined : nowIso,
    lastSpecialRunAt: plan.isSpecial ? nowIso : undefined,
    nextRoutineDueAt: plan.nextRoutineDueAt,
    lastReportPath: relativeReportPath,
    lastSourceCount: items.length,
    lastSourceDiversity: sourceDiversity,
    lastFailureCount: failures.length,
    packageName: pkg.name || "openlaunch",
    packageVersion: pkg.version || "0.1.0",
    updatedAt: nowIso,
  };

  await mkdir(artifactsDir, { recursive: true });
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export async function wfy001Agent() {
  const state = await readState();
  const plan = await resolvePlan(state);

  if (!plan.due) {
    console.log(`AT-WFY-001 skipped; next due ${plan.nextRoutineDueAt}`);
    return null;
  }

  const pkg = await readPackageJson();
  const { items, failures } = await collectItems();
  const sourceDiversity = new Set(items.map((item) => sourceLabel(item))).size;
  const report = buildReport({ pkg, items, failures, now: plan.now, plan, sourceDiversity });

  await mkdir(reportDir, { recursive: true });
  await writeFile(reportPath, `${report}\n`, "utf8");
  await writeState({ pkg, plan, items, failures, sourceDiversity });

  console.log(relativeReportPath);
  return relativeReportPath;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  await wfy001Agent();
}
