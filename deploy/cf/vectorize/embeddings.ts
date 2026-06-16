/**
 * Vectorize Embeddings
 * 
 * JDD: 提供語意搜尋和 RAG 的向量化能力
 * KISS: 統一的 embed 入口，支援文字和文件
 * DRY: 模型配置集中管理
 * LOG: 每次嵌入記錄維度、tokens、模型
 */

import { Ai } from '@cloudflare/ai';

export interface EmbeddingResult {
  success: boolean;
  vector?: number[];
  model?: string;
  tokens?: number;
  error?: string;
}

export interface SearchResult {
  id: string;
  score: number;
  text: string;
  metadata: Record<string, unknown>;
}

const EMBEDDING_MODEL = 'openai/text-embedding-3-small';

// 文字嵌入
export async function embedText(
  text: string,
  env: { VECTORIZE_INDEX: VectorizeIndex; AI: Ai; DB: D1Database; TENANT_ID: string }
): Promise<EmbeddingResult> {
  try {
    const embedding = await env.AI.run(EMBEDDING_MODEL, { text });
    
    return {
      success: true,
      vector: embedding.embedding as number[],
      model: EMBEDDING_MODEL,
      tokens: embedding.usage?.tokens || 0
    };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}

// 儲存向量到 Vectorize
export async function storeVector(
  env: { VECTORIZE_INDEX: VectorizeIndex; DB: D1Database; TENANT_ID: string },
  id: string,
  vector: number[],
  text: string,
  metadata: Record<string, unknown> = {}
): Promise<boolean> {
  try {
    await env.VECTORIZE_INDEX.upsert([{
      id,
      values: vector,
      metadata: {
        ...metadata,
        text: text.slice(0, 500),  // 截取前500字
        tenantId: env.TENANT_ID,
        createdAt: new Date().toISOString()
      }
    }]);
    
    return true;
  } catch (err) {
    console.error(JSON.stringify({
      level: 'error',
      event: 'vector_store_failed',
      error: (err as Error).message,
      id
    }));
    return false;
  }
}

// 語意搜尋
export async function semanticSearch(
  env: { VECTORIZE_INDEX: VectorizeIndex },
  query: string,
  embedding: number[],
  topK = 10,
  filter?: Record<string, unknown>
): Promise<SearchResult[]> {
  try {
    const results = await env.VECTORIZE_INDEX.query(embedding, {
      topK,
      returnMetadata: true,
      returnValues: false,
      filter
    });
    
    return results.matches.map(match => ({
      id: match.id,
      score: match.score || 0,
      text: (match.metadata as any)?.text || '',
      metadata: match.metadata as Record<string, unknown>
    }));
  } catch (err) {
    console.error(JSON.stringify({
      level: 'error',
      event: 'vector_search_failed',
      error: (err as Error).message,
      query
    }));
    return [];
  }
}

// Pipeline: 嵌入 + 儲存 + 搜尋（端到端）
export async function embedStoreAndSearch(
  env: { 
    AI: Ai; 
    VECTORIZE_INDEX: VectorizeIndex; 
    DB: D1Database; 
    TENANT_ID: string 
  },
  documents: { id: string; text: string; metadata?: Record<string, unknown> }[],
  query?: string,
  topK = 10
): Promise<{
  embeddings: EmbeddingResult[];
  results: SearchResult[];
}> {
  const embeddings: EmbeddingResult[] = [];
  
  // 1. 嵌入所有文件
  for (const doc of documents) {
    const result = await embedText(doc.text, env);
    if (result.success && result.vector) {
      await storeVector(env, doc.id, result.vector, doc.text, doc.metadata);
    }
    embeddings.push(result);
  }
  
  // 2. 如果有查詢，執行搜尋
  let results: SearchResult[] = [];
  if (query) {
    const queryEmbedding = await embedText(query, env);
    if (queryEmbedding.success && queryEmbedding.vector) {
      results = await semanticSearch(env, query, queryEmbedding.vector, topK);
    }
  }
  
  return { embeddings, results };
}
