import fs from "node:fs";
import puppeteer from "puppeteer-core";
import { importWalletSeed, encipherSeed } from "tari-cipherseed";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const APP_URL = process.env.APP_URL ?? "http://localhost:5175/";
const API_URL = process.env.API_URL ?? "http://127.0.0.1:18083/api";
const SCAN_FROM = Number(process.env.SCAN_FROM ?? 331220);

const bytesToHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

const mnemonic = fs.readFileSync("taritestseed.txt", "utf8").trim();
const seed = await importWalletSeed(mnemonic);
const backupHex = bytesToHex(await encipherSeed(seed));
const birthdayMs = seed.birthday * 86_400_000;
console.log(
  `[e2e] seed loaded · birthday day=${seed.birthday} (${new Date(birthdayMs).toISOString()})`,
);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
});
const page = await browser.newPage();
page.on("console", (m) => {
  if (["error", "warning"].includes(m.type())) {
    console.log(`[page ${m.type()}]`, m.text().slice(0, 240));
  }
});
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 240)));

await page.evaluateOnNewDocument(
  (payload) => {
    localStorage.setItem("tari-l1-wallet/v1", JSON.stringify(payload));
  },
  {
    v: 1,
    network: "mainnet",
    backupHex,
    utxos: [],
    history: [],
    nodeUrl: "",
    scannerUrl: API_URL,
    scanThreads: 12,
    birthdayMs,
    lastScannedHeight: SCAN_FROM - 1,
  },
);

console.log(`[e2e] opening ${APP_URL}`);
await page.goto(APP_URL, { waitUntil: "networkidle2", timeout: 60_000 });

const deadline = Date.now() + 240_000;
let snapshot = null;
let sawScanStart = false;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 3000));
  snapshot = await page
    .evaluate(() => {
      const raw = localStorage.getItem("tari-l1-wallet/v1");
      if (!raw) return null;
      const p = JSON.parse(raw);
      return {
        utxoCount: (p.utxos ?? []).length,
        totalMicro: (p.utxos ?? [])
          .reduce((a, u) => a + BigInt(u.valueMicro), 0n)
          .toString(),
        lastScannedHeight: p.lastScannedHeight,
        history: (p.history ?? []).map((h) => `${h.status}: ${h.result ?? ""}`),
      };
    })
    .catch(() => null);
  if (!snapshot) continue;
  const interesting = snapshot.history.filter((h) =>
    /chain scan|Found|unavailable|failed import|scan error|horizon/i.test(h),
  );
  if (interesting.length > sawScanStart ? 1 : 0 || interesting.length > 0) {
    if (!sawScanStart && interesting.length > 0) sawScanStart = true;
    if (interesting.length > 0 && /Found|unavailable|failed import|scan error|horizon/.test(interesting[0])) {
      break;
    }
  }
  console.log(
    `[poll] utxos=${snapshot.utxoCount} total=${snapshot.totalMicro}µT last=${snapshot.lastScannedHeight}`,
  );
}

console.log("--- result ---");
if (snapshot) {
  console.log(`utxos: ${snapshot.utxoCount}`);
  console.log(`total : ${snapshot.totalMicro} microXTR`);
  console.log(`resume checkpoint: ${snapshot.lastScannedHeight}`);
  for (const h of snapshot.history) console.log(`history · ${h}`);
} else {
  console.log("wallet storage never appeared — app may have failed to boot");
}

try {
  fs.mkdirSync("shots", { recursive: true });
  await page.screenshot({ path: "shots/e2e-331220.png" });
  console.log("[e2e] screenshot saved to shots/e2e-331220.png");
} catch {}
await browser.close();
