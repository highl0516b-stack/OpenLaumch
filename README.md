# OpenLaunch

OpenLaunch 是一個 **AI-native Launch-as-a-Service MVP**，把產品 brief 轉成可審查、可執行、可部署的 launch command center。它同時把原本屬於第二階段的市場情報項目提前放進 MVP：`AT-WFY-001` 會每 3 小時產出 AI / API 初創市場快報，並把有商業價值的項目整理成廣告式 case report，作為未來商務開發與收入來源的素材池。

## 核心能力

- 從一句產品 brief 生成 launch pack。
- 生成 landing page、渠道文案、30 日 calendar、lead segments、investor one-pager 與 next actions。
- 預留 MCP-ready adapters，可接 Git、Filesystem、Notion、Slack、CRM、Webhook、Object Storage、AI Gateway。
- 提供 Cloudflare Worker gateway、Node API、Next.js Web、Kubernetes baseline。
- 新增 `AT-WFY-001` 三小時市場快報，追蹤 AI / API 初創、模型發布、API 基建、評測試用、資金走向與市場變化。
- 新增 AI / API startup case report，把公開來源整理成可對外投放的廣告式介紹草稿。

## 主要命令

```bash
cmd /c npm run typecheck
cmd /c npm run build
cmd /c npm run agents:wfy -- --force
cmd /c npm run agents:cases
```

本地 PowerShell 若因 execution policy 擋住 `npm.ps1`，可用 `cmd /c npm ...` 或直接執行 `node scripts/agents/wfy-001-agent.mjs --force`。

## AT-WFY-001 市場快報

`AT-WFY-001` 原本設計為每 3 日一次，現在已改為每 3 小時一次：

- 來源：Google News RSS、精選科技 RSS、Hacker News Algolia。
- 輸出：`artifacts/at-wfy-001/market-journal.md`
- 狀態：`artifacts/at-wfy-001-last-run.json`
- GitHub Actions：`.github/workflows/at-wfy-001.yml`
- 排程：每 3 小時執行一次；若未滿 3 小時則跳過。
- 手動模式：
  - `force=true`：即使未滿 3 小時也強制生成。
  - `special=true`：生成特別報導，但不重置例行 3 小時 cadence。

MVP Web 已加入入口：

```text
/at-wfy-001
```

## Startup Case Reports

`agents:cases` 會讀取最新 AT-WFY-001 快報，把 AI / API 相關來源整理成廣告式 case report。這些報告用於：

- 對外介紹 AI / API 初創項目。
- 建立商務開發名單。
- 作為未來收入來源的潛在合作對象池。
- 累積 10 份個案報告後，可啟動下一階段收入更新與商務包裝。

輸出位置：

```text
artifacts/case-reports/index.md
artifacts/case-reports/01-*.md
...
artifacts/case-reports-last-run.json
```

目標：累積 10 份可對外投放的 case report；目前首輪已生成 10 份。

## 架構

- `apps/web`：Next.js MVP Web，包含 launch form 與 `/at-wfy-001` 市場快報頁面。
- `apps/api`：Node.js API baseline。
- `packages/core`：deterministic launch plan engine、adapter registry、MCP gateway。
- `packages/mcp-servers/launch-server`：MCP stdio server。
- `cloudflare`：Cloudflare Worker gateway，負責 auth、CORS、rate limit、AI/MCP proxy 與 KV logs。
- `deploy/k8s`：Kubernetes baseline manifests。
- `scripts/agents`：內容與市場情報 agents。

## License

MIT。見 `LICENSE`。
