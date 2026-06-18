"use client";

import { useMemo, useState, type FormEvent } from "react";

type ChannelKey =
  | "x"
  | "linkedin"
  | "xiaohongshu"
  | "youtube_shorts"
  | "discord"
  | "telegram"
  | "product_hunt"
  | "hacker_news"
  | "indie_hackers"
  | "email";

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
};

export function MagicMomentForm() {
  const [brief, setBrief] = useState("");
  const [channels, setChannels] = useState<ChannelKey[]>(["x", "linkedin", "email"]);
  const [output, setOutput] = useState<string | null>(null);

  const selectedLabels = useMemo(() => channels.map((channel) => channelLabels[channel]), [channels]);

  function toggleChannel(channel: ChannelKey) {
    setChannels((current) =>
      current.includes(channel)
        ? current.filter((item) => item !== channel)
        : [...current, channel],
    );
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = brief.trim();

    if (!trimmed) {
      setOutput("請先輸入一句產品 brief。");
      return;
    }

    setOutput(
      [
        "已生成可審查 launch pack 草稿：",
        "",
        `Brief：${trimmed}`,
        `Channels：${selectedLabels.join("、")}`,
        "",
        "Next actions：",
        "1. 產出 landing page hero copy。",
        "2. 產出 5 個渠道文案版本。",
        "3. 建立 30 日 launch calendar。",
        "4. 產出候客名單與第一批 outreach message。",
      ].join("\n"),
    );
  }

  return (
    <form className="magic-form" onSubmit={handleSubmit}>
      <label>
        一句產品 brief
        <textarea
          value={brief}
          onChange={(event) => setBrief(event.target.value)}
          placeholder="例如：一個幫 founder 從一句話生成 launch campaign 的 AI command center。"
          rows={5}
        />
      </label>

      <fieldset>
        <legend>渠道</legend>
        {Object.entries(channelLabels).map(([channel, label]) => (
          <label key={channel} className="channel-check">
            <input
              type="checkbox"
              checked={channels.includes(channel as ChannelKey)}
              onChange={() => toggleChannel(channel as ChannelKey)}
            />
            {label}
          </label>
        ))}
      </fieldset>

      <div className="form-actions">
        <button className="button primary" type="submit">生成 launch pack</button>
        <button
          className="button secondary"
          type="button"
          onClick={() => {
            setBrief("一個幫 founder 從一句話生成 launch campaign 的 AI command center。");
            setChannels(["x", "linkedin", "xiaohongshu", "email", "product_hunt"]);
          }}
        >
          填入範例
        </button>
      </div>

      {output ? (
        <pre className="magic-output">{output}</pre>
      ) : (
        <p className="form-note">MVP 先在瀏覽器生成可審查草稿，後續可接 OpenLaunch API、MCP gateway 與 webhook。</p>
      )}
    </form>
  );
}
