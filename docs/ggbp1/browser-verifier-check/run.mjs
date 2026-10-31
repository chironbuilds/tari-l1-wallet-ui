// Runs the GGBP-1 v3 verifier-only WASM harness in real headless Chromium under several
// randomness conditions. Usage: node run.mjs <dir containing index.html and pkg/>
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const root = path.resolve(process.argv[2] ?? ".");
const types = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm", ".ts": "text/plain" };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
    const idx = path.join(root, "index.html");
    if (req.url === "/" && fs.existsSync(idx)) { res.writeHead(200, { "content-type": types[".html"] }); return res.end(fs.readFileSync(idx)); }
    res.writeHead(404); return res.end();
  }
  res.writeHead(200, { "content-type": types[path.extname(p)] ?? "application/octet-stream" });
  res.end(fs.readFileSync(p));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/`;

// Each scenario runs before any page script, in a fresh browser context.
const scenarios = {
  webcrypto_available: { init: null, expect: { positive: 0, negative: 0, randomness: 0 } },
  getRandomValues_throws: {
    init: () => { crypto.getRandomValues = () => { throw new DOMException("blocked for test", "QuotaExceededError"); }; },
    expect: { positive: 0, negative: 0, randomness: 1 },
  },
  crypto_absent: {
    init: () => { Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true }); },
    expect: { positive: 0, negative: 0, randomness: 1 },
  },
  // A polyfill that silently returns without filling: the probe CANNOT detect this (documented risk).
  silent_noop_polyfill: {
    init: () => { crypto.getRandomValues = (a) => a; },
    expect: { positive: 0, negative: 0, randomness: 0 },
  },
};

const browser = await chromium.launch();
const results = {};
let failed = false;
for (const [name, s] of Object.entries(scenarios)) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  if (s.init) await page.addInitScript(s.init);
  await page.goto(url);
  await page.waitForFunction(() => window.__result !== undefined, null, { timeout: 60_000 });
  const r = await page.evaluate(() => window.__result);
  const ok = Object.entries(s.expect).every(([k, v]) => r[k] === v);
  if (!ok) failed = true;
  results[name] = { ...r, pageErrors: errors, expected: s.expect, ok };
  await ctx.close();
}
results.browserVersion = browser.version();
await browser.close();
server.close();
console.log(JSON.stringify(results, null, 2));
process.exit(failed ? 1 : 0);
