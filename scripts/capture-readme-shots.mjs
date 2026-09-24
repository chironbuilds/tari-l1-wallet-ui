// Captures the raw UI screenshots behind the README / announcement images.
//
// Runs headless Chrome in a throwaway profile against the dev server, creates a fresh Esmeralda
// wallet there (never touches a real one), and fills it with demo-only balances, activity and
// burns through the app's own store so the screens look lived-in. Output: shots/readme-raw/*.png
// at 2x device pixels, composed into docs/screenshots by make-readme-assets.py.
//
//   npm run dev   (in another terminal)
//   node scripts/capture-readme-shots.mjs [baseUrl]
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.argv[2] ?? "http://localhost:5173/";
const OUT = path.resolve("shots/readme-raw");
const DEMO_PIN = "4826";
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: true,
  args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--window-size=1440,900"],
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);

async function clickButton(match) {
  const ok = await page.evaluate((m) => {
    const b = [...document.querySelectorAll("button")].find((x) => x.title === m || x.textContent?.trim() === m || x.textContent?.includes(m));
    if (!b) return false;
    b.click();
    return true;
  }, match);
  if (!ok) throw new Error(`button not found: ${match}`);
}

async function shot(name) {
  await sleep(900);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log("captured", name);
}

// Calls a function on the app's store context value (found by walking the React fiber tree), so
// demo data goes in through the same code paths the UI uses.
async function store(fn, ...args) {
  return page.evaluate(
    (fnName, a) => {
      const container = document.getElementById("root");
      const key = Object.keys(container).find((k) => k.startsWith("__reactContainer$"));
      const stack = [container[key]];
      while (stack.length) {
        const f = stack.pop();
        if (!f) continue;
        const v = f.memoizedProps?.value;
        if (v && typeof v === "object" && typeof v.fundDemo === "function") {
          const revived = a.map((x) => (typeof x === "string" && x.startsWith("bigint:") ? BigInt(x.slice(7)) : x));
          v[fnName](...revived);
          return true;
        }
        if (f.sibling) stack.push(f.sibling);
        if (f.child) stack.push(f.child);
      }
      throw new Error("store not found");
    },
    fn,
    args,
  );
}

await page.goto(BASE, { waitUntil: "networkidle2", timeout: 60000 });
await sleep(2500);
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle2" });
await sleep(2500);

// Fresh Esmeralda wallet.
await clickButton("Esmeralda testnet");
await page.evaluate((pin) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  for (const input of document.querySelectorAll('input[type="password"]')) {
    setter.call(input, pin);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
}, DEMO_PIN);
await clickButton("Create new wallet");
await sleep(5000);
if (!(await page.evaluate(() => document.documentElement.dataset.theme === "dark"))) await clickButton("Toggle theme");
await sleep(800);

// Demo-only state: never persisted as spendable, gone on reload.
const now = Date.now();
const min = 60_000;
await store("fundDemo", "bigint:10000000000");
await store("fundDemo", "bigint:2345500000");
await store("fundDemo", "bigint:134250000");
const tx = (id, dir, amount, ago, extra = {}) => ({
  id,
  direction: dir,
  toBase58: "",
  amountMicro: String(amount),
  feeMicro: dir === "out" ? "710" : "0",
  changeMicro: null,
  status: "mined",
  createdAt: now - ago,
  json: "{}",
  ...extra,
});
await store("addTx", tx("demo-1", "in", 10_000_000_000, 190 * min, { minedHeight: 913_902 }));
await store("addTx", tx("demo-2", "in", 2_500_000_000, 95 * min, { minedHeight: 913_950 }));
await store("addTx", tx("demo-3", "out", 100_000_000, 48 * min, { minedHeight: 914_016 }));
await store("addTx", tx("demo-4", "in", 134_250_000, 6 * min, { minedHeight: 914_331 }));
const parts = {
  claimPublicKeyHex: "00".repeat(32),
  commitmentHex: "00".repeat(32),
  ownershipNonceHex: "00".repeat(32),
  ownershipSignatureHex: "00".repeat(32),
  senderOffsetPublicKeyHex: "00".repeat(32),
  encryptedDataHex: "00",
  amountMicro: "0",
};
await store("addBurn", {
  id: "demo-burn-1",
  createdAt: now - 48 * min,
  amountMicro: "100000000",
  feeMicro: "710",
  status: "claimed",
  toOwnAccount: true,
  parts,
  historyId: "demo-3",
  minedHeight: 914_016,
  claimedMicro: "99986744",
});
await store("addBurn", {
  id: "demo-burn-2",
  createdAt: now - 2 * min,
  amountMicro: "250000000",
  feeMicro: "710",
  status: "broadcast",
  toOwnAccount: true,
  parts,
  historyId: "demo-4",
});

await shot("dashboard");

// Same wallet at phone size, for the hero's phone mockup.
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3 });
await sleep(1500);
await shot("dashboard-mobile");
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
await sleep(1500);

await clickButton("Burn to Ootle");
await shot("burn");

await clickButton("Ootle apps");
await shot("apps");

await clickButton("Settings");
await shot("pin-gate");

await page.evaluate((pin) => {
  const input = document.querySelector('input[type="password"]');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(input, pin);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}, DEMO_PIN);
await clickButton("Unlock settings");
await shot("settings");

await browser.close();
