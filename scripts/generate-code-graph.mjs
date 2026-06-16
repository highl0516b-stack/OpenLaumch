#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, ".tmp");
const MERMAID_FILE = path.join(OUT_DIR, "openlaunch-code-graph.mmd");
const PNG_FILE = path.join(OUT_DIR, "openlaunch-code-graph.png");
const HTML_FILE = path.join(OUT_DIR, "openlaunch-code-graph.html");
const JSON_FILE = path.join(OUT_DIR, "openlaunch-code-graph.json");

const IGNORED_DIRS = new Set([".git", ".next", "dist", "build", "out", ".tmp", "node_modules"]);
const SCANNABLE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md", ".mdx", ".ps1", ".css", ".html"]);
const IMPORT_RE = /import\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g;
const EXPORT_DECL_RE = /export\s+(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g;
const EXPORT_LIST_RE = /export\s*{([^}]+)}/g;

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function relativeToRoot(filePath) {
  return toPosix(path.relative(ROOT, filePath));
}

function nodeClass(relativePath) {
  if (relativePath.startsWith("apps/web")) return "web";
  if (relativePath.startsWith("packages/core")) return "core";
  if (relativePath.startsWith("packages/mcp-servers")) return "mcp";
  if (relativePath.startsWith("docs")) return "docs";
  if (relativePath === "package.json" || relativePath.endsWith("/package.json")) return "manifest";
  if (relativePath.endsWith(".css")) return "style";
  return "config";
}

async function walkDirectory(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;

    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkDirectory(fullPath));
      continue;
    }

    if (entry.isFile() && SCANNABLE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }

  return files.sort((a, b) => relativeToRoot(a).localeCompare(relativeToRoot(b)));
}

async function readTextIfExists(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}

function extractImports(source) {
  const imports = [];
  let match;
  while ((match = IMPORT_RE.exec(source)) !== null) {
    imports.push(match[1]);
  }
  return [...new Set(imports)];
}

function extractExports(source) {
  const exports = new Set();
  let match;

  while ((match = EXPORT_DECL_RE.exec(source)) !== null) {
    exports.add(match[1]);
  }

  while ((match = EXPORT_LIST_RE.exec(source)) !== null) {
    for (const item of match[1].split(",")) {
      const name = item.trim().split(/\s+as\s+/i).pop()?.trim();
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) exports.add(name);
    }
  }

  return [...exports].sort();
}

function resolveLocalPath(basePath) {
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    `${basePath}.jsx`,
    `${basePath}.mjs`,
    `${basePath}.cjs`,
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.tsx"),
    path.join(basePath, "index.js"),
    path.join(basePath, "index.jsx"),
    path.join(basePath, "index.mjs"),
    path.join(basePath, "index.cjs"),
  ];

  return candidates.find((candidate) => existsSync(candidate) && !IGNORED_DIRS.has(path.basename(candidate)));
}

function resolveImport(specifier, fromFile) {
  if (specifier.startsWith("node:") || specifier.startsWith("http:") || specifier.startsWith("https:")) {
    return null;
  }

  if (specifier === "@openlaunch/core") {
    return resolveLocalPath(path.join(ROOT, "packages", "core", "src", "index"));
  }

  if (specifier.startsWith("@openlaunch/core/")) {
    return resolveLocalPath(path.join(ROOT, "packages", "core", "src", specifier.slice("@openlaunch/core/".length)));
  }

  if (specifier === "@/" || specifier.startsWith("@/")) {
    return resolveLocalPath(path.join(ROOT, "apps", "web", specifier.slice(2)));
  }

  if (specifier.startsWith(".")) {
    return resolveLocalPath(path.resolve(path.dirname(fromFile), specifier));
  }

  return null;
}

function escapeMermaid(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, "'")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ");
}

function mermaidId(relativePath) {
  return `f_${relativeToRoot(relativePath).replace(/[^A-Za-z0-9_]/g, "_")}`;
}

function exportId(fileRelativePath, exportName) {
  return `e_${fileRelativePath.replace(/[^A-Za-z0-9_]/g, "_")}_${exportName.replace(/[^A-Za-z0-9_]/g, "_")}`;
}

