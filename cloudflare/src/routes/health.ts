// =============================================================================
// 健康檢查路由
// =============================================================================

import { jsonResponse } from "../lib/utils";

export async function handleHealth(): Promise<Response> {
  return jsonResponse({
    status: "ok",
    version: "1.0.0",
    ts: new Date().toISOString(),
  });
}
