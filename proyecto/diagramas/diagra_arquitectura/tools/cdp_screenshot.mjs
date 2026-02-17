import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";

function parseArgs(argv) {
  const out = { port: 9222, w: 2400, h: 1600, dpr: 2, waitMs: 1200 };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (!k.startsWith("--")) continue;
    i++;
    if (k === "--url") out.url = v;
    else if (k === "--out") out.out = v;
    else if (k === "--chrome") out.chrome = v;
    else if (k === "--port") out.port = Number(v);
    else if (k === "--w") out.w = Number(v);
    else if (k === "--h") out.h = Number(v);
    else if (k === "--dpr") out.dpr = Number(v);
    else if (k === "--wait") out.waitMs = Number(v);
  }
  if (!out.url || !out.out) {
    throw new Error("Usage: node cdp_screenshot.mjs --url <url> --out <png> [--chrome <path>] [--port 9222] [--w 2400 --h 1600 --dpr 2] [--wait 1200]");
  }
  out.chrome ||= "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  return out;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

async function main() {
  const args = parseArgs(process.argv);
  const userDataDir = `/tmp/chrome-cdp-profile-${Date.now()}`;

  const chrome = spawn(
    args.chrome,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${userDataDir}`,
      `--remote-debugging-port=${args.port}`,
    ],
    { stdio: "ignore" }
  );

  try {
    // Wait for the debugging endpoint to come up.
    let version = null;
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        version = await fetchJson(`http://127.0.0.1:${args.port}/json/version`);
        break;
      } catch {
        await sleep(150);
      }
    }
    if (!version) throw new Error("Chrome DevTools endpoint did not start.");

    // Create a new target with the requested URL.
    const target = await fetchJson(
      `http://127.0.0.1:${args.port}/json/new?${encodeURIComponent(args.url)}`
    );
    const wsUrl = target.webSocketDebuggerUrl;
    if (!wsUrl) throw new Error("No webSocketDebuggerUrl returned.");

    const ws = new WebSocket(wsUrl);
    let nextId = 1;
    const pending = new Map();
    let loadFired = false;

    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
        return;
      }
      if (msg.method === "Page.loadEventFired") loadFired = true;
    });

    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    });

    function send(method, params = {}) {
      const id = nextId++;
      const payload = { id, method, params };
      ws.send(JSON.stringify(payload));
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
      });
    }

    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", {
      width: args.w,
      height: args.h,
      deviceScaleFactor: args.dpr,
      mobile: false,
    });
    await send("Page.navigate", { url: args.url });

    // Wait for load.
    for (let attempt = 0; attempt < 60 && !loadFired; attempt++) {
      await sleep(100);
    }
    await sleep(args.waitMs);

    const shot = await send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
    });
    await writeFile(args.out, Buffer.from(shot.data, "base64"));

    ws.close();
  } finally {
    chrome.kill("SIGKILL");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