function buildMermaid(fileInfos, importEdges) {
  const lines = [
    "flowchart TB",
    "  %% OpenLaunch code graph generated by scripts/generate-code-graph.mjs",
    "  root[\"OpenLaunch\"]",
    "  classDef root fill:#172554,stroke:#7dd3fc,stroke-width:2px,color:#e0f2fe",
    "  classDef web fill:#0f3b5f,stroke:#38bdf8,color:#e0f2fe",
    "  classDef core fill:#2e1065,stroke:#c084fc,color:#f5e8ff",
    "  classDef mcp fill:#064e3b,stroke:#34d399,color:#dcfce7",
    "  classDef docs fill:#422006,stroke:#fbbf24,color:#fef3c7",
    "  classDef manifest fill:#111827,stroke:#9ca3af,color:#f9fafb",
    "  classDef config fill:#374151,stroke:#6b7280,color:#f9fafb",
    "  classDef style fill:#3b0764,stroke:#d946ef,color:#fae8ff",
    "  classDef export fill:#052e16,stroke:#86efac,color:#ecfccb,stroke-width:1px,stroke-dasharray: 5 5",
    "  class root root",
  ];

  const groupNodes = new Map([
    ["apps_web", "apps/web"],
    ["packages_core", "packages/core"],
    ["packages_mcp_launch_server", "packages/mcp-servers/launch-server"],
    ["docs", "docs"],
    ["root_config", "root config"],
  ]);

  for (const [id, label] of groupNodes) {
    lines.push(`  ${id}["${escapeMermaid(label)}"]`);
    lines.push(`  class ${id} ${id === "packages_core" ? "core" : id === "packages_mcp_launch_server" ? "mcp" : id === "docs" ? "docs" : id === "root_config" ? "config" : "web"}`);
    lines.push("  root --> " + id);
  }

  for (const info of fileInfos) {
    const id = mermaidId(info.filePath);
    const className = nodeClass(info.relativePath);
    const groupId = info.relativePath.startsWith("apps/web")
      ? "apps_web"
      : info.relativePath.startsWith("packages/core")
        ? "packages_core"
        : info.relativePath.startsWith("packages/mcp-servers/launch-server")
          ? "packages_mcp_launch_server"
          : info.relativePath.startsWith("docs")
            ? "docs"
            : "root_config";

    lines.push(`  ${groupId} --> ${id}`);
    lines.push(`  ${id}["${escapeMermaid(info.relativePath)}"]`);
    lines.push(`  class ${id} ${className}`);

    for (const exportName of info.exports) {
      const eId = exportId(info.relativePath, exportName);
      lines.push(`  ${id} --> ${eId}`);
      lines.push(`  ${eId}["${escapeMermaid(exportName)}"]`);
      lines.push(`  class ${eId} export`);
    }
  }

  for (const edge of importEdges) {
    if (edge.from === edge.to) continue;
    lines.push(`  ${mermaidId(edge.from)} --> ${mermaidId(edge.to)}`);
  }

  return `${lines.join("\n")}\n`;
}

