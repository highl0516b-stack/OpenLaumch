"use client";

import { type ChangeEvent, type FormEvent, useMemo, useState } from "react";
import type { ChannelKey, LaunchBrief, LaunchPlan } from "@openlaunch/core";
import { LaunchPreview } from "./LaunchPreview";

const channelOptions: Array<{ value: ChannelKey; label: string }> = [
  { value: "x", label: "X / Twitter" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "xiaohongshu", label: "小紅書" },
  { value: "youtube_shorts", label: "YouTube Shorts" },
  { value: "discord", label: "Discord" },
  { value: "telegram", label: "Telegram" },
  { value: "product_hunt", label: "Product Hunt" },
  { value: "hacker_news", label: "Hacker News" },
  { value: "indie_hackers", label: "Indie Hackers" },
  { value: "email", label: "Email" },
];

const defaultBrief: LaunchBrief = {
  productName: "OpenLaunch",
  oneLiner: "Turn one product idea into a complete launch campaign.",
  audience: "founders, indie hackers and startup operators",
  problem: "launch tools are fragmented across landing pages, content, waitlists, CRM and investor updates",
  launchGoal: "waitlist",
  channels: ["x", "linkedin", "product_hunt", "email"],
  targetMarket: "global indie builders and startup teams",
  pricingHint: "freemium with Pro launch automation",
};

export function MagicMomentForm() {
  const [brief, setBrief] = useState<LaunchBrief>(defaultBrief);
  const [plan, setPlan] = useState<LaunchPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const completion = useMemo(() => {
    const filled = Object.values(brief).filter((value) => Array.isArray(value) ? value.length > 0 : Boolean(value)).length;
    return Math.round((filled / Object.keys(brief).length) * 100);
  }, [brief]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/launch/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(brief),
      });

      if (!response.ok) {
        throw new Error(`Launch generation failed: ${response.status}`);
      }

      const data = (await response.json()) as LaunchPlan;
      setPlan(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  function updateField<K extends keyof LaunchBrief>(key: K, value: LaunchBrief[K]) {
    setBrief((current: LaunchBrief) => ({ ...current, [key]: value }));
  }

  function toggleChannel(channel: ChannelKey) {
    setBrief((current: LaunchBrief) => {
      const exists = current.channels.includes(channel);
      const next = exists ? current.channels.filter((item: ChannelKey) => item !== channel) : [...current.channels, channel];
      return { ...current, channels: next.length > 0 ? next : current.channels };
    });
  }

  return (
    <div className="magic-grid">
      <form className="brief-form" onSubmit={handleSubmit}>
        <div className="progress-card">
          <span>Launch brief completion</span>
          <strong>{completion}%</strong>
          <div className="progress-bar"><i style={{ width: `${completion}%` }} /></div>
        </div>

        <label>
          產品名稱
          <input value={brief.productName} onChange={(event: ChangeEvent<HTMLInputElement>) => updateField("productName", event.target.value)} />
        </label>

        <label>
          一句話定位
          <textarea value={brief.oneLiner} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => updateField("oneLiner", event.target.value)} rows={3} />
        </label>

        <label>
          目標受眾
          <input value={brief.audience} onChange={(event: ChangeEvent<HTMLInputElement>) => updateField("audience", event.target.value)} />
        </label>

        <label>
          核心痛點
          <textarea value={brief.problem} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => updateField("problem", event.target.value)} rows={3} />
        </label>

        <label>
          市場 / 地區
          <input value={brief.targetMarket ?? ""} onChange={(event: ChangeEvent<HTMLInputElement>) => updateField("targetMarket", event.target.value)} />
        </label>

        <label>
          價格假設
          <input value={brief.pricingHint ?? ""} onChange={(event: ChangeEvent<HTMLInputElement>) => updateField("pricingHint", event.target.value)} />
        </label>

        <label>
          Launch goal
          <select value={brief.launchGoal} onChange={(event: ChangeEvent<HTMLSelectElement>) => updateField("launchGoal", event.target.value as LaunchBrief["launchGoal"])}>
            <option value="waitlist">Waitlist</option>
            <option value="fundraising">Funding</option>
            <option value="partnership">Partnership</option>
            <option value="sales">Sales</option>
            <option value="community">Community</option>
          </select>
        </label>

        <fieldset>
          <legend>分發渠道</legend>
          <div className="channel-picker">
            {channelOptions.map((option) => (
              <button
                type="button"
                key={option.value}
                className={brief.channels.includes(option.value) ? "selected" : undefined}
                onClick={() => toggleChannel(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>

        <button className="button primary full" type="submit" disabled={loading}>
          {loading ? "Generating..." : "一鍵生成 Launch Pack"}
        </button>

        {error && <p className="error">{error}</p>}
      </form>

      <LaunchPreview plan={plan} loading={loading} />
    </div>
  );
}