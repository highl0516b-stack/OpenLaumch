/**
 * AgentSession Durable Object
 * 
 * 管理單個 AI Agent 會話的狀態，支援：
 * - WebSocket 即時通訊
 * - 會話記憶（短期 + 持久化到 D1）
 * - 多玩家/多客戶協作
 * 
 * JDD: 確保 Agent 狀態在 WebSocket 斷線後可恢復
 * KISS: 每個 DO 只管理一個 Agent 會話
 * DRY: 記憶操作方法抽取到工具函數
 * LOG: 所有狀態變更記錄 audit log
 */

export class AgentSession {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const action = url.searchParams.get("action") || "connect";

    switch (action) {
      case "connect":
        return this.handleConnect(request);
      case "message":
        return this.handleMessage(request);
      case "history":
        return this.getHistory(request);
      case "state":
        return this.getState();
      default:
        return new Response("Not Found", { status: 404 });
    }
  }

  // WebSocket 連線處理
  async handleConnect(request) {
    const upgradeHeader = request.headers.get("Upgrade");
    if (upgradeHeader !== "websocket") {
      return new Response("Expected WebSocket", { status: 400 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    
    // 接受 WebSocket
    this.state.acceptWebSocket(server);

    // 初始化會話
    const sessionId = this.state.id.toString();
    await this.sendMessageToClient(client, {
      type: "connected",
      sessionId,
      timestamp: Date.now()
    });

    // 記錄審計日誌
    await this.auditLog("websocket_connect", { sessionId });

    return new Response(null, { status: 101, webSocket: client });
  }

  // WebSocket 訊息處理
  async webSocketMessage(ws, message) {
    if (typeof message === "string") {
      try {
        const data = JSON.parse(message);
        
        switch (data.type) {
          case "chat":
            await this.handleChat(ws, data);
            break;
          case "memory_query":
            await this.handleMemoryQuery(ws, data);
            break;
          case "heartbeat":
            await this.handleHeartbeat(ws, data);
            break;
          default:
            await this.sendMessageToClient(ws, {
              type: "error",
              message: `Unknown type: ${data.type}`
            });
        }
      } catch (err) {
        await this.sendMessageToClient(ws, {
          type: "error",
          message: "Invalid JSON message"
        });
      }
    }
  }

  // WebSocket 斷線處理
  async webSocketClose(ws, code, reason) {
    await this.auditLog("websocket_disconnect", { code, reason });
  }

  // === 核心業務邏輯 ===

  async handleChat(ws, data) {
    const { content, model = "openai/gpt-4.1-mini" } = data;
    const sessionId = this.state.id.toString();

    // 1. 記錄用戶訊息
    const userMsg = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      timestamp: Date.now()
    };
    await this.appendMessage(sessionId, userMsg);

    // 2. 構建上下文（從記憶 + 系統提示）
    const history = await this.getMessageHistory(sessionId, 20);
    const config = await this.getAgentConfig();
    const context = [...config.systemMessages, ...history, userMsg];

    // 3. 呼叫 AI 模型（透過 OpenRouter）
    const aiResponse = await this.callAI(model, context);

    // 4. 儲存 AI 回應
    const assistantMsg = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: aiResponse.content,
      model,
      timestamp: Date.now(),
      usage: aiResponse.usage
    };
    await this.appendMessage(sessionId, assistantMsg);

    // 5. 回傳給客戶端
    await this.sendMessageToClient(ws, {
      type: "chat_response",
      message: assistantMsg
    });

    // 6. 非同步持久化到 D1
    this.ctx.waitUntil(this.persistToD1(sessionId));
  }

  async handleMemoryQuery(ws, data) {
    const { query } = data;
    const sessionId = this.state.id.toString();
    
    // 從 KV + D1 查詢相關記憶
    const memories = await this.searchMemory(query);
    await this.sendMessageToClient(ws, {
      type: "memory_response",
      memories
    });
  }

  async handleHeartbeat(ws, data) {
    const sessionId = this.state.id.toString();
    this.state.blockConcurrencyWhile(async () => {
      await this.state.storage.put("last_heartbeat", Date.now());
    });
    await this.sendMessageToClient(ws, {
      type: "heartbeat_ack",
      sessionId,
      timestamp: Date.now()
    });
  }

  // === 私有方法 ===

  async callAI(model, context) {
    const router = this.env.OPENROUTER_API_KEY;
    const body = JSON.stringify({
      model,
      messages: context.map(m => ({ role: m.role, content: m.content })),
      max_tokens: 4096,
      temperature: 0.7
    });

    return fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${router}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://openlaunch.example.com",
        "X-Title": "OpenLaunch"
      },
      body
    }).then(r => r.json()).then(data => ({
      content: data.choices[0].message.content,
      usage: data.usage
    }));
  }

  async appendMessage(sessionId, msg) {
    const key = `session:${sessionId}:messages:${msg.id}`;
    await this.state.storage.put(key, JSON.stringify(msg));
    // 更新最新消息索引
    await this.state.storage.put(`session:${sessionId}:latest`, msg.id);
  }

  async getMessageHistory(sessionId, limit = 20) {
    const prefix = `session:${sessionId}:messages:`;
    const messages = [];
    for await (const [key, value] of this.state.storage.list({ prefix })) {
      messages.push(JSON.parse(value));
      if (messages.length >= limit) break;
    }
    return messages.sort((a, b) => a.timestamp - b.timestamp);
  }

  async getAgentConfig() {
    const config = await this.state.storage.get("agent_config");
    return config ? JSON.parse(config) : {
      systemMessages: [{
        role: "system",
        content: "你是一個專業的 Launch Copilot，幫助用戶打造產品發布計劃。"
      }]
    };
  }

  async searchMemory(query) {
    // 簡化：從這個 session 的記錄中搜尋
    const sessionId = this.state.id.toString();
    const messages = await this.getMessageHistory(sessionId, 50);
    const lowerQuery = query.toLowerCase();
    return messages.filter(m => 
      m.content.toLowerCase().includes(lowerQuery)
    ).slice(-10);
  }

  async persistToD1(sessionId) {
    const messages = await this.getMessageHistory(sessionId, 100);
    if (this.env.DB) {
      for (const msg of messages) {
        await this.env.DB.prepare(
          "INSERT OR REPLACE INTO audit_logs (id, tenant_id, action, resource, metadata, created_at) " +
          "VALUES (?, ?, 'agent_message', ?, ?, ?)"
        ).bind(
          msg.id, sessionId, `message:${msg.role}`,
          JSON.stringify({ content: msg.content.substring(0, 500) }),
          new Date(msg.timestamp).toISOString()
        ).run();
      }
    }
  }

  async sendMessageToClient(ws, data) {
    ws.send(JSON.stringify(data));
  }

  async auditLog(action, metadata) {
    const log = {
      action,
      metadata,
      timestamp: Date.now(),
      doId: this.state.id.toString()
    };
    await this.state.storage.put(`audit:${log.timestamp}`, JSON.stringify(log));
  }
}
