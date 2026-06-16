/**
 * AI Gateway 配置 - OpenRouter 中繼
 * 
 * 由於香港 IP 被部分 AI 供應商封鎖，所有 Workers AI 請求透過 OpenRouter 代理。
 * OpenRouter 會自動選擇最佳可用模型和區域。
 * 
 * JDD: 確保 AI 請求在 HK 節點仍可正常執行
 * KISS: 單一入口點統一轉發
 * DRY: OpenRouter URL 在此集中管理
 * LOG: 每次 AI 調用記錄 model、latency、cost、status
 */

export const AI_CONFIG = {
  // OpenRouter 配置
  OPENROUTER_BASE_URL: "https://openrouter.ai/api/v1",
  OPENROUTER_API_KEY: "", // 由 CF Secret 注入，正式環境從 Secrets Store 讀取
  
  // 模型映射：OpenLaunch 內部名稱 → OpenRouter 模型 ID
  MODELS: {
    // LLM
    "gpt-4o-mini":      "openai/gpt-4.1-mini",
    "gpt-4o":           "openai/gpt-4.1",
    "claude-sonnet-4":   "anthropic/claude-sonnet-4",
    "claude-haiku-3":    "anthropic/claude-3.5-haiku",
    "gemini-flash":      "google/gemini-2.0-flash",
    "llama-3.1-70b":     "meta-llama/llama-3.1-70b-instruct",
    "mistral-7b":        "mistralai/mistral-7b-instruct",
    
    // 圖像生成
    "flux-schnell":       "black-forest-labs/flux-schnell",
    "flux-dev":          "black-forest-labs/flux-dev",
    "sdxl":              "stability-ai/stable-diffusion-xl",
    
    // Embedding
    "text-embedding-3-small": "openai/text-embedding-3-small",
    "text-embedding-3-large": "openai/text-embedding-3-large",
  } as const,

  // 回退策略
  FALLBACK: {
    // 若 OpenRouter 失敗，嘗試的直接 AI Gateway 端點
    DIRECT_AI_GATEWAY: "https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/v1",
    MAX_RETRIES: 2,
    RETRY_DELAY_MS: 1000,
  },

  // 限制
  LIMITS: {
    MAX_TOKENS: 4096,
    MAX_REQUESTS_PER_MINUTE: 60,
    TIMEOUT_MS: 30000,
  },

  // 日誌標籤
  LOG_PREFIX: "[AI-Gateway/OpenRouter]",
} as const;

// 各環境的 OpenRouter 模型首選列表（成本最佳化）
export const MODEL_PREFERENCES = {
  sandbox: ["gpt-4o-mini", "gemini-flash", "llama-3.1-70b"],
  production: ["gpt-4o-mini", "claude-haiku-3", "gemini-flash"],
} as const;
