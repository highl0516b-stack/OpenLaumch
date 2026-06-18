#!/usr/bin/env node
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const artifactsDir = resolve(root, "artifacts");
const caseDir = resolve(artifactsDir, "case-reports");
const reportCandidates = [
  resolve(artifactsDir, "at-wfy-001", "market-journal.md"),
  resolve(root, "artifacts", "at-wfy-001", "market-journal.md"),
];
const statePath = resolve(artifactsDir, "case-reports-last-run.json");

function decode(value) {
  return String(value || "")
    .replace(/__PIPE__/g, "|")
    .trim();
}

function splitCells(line) {
  return line
    .replace(/^\||\|$/g, "")
    .replace(/\\\|/g, "__PIPE__")
    .split("|")
    .map((cell) => decode(cell));
}

function parseSourceRows(markdown) {
  const match = markdown.match(/## 9\. 來源日誌([\s\S]*?)\n## 10\./);
  if (!match) return [];

  return match[1]
    .split(/\r?\n/)
    .filter((line) => line.startsWith("|") && !line.includes("---") && !line.includes("| 時間 |") && !line.includes("| No |"))
    .map((line) => splitCells(line))
    .filter((cells) => cells.length >= 5)
    .map(([time, topic, source, title, link]) => ({
      time,
      topic,
      source,
      title,
      link,
    }));
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "case";
}

function classify(row) {
  const text = `${row.title} ${row.topic} ${row.source}`.toLowerCase();
  if (/(funding|raised|valuation|seed|series|capital|投資|融資|估值)/.test(text)) return "資金/融資";
  if (/(api|platform|gateway|inference|agent|mcp|workflow|接口|平台|代理)/.test(text)) return "API/基建";
  if (/(model|benchmark|eval|distill|llm|reasoning|模型|評測|蒸餾)/.test(text)) return "模型/技術";
  if (/(market|regulation|enterprise|adoption|policy|市場|監管|企業)/.test(text)) return "市場/治理";
  return "產品/願景";
}

function buildCaseReport(row, index) {
  const category = classify(row);
  const title = row.title.replace(/[`*_]/g, "");
  const slug = slugify(`${index}-${title}`);
  const hook =
    category === "資金/融資"
      ? "這是一則可直接包裝成市場情報與商務引流的融資訊號。"
      : category === "API/基建"
        ? "這是一則可轉化成 API 平台、開發者工具或 workflow 產品的技術訊號。"
        : category === "模型/技術"
          ? "這是一則可包裝成模型能力、評測與技術路線圖的內容素材。"
          : category === "市場/治理"
            ? "這是一則可包裝成市場趨勢、合規與企業採用洞察的內容素材。"
            : "這是一則可包裝成產品敘事與品牌故事的早期市場訊號。";

  return [
    `# Case Report ${String(index).padStart(2, "0")}｜${title}`,
    "",
    `> ${hook}`,
    "",
    "## 一句話介紹",
    "",
    `${title} 是一個值得被 OpenLaunch 包裝成對外介紹、廣告式 brief 與商務引流的 AI / API 相關案例。`,
    "",
    "## 它是什麼",
    "",
    `- 分類：${category}`,
    `- 來源：${row.source}`,
    `- 時間：${row.time}`,
    `- 主題：${row.topic}`,
    `- 連結：${row.link}`,
    "",
    "## 為什麼值得關注",
    "",
    "- 它代表 AI 初創或 API 生態中正在被市場驗證的一個方向。",
    "- 這類案例可以被轉化成 OpenLaunch 的市場情報、廣告式介紹與商務開發素材。",
    "- 對未來收入來源而言，這類項目值得被持續追蹤、整理、包裝與對外展示。",
    "",
    "## 可對外投放的廣告式摘要",
    "",
    `${title} 正在把 AI / API 能力帶進更明確的商業場景。對 OpenLaunch 來說，這類案例很適合被包裝成「市場正在發生什麼」的短內容，用來吸引 founder、投資人和 API 生態夥伴。`,
    "",
    "## OpenLaunch 可以怎麼用",
    "",
    "1. 把它放進 AT-WFY-001 三小時快報。",
    "2. 把它改寫成對外廣告式 case brief。",
    "3. 用它建立商務開發名單。",
    "4. 把它轉成未來收入來源的潛在合作對象。",
    "",
    "## 下一步追蹤問題",
    "",
    "- 它是否真的需要 API / agent / workflow 能力？",
    "- 它是否有清晰付費場景？",
    "- 它是否能被 OpenLaunch 包裝成可投放內容？",
    "- 它是否能進入 10 份個案報告的候選池？",
    "",
    "## 來源",
    "",
    row.link,
    "",
  ].join("\n");
}

async function readLatestReport() {
  for (const path of reportCandidates) {
    try {
      return await readFile(path, "utf8");
    } catch {
      // try next candidate
    }
  }
  return null;
}

async function writeState({ count }) {
  await mkdir(artifactsDir, { recursive: true });
  await writeFile(
    statePath,
    `${JSON.stringify(
      {
        id: "CASE-REPORTS",
        generatedAt: new Date().toISOString(),
        count,
        sourceReport: "artifacts/at-wfy-001/market-journal.md",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

async function cleanCaseDir() {
  await mkdir(caseDir, { recursive: true });
  const files = await readdir(caseDir);
  await Promise.all(
    files
      .filter((file) => file.endsWith(".md") || file === "case-reports-last-run.json")
      .map((file) => unlink(resolve(caseDir, file))),
  );
}

export async function caseReportAgent() {
  const markdown = await readLatestReport();
  if (!markdown) {
    throw new Error("Missing AT-WFY-001 market journal. Run agents:wfy first.");
  }

  const rows = parseSourceRows(markdown);
  const selected = rows.slice(0, 10);

  await cleanCaseDir();

  const indexRows = [];
  for (const [index, row] of selected.entries()) {
    const caseNo = index + 1;
    const content = buildCaseReport(row, caseNo);
    const fileName = `${String(caseNo).padStart(2, "0")}-${slugify(row.title)}.md`;
    await writeFile(resolve(caseDir, fileName), `${content}\n`, "utf8");
    indexRows.push({
      No: caseNo,
      Title: row.title,
      Category: classify(row),
      Source: row.source,
      File: fileName,
    });
  }

  const index = [
    "# AT-WFY-001 Case Reports",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "These case reports are ad-style briefs for AI / API startup introductions.",
    "",
    "| No | Title | Category | Source | File |",
    "| --- | --- | --- | --- | --- |",
    ...indexRows.map((row) => `| ${row.No} | ${row.Title} | ${row.Category} | ${row.Source} | ${row.File} |`),
    "",
  ].join("\n");

  await writeFile(resolve(caseDir, "index.md"), `${index}\n`, "utf8");
  await writeState({ count: selected.length });

  return { count: selected.length, dir: caseDir };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const result = await caseReportAgent();
  console.log(`Generated ${result.count} case report(s): ${result.dir}`);
}
