/**
 * Queue Worker - 消費佇列訊息
 * JDD: 處理所有異步任務（Lead、AI、通知、Webhook）
 * KISS: 每個 queue 有獨立的 consumer
 * DRY: 共享 error handling
 * LOG: 每條訊息消費記錄
 */
import { Hono } from 'hono';

export default {
  async queue(batch: MessageBatch<QueueMessage>, env: QueueEnvironment): Promise<void> {
    for (const message of batch.messages) {
      try {
        await env.WEBHOOK_FETCHER.fetch('https://openlaunch-worker.openlaunch.workers.dev/api/queue/process', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${env.PROCESSOR_SECRET}`
          },
          body: JSON.stringify({
            queue: message.queue,
            body: message.body,
            messageId: message.id
          })
        });
        message.ack();
      } catch (err) {
        console.error(JSON.stringify({
          level: 'error',
          event: 'queue_consume_failed',
          queue: message.queue,
          messageId: message.id,
          error: (err as Error).message
        }));
        try {
          const parsed = JSON.parse(message.body as string);
          if (parsed.retryCount && parsed.retryCount >= parsed.maxRetries) {
            message.deadletter();
          } else {
            message.retry();
          }
        } catch {
          message.deadletter();
        }
      }
    }
  }
};

interface QueueEnvironment {
  WEBHOOK_FETCHER: Fetcher;
  PROCESSOR_SECRET: string;
}

interface QueueMessage {
  queue: string;
  body: string;
  retryCount?: number;
  maxRetries?: number;
}
