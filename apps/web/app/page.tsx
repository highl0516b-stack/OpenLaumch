import { MagicMomentForm } from "@/components/MagicMomentForm";
import { Section } from "@/components/Section";

const channels = [
  "X / Twitter",
  "LinkedIn",
  "小紅書",
  "YouTube Shorts",
  "Discord",
  "Telegram",
  "Product Hunt",
  "Hacker News",
  "Indie Hackers",
  "Email",
] as const;

export default function Home() {
  return (
    <main className="page-shell">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Launch as a Service / MCP-ready</p>
          <h1>把一個產品想法，變成全網 launch campaign。</h1>
          <p className="hero-subtitle">
            OpenLaunch 為研討會、產品演練、演說集資、社群聚客與資方引進打造一套可持續跟進的 launch engine。
          </p>
          <div className="hero-actions">
            <a className="button primary" href="#magic">
              立即生成 launch pack
            </a>
            <a className="button secondary" href="#architecture">
              查看技術架構
            </a>
          </div>
        </div>
        <div className="hero-card">
          <div className="metric-row">
            <span>10 min</span>
            <small>從想法到 launch command center</small>
          </div>
          <div className="metric-row">
            <span>30 days</span>
            <small>自動規劃持續跟進節奏</small>
          </div>
          <div className="metric-row">
            <span>MCP</span>
            <small>預留工具生態與 agent adapter</small>
          </div>
        </div>
      </section>

      <Section id="magic" title="Magic Moment" subtitle="輸入一句話，生成 landing page、全網文案、候客名單與 30 天 launch plan。">
        <MagicMomentForm />
      </Section>

      <Section id="architecture" title="長遠技術棧" subtitle="Cloudflare 控成本、Vercel 快迭代、Kubernetes 保可控、MCP 做工具標準化。">
        <div className="grid">
          <article className="card">
            <h3>Cloudflare Edge</h3>
            <p>Workers、Pages、D1、R2、KV、Queues、AI Gateway 負責低成本邊緣層與異步任務。</p>
          </article>
          <article className="card">
            <h3>Vercel App Layer</h3>
            <p>Next.js SSR、preview deployment、團隊協作與快速產品驗證。</p>
          </article>
          <article className="card">
            <h3>MCP Gateway</h3>
            <p>把 Fetch、Git、Memory、Filesystem、Notion、Slack、CRM 等工具封裝成可控 adapter。</p>
          </article>
          <article className="card">
            <h3>Kubernetes Scale</h3>
            <p>當 agent workers、queue、多租戶與 GPU 工作負載變重時，無縫遷移到 K8s。</p>
          </article>
        </div>
      </Section>

      <Section id="channels" title="一鍵全網預留接口" subtitle="MVP 先產生文案包，後續接上真正分發與 CRM 工具。">
        <div className="channel-list">
          {channels.map((channel) => (
            <span key={channel} className="channel-pill">{channel}</span>
          ))}
        </div>
      </Section>
    </main>
  );
}