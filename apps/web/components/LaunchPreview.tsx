import type { LaunchPlan } from "@openlaunch/core";

interface LaunchPreviewProps {
  plan: LaunchPlan | null;
  loading: boolean;
}

export function LaunchPreview({ plan, loading }: LaunchPreviewProps) {
  if (loading) {
    return (
      <div className="preview-card loading">
        <div className="spinner" />
        <h3>正在生成 launch command center...</h3>
        <p>正在組裝 landing page、全網文案、lead segments、investor one-pager 與 30 天跟進節奏。</p>
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="preview-card empty">
        <h3>你的 Magic Moment 會出現在這裡</h3>
        <p>提交後，系統會即時生成可編輯 launch pack。</p>
        <ul>
          <li>Landing page copy</li>
          <li>多頻道文案包</li>
          <li>候客名單與 lead segments</li>
          <li>投資人 one-pager</li>
          <li>30 天 launch calendar</li>
        </ul>
      </div>
    );
  }

  return (
    <div className="preview-card">
      <div className="preview-header">
        <div>
          <p className="eyebrow">{plan.id}</p>
          <h3>{plan.productName}</h3>
        </div>
        <span>{new Date(plan.createdAt).toLocaleTimeString()}</span>
      </div>

      <section>
        <h4>Landing page</h4>
        <p className="muted">{plan.landingPage.heroSubtitle}</p>
        <div className="bullet-list">
          {plan.landingPage.valueBullets.map((bullet) => <p key={bullet}>✓ {bullet}</p>)}
        </div>
      </section>

      <section>
        <h4>Top campaign copy</h4>
        {plan.campaignCopy.slice(0, 3).map((copy) => (
          <article className="copy-block" key={copy.channel}>
            <strong>{copy.title}</strong>
            <p>{copy.body}</p>
            <small>CTA: {copy.cta}</small>
          </article>
        ))}
      </section>

      <section>
        <h4>Lead segments</h4>
        {plan.leadSegments.map((segment) => (
          <article className="copy-block" key={segment.name}>
            <strong>{segment.name}</strong>
            <p>{segment.description}</p>
            <small>{segment.firstMessage}</small>
          </article>
        ))}
      </section>

      <section>
        <h4>Investor one-pager</h4>
        <p><strong>Problem:</strong> {plan.investorOnePager.problem}</p>
        <p><strong>Solution:</strong> {plan.investorOnePager.solution}</p>
        <p><strong>Ask:</strong> {plan.investorOnePager.ask}</p>
      </section>

      <section>
        <h4>Next actions</h4>
        <ol>
          {plan.nextActions.map((action) => <li key={action}>{action}</li>)}
        </ol>
      </section>
    </div>
  );
}