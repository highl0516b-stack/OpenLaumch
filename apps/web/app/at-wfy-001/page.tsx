import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const reportCandidates = [
  resolve(process.cwd(), "artifacts/at-wfy-001/market-journal.md"),
  resolve(process.cwd(), "..", "..", "artifacts/at-wfy-001/market-journal.md"),
];

async function readLatestReport() {
  for (const reportPath of reportCandidates) {
    try {
      return await readFile(reportPath, "utf8");
    } catch {
      // Try the next deployment-relative path.
    }
  }

  return null;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderInlineMarkdown(value: string) {
  return escapeHtml(value)
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.*?)`/g, "<code>$1</code>")
    .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2">$1</a>');
}

function splitTableCells(line: string) {
  return line
    .replace(/^\||\|$/g, "")
    .replace(/\\\|/g, "__PIPE__")
    .split("|")
    .map((cell) => cell.replace(/__PIPE__/g, "|").trim());
}

function markdownToHtml(markdown: string) {
  const lines = markdown.split(/\r?\n/);
  const html: string[] = [];
  let inList: "ul" | "ol" | null = null;
  let inTable = false;

  function closeBlocks() {
    if (inList) {
      html.push(inList === "ul" ? "</ul>" : "</ol>");
      inList = null;
    }
    if (inTable) {
      html.push("</tbody></table>");
      inTable = false;
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (/^\|/.test(line) && /\|/.test(line)) {
      if (!inTable) {
        closeBlocks();
        html.push("<table><tbody>");
        inTable = true;
      }

      const cells = splitTableCells(line);
      const tag = cells.every((cell) => /^-+$/.test(cell)) ? "thead" : "tr";

      if (tag === "thead") {
        html.push("<tr>", ...cells.map((cell) => `<th>${renderInlineMarkdown(cell)}</th>`), "</tr>");
      } else {
        html.push("<tr>", ...cells.map((cell) => `<td>${renderInlineMarkdown(cell)}</td>`), "</tr>");
      }
      continue;
    }

    closeBlocks();

    if (!line.trim()) {
      continue;
    }

    if (/^# /.test(line)) {
      html.push(`<h1>${renderInlineMarkdown(line.replace(/^# /, ""))}</h1>`);
      continue;
    }

    if (/^## /.test(line)) {
      html.push(`<h2>${renderInlineMarkdown(line.replace(/^## /, ""))}</h2>`);
      continue;
    }

    if (/^### /.test(line)) {
      html.push(`<h3>${renderInlineMarkdown(line.replace(/^### /, ""))}</h3>`);
      continue;
    }

    if (/^> /.test(line)) {
      html.push(`<blockquote>${renderInlineMarkdown(line.replace(/^> /, ""))}</blockquote>`);
      continue;
    }

    if (/^- /.test(line)) {
      if (inList !== "ul") {
        html.push("<ul>");
        inList = "ul";
      }
      html.push(`<li>${renderInlineMarkdown(line.replace(/^- /, ""))}</li>`);
      continue;
    }

    if (/^\d+\. /.test(line)) {
      if (inList !== "ol") {
        html.push("<ol>");
        inList = "ol";
      }
      html.push(`<li>${renderInlineMarkdown(line.replace(/^\d+\. /, ""))}</li>`);
      continue;
    }

    html.push(`<p>${renderInlineMarkdown(line)}</p>`);
  }

  closeBlocks();
  return html.join("\n");
}

export default async function AtWfy001Page() {
  const markdown = await readLatestReport();

  return (
    <main className="journal-page">
      <section className="journal-shell hero compact-hero">
        <div className="journal-hero-copy">
          <p className="eyebrow">AT-WFY-001 / Market Journal</p>
          <h1>AI 與 API 初創三日市場日誌</h1>
          <p className="hero-subtitle">
            把原本屬於第二階段的市場情報主推項目，提前放進 MVP：每 3 小時以採訪式快報追蹤產品、願景、蒸餾模型、API 基建、評測試用、資金流向與市場前景。
          </p>
          <div className="hero-actions">
            <a className="button secondary" href="/">返回 OpenLaunch MVP</a>
            <a className="mini-button" href="#journal">閱讀最新報導</a>
          </div>
        </div>
      </section>

      <section id="journal" className="journal-card section">
        {markdown ? (
          <article className="journal-content" dangerouslySetInnerHTML={{ __html: markdownToHtml(markdown) }} />
        ) : (
          <div className="journal-empty">
            <h2>尚未生成 AT-WFY-001 報導</h2>
            <p>請先執行 <code>npm run agents:wfy -- --force</code>，或由 GitHub Actions 排程生成最新市場日誌。</p>
          </div>
        )}
      </section>
    </main>
  );
}
