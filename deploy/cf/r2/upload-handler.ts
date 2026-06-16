/**
 * R2 Upload Handler
 * 
 * JDD: 提供安全的檔案上傳介面，限制檔案類型和大小
 * KISS: 檢查 → 上傳 → 回傳，三步驟
 * DRY: 檢查邏輯可復用
 * LOG: 每次上傳記錄檔名、大小、類型、tenant
 */

const ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'application/pdf',
  'text/plain',
  'application/json',
] as const;

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export async function handleUpload(
  request: Request,
  env: { UPLOADS: R2Bucket; DB: D1Database; TENANT_ID: string }
): Promise<Response> {
  const contentType = request.headers.get('Content-Type') || '';
  const contentLength = Number(request.headers.get('Content-Length') || 0);

  // 1. 檢查檔案類型
  if (!ALLOWED_TYPES.includes(contentType as any)) {
    return jsonResponse({ error: `不支援的檔案類型: ${contentType}` }, 415);
  }

  // 2. 檢查檔案大小
  if (contentLength > MAX_FILE_SIZE) {
    return jsonResponse({ error: `檔案過大，最大 ${MAX_FILE_SIZE / 1024 / 1024}MB` }, 413);
  }

  // 3. 讀取並上傳
  try {
    const body = await request.arrayBuffer();
    const key = `${env.TENANT_ID}/${crypto.randomUUID().slice(0, 12)}${getExtension(contentType)}`;
    
    await env.UPLOADS.put(key, body, {
      httpMetadata: { contentType },
      customMetadata: {
        tenantId: env.TENANT_ID,
        uploadedAt: new Date().toISOString(),
        originalName: request.headers.get('X-Filename') || 'unknown'
      }
    });

    // 記錄到 D1
    await env.DB.prepare(
      'INSERT INTO audit_logs (id, tenant_id, action, resource, metadata) VALUES (?, ?, ?, ?, ?)'
    ).bind(
      crypto.randomUUID().slice(0, 16),
      env.TENANT_ID,
      'file_upload',
      key,
      JSON.stringify({ size: contentLength, type: contentType })
    ).run();

    return jsonResponse({ success: true, key, url: `/uploads/${key}` });
  } catch (err) {
    return jsonResponse({ error: '上傳失敗' }, 500);
  }
}

export async function handleDownload(
  key: string,
  env: { UPLOADS: R2Bucket }
): Promise<Response> {
  const object = await env.UPLOADS.get(key);
  if (!object) {
    return jsonResponse({ error: '檔案不存在' }, 404);
  }
  
  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${key.split('/').pop()}"`
    }
  });
}

function getExtension(contentType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'application/pdf': '.pdf',
    'text/plain': '.txt',
    'application/json': '.json',
  };
  return map[contentType] || '.bin';
}

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
