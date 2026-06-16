/**
 * Queue Consumer - 消費佇列訊息
 * 
 * JDD: 每個 consumer 獨立處理，失敗可重試
 * KISS: 一個 consumer 只處理一類訊息
 * DRY: 共享 retry 邏輯
 * LOG: 消費記錄 + dead letter 記錄
 */

export interface QueueBatch {
  messages: Message[];
  ackAll(): void;
}

export interface Message {
  id: string;
  body: string;
  ack(): void;
  retry(): void;
  deadletter(): void;
}

// Lead 處理 Consumer
export class LeadProcessingConsumer {
  async process(batch: QueueBatch) {
    for (const message of batch.messages) {
      try {
        const data = JSON.parse(message.body);
        await this.processLead(data);
        message.ack();
      } catch (err) {
        console.error(JSON.stringify({
          level: 'error',
          event: 'lead_processing_failed',
          messageId: message.id,
          error: err.message
        }));
        // 重試次數用盡則丟到 dead letter
        try {
          const parsed = JSON.parse(message.body);
          if (parsed.retryCount >= parsed.maxRetries) {
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

  private async processLead(data: any) {
    // 1. 清洗資料
    // 2. 寫入 D1
    // 3. 發送通知
    // 4. 更新指標
    console.log(JSON.stringify({
      level: 'info',
      event: 'lead_processed',
      tenantId: data.tenantId,
      leadId: data.payload.leadId
    }));
  }
}

// AI 任務 Consumer
export class AITaskConsumer {
  async process(batch: QueueBatch) {
    for (const message of batch.messages) {
      try {
        const data = JSON.parse(message.body);
        const result = await this.executeTask(data);
        message.ack();
      } catch (err) {
        console.error(JSON.stringify({
          level: 'error',
          event: 'ai_task_failed',
          messageId: message.id,
          error: err.message
        }));
        message.retry();
      }
    }
  }

  private async executeTask(data: any) {
    // 執行 AI 生成任務
    console.log(JSON.stringify({
      level: 'info',
      event: 'ai_task_executed',
      tenantId: data.tenantId,
      type: data.payload.type
    }));
  }
}

// 通知 Consumer
export class NotificationConsumer {
  async process(batch: QueueBatch) {
    for (const message of batch.messages) {
      try {
        const data = JSON.parse(message.body);
        await this.sendNotification(data);
        message.ack();
      } catch (err) {
        console.error(JSON.stringify({
          level: 'error',
          event: 'notification_failed',
          messageId: message.id,
          error: err.message
        }));
        message.retry();
      }
    }
  }

  private async sendNotification(data: any) {
    console.log(JSON.stringify({
      level: 'info',
      event: 'notification_sent',
      tenantId: data.tenantId,
      channel: data.payload.channel
    }));
  }
}