function buildHtml(mermaidSource, renderUrl) {
  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>OpenLaunch Code Graph</title>
  <script type="module">
    import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
    mermaid.initialize({ startOnLoad: true, theme: "dark", securityLevel: "loose" });
  </script>
  <style>
    :root { color-scheme: dark; }
    body {
      margin: 0;
      background: #0b1020;
      color: #e5e7eb;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    header {
      padding: 24px 32px 8px;
      border-bottom: 1px solid rgba(148, 163, 184, 0.25);
      background: linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.95));
    }
    h1 { margin: 0 0 8px; font-size: 28px; }
    p { margin: 0; color: #cbd5e1; }
    main { padding: 24px 32px 40px; }
    .render-note { margin-bottom: 16px; color: #93c5fd; }
    img { max-width: 100%; height: auto; border: 1px solid rgba(148, 163, 184, 0.35); border-radius: 16px; box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35); }
    pre { overflow: auto; padding: 20px; border-radius: 16px; background: #020617; border: 1px solid rgba(148, 163, 184, 0.25); }
  </style>
</head>
<body>
  <header>
    <h1>OpenLaunch 代碼圖譜</h1>
    <p>由 DEBUG 流程掃描 apps、packages、docs 與 root config 後生成；PNG 使用 Mermaid.ink CDN 渲染，下方保留 Mermaid CDN 即時渲染備援。</p>
  </header>
  <main>
    <p class="render-note">CDN PNG：<a style="color:#93c5fd" href="${escapeMermaid(renderUrl)}">${escapeMermaid(renderUrl)}</a></p>
    <img alt="OpenLaunch code graph rendered by Mermaid.ink CDN" src="${escapeMermaid(renderUrl)}">
    <h2>Mermaid CDN fallback</h2>
    <pre class="mermaid">${escapeMermaid(mermaidSource)}</pre>
  </main>
</body>
</html>
`;
}

async function fetchWithTimeout(url, timeoutMs = 30000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "OpenLaunch-Debug/0.1" },
    });
  } finally {
    clearTimeout(timeout);
  }
}

function isPngResponse(response, buffer) {
  const contentType = String(response.headers.get("content-type") ?? "");
  const pngSignature = "89504e470d0a1a0a";
  return response.ok && (contentType.includes("image/png") || buffer.subarray(0, 8).toString("hex") === pngSignature);
}

async function tryRender(renderUrl) {
  const response = await fetchWithTimeout(renderUrl);
  const buffer = Buffer.from(await response.arrayBuffer());

  if (!isPngResponse(response, buffer)) {
    const preview = buffer.subarray(0, 240).toString("utf8").replace(/\s+/g, " ");
    throw new Error(`Mermaid.ink CDN render failed: HTTP ${response.status}, ${preview}`);
  }

  return { buffer, renderUrl };
}

async function renderWithMermaidInk(mermaidSource) {
  const rawEncoded = Buffer.from(mermaidSource, "utf8").toString("base64url");
  const compressedEncoded = deflateSync(Buffer.from(mermaidSource, "utf8"), { level: 9 }).toString("base64url");
  const query = "bgColor=0b1020&theme=dark&width=2600&height=3600";
  const candidates = [
    `https://mermaid.ink/png/pako:${compressedEncoded}?${query}`,
    `https://mermaid.ink/png/${rawEncoded}?${query}`,
  ];

  let lastError;
  for (const renderUrl of candidates) {
    try {
      return await tryRender(renderUrl);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const files = await walkDirectory(ROOT);
  const fileInfos = [];

  for (const filePath of files) {
    const source = await readTextIfExists(filePath);
    fileInfos.push({
      filePath,
      relativePath: relativeToRoot(filePath),
      imports: extractImports(source),
      exports: extractExports(source),
    });
  }

  const importEdges = [];
  for (const info of fileInfos) {
    for (const specifier of info.imports) {
      const resolved = resolveImport(specifier, info.filePath);
      if (!resolved) continue;
      importEdges.push({
        from: info.filePath,
        to: resolved,
        specifier,
      });
    }
  }

  const mermaidSource = buildMermaid(fileInfos, importEdges);
  const { buffer, renderUrl } = await renderWithMermaidInk(mermaidSource);

  await writeFile(MERMAID_FILE, mermaidSource, "utf8");
  await writeFile(PNG_FILE, buffer);
  await writeFile(HTML_FILE, buildHtml(mermaidSource, renderUrl), "utf8");
  await writeFile(JSON_FILE, JSON.stringify({
    generatedAt: new Date().toISOString(),
    sourceFiles: fileInfos.map(({ filePath, relativePath, imports, exports }) => ({
      filePath: relativePath,
      imports,
      exports,
    })),
    importEdges: importEdges.map(({ from, to, specifier }) => ({
      from: relativeToRoot(from),
      to: relativeToRoot(to),
      specifier,
    })),
    outputs: {
      mermaid: relativeToRoot(MERMAID_FILE),
      png: relativeToRoot(PNG_FILE),
      html: relativeToRoot(HTML_FILE),
    },
  }, null, 2), "utf8");

  console.log(`Code graph generated: ${relativeToRoot(PNG_FILE)}`);
  console.log(`CDN HTML: ${relativeToRoot(HTML_FILE)}`);
  console.log(`Mermaid source: ${relativeToRoot(MERMAID_FILE)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});