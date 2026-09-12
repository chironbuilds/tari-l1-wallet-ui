import fs from "node:fs";
import puppeteer from "puppeteer-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const APP_URL = process.env.APP_URL ?? "http://localhost:5175/probe.html";
const API_BASE = process.env.API_BASE ?? "http://127.0.0.1:18083/api";

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 200)));

await page.goto(APP_URL, { waitUntil: "networkidle2", timeout: 60_000 });
await page.waitForFunction("window.__probeReady === true", { timeout: 30_000 });

const r = await page.evaluate(
  async (opts) => await window.__probe.run(opts),
  {
    apiBase: API_BASE,
    amountMicro: process.env.AMOUNT_MICRO ?? "1000000",
    feePerGram: process.env.FEE_PER_GRAM ?? "5",
    corrupt: false,
    dumpJson: true,
  },
);
fs.writeFileSync("shots/sample-tx.json", JSON.stringify(r.txJson, null, 2));
console.log("saved shots/sample-tx.json");
console.log("submit response:", r.httpStatus, r.response.slice(0, 160));
await browser.close();
