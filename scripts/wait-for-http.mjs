const url = process.argv[2];
const timeoutMs = Number.parseInt(process.env.WAIT_HTTP_TIMEOUT_MS ?? "60000", 10);
const intervalMs = Number.parseInt(process.env.WAIT_HTTP_INTERVAL_MS ?? "1000", 10);

if (!url) {
  console.error("Usage: node scripts/wait-for-http.mjs <url>");
  process.exit(2);
}

const startedAt = Date.now();

async function check() {
  try {
    const response = await fetch(url);
    const body = await response.text();

    if (response.ok) {
      console.log(`OK ${url} -> ${response.status}`);
      if (body.trim()) {
        console.log(body.slice(0, 500));
      }
      return true;
    }

    console.log(`Waiting ${url} -> ${response.status}`);
  } catch (error) {
    console.log(`Waiting ${url} -> ${error.message}`);
  }

  return false;
}

while (Date.now() - startedAt < timeoutMs) {
  if (await check()) {
    process.exit(0);
  }

  await new Promise((resolve) => setTimeout(resolve, intervalMs));
}

console.error(`Timed out waiting for ${url}`);
process.exit(1);
