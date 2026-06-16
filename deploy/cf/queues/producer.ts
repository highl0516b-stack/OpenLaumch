/**
 * Queue Producer - 發布訊息到佇列
 * 
 * JDD: 確保訊息可靠傳遞到消費者
 * KISS: 單一入口，統一 error handling
 * DRY: 共享 queue 名稱定義
 * LOG: 每條訊息記錄 queue、messageId、tenant
 */

export interface QueueMessage {
  type: string;
  tenantId: string;
  payload: Record<string, unknown>;
  createdAt: string;
  retryCount?: number;
  maxRetries?: number;
}

const QUEUE_NAMES = {
  LEAD_PROCESSING: 'lead-processing',
  EMAIL_SEND: 'email-send',
  NOTIFICATION: 'notification',
  AI_TASK: 'ai-task',
  WEBHOOK_DELIVER: 'webhook-deliver',
  REPORT_GENERATE: 'report-generate',
} as const;

// 發布訊息到指定佇列
export async function publishMessage(
  env: { QUEUE: Queue },
  queueName: string,
  message: QueueMessage
): Promise<void> {
  await env.QUEUE.send({
    queue: queueName,
    body: JSON.stringify(message),
  });
  
  console.log(JSON.stringify({
    level: 'info',
    event: 'queue_publish',
    queue: queueName,
    messageId: crypto.randomUUID().slice(0, 8),
    tenantId: message.tenantId,
    type: message.type,
    timestamp: message.createdAt
  }));
}

// Lead 處理佇列
export async function publishLeadMessage(env: { QUEUE: Queue }, tenantId: string, leadData: any) {
  await publishMessage(env, QUEUE_NAMES.LEAD_PROCESSING, {
    type: 'lead.new',
    tenantId,
    payload: leadData,
    createdAt: new Date().toISOString(),
    maxRetries: 3
  });
}

// AI 任務佇列
export async function publishAITask(env: { QUEUE: Queue }, tenantId: string, task: any) {
  await publishMessage(env, QUEUE_NAMES.AI_TASK, {
    type: 'ai.generate',
    tenantId,
    payload: task,
    createdAt: new Date().toISOString(),
    maxRetries: 2
  });
}

// 推播通知佇列
export async function publishNotification(env: { QUEUE: Queue }, tenantId: string, notification: any) {
  await publishMessage(env, QUEUE_NAMES.NOTIFICATION, {
    type: 'notification.send',
    tenantId,
    payload: notification,
    createdAt: new Date().toISOString(),
    maxRetries: 5
  });
}
