import fs from "node:fs";
import puppeteer from "puppeteer-core";
import { importWalletSeed, encipherSeed } from "tari-cipherseed";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const APP_URL = process.env.APP_URL ?? "http://localhost:5175/probe.html";
const API_BASE = process.env.API_BASE ?? "http://127.0.0.1:18083/api";

const bytesToHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
let backupHex = null;
const seedFile = ["taritestseed.txt", "tari seed.txt"].find((f) => fs.existsSync(f));
if (seedFile) {
  const mnemonic = fs.readFileSync(seedFile, "utf8").trim();
  const seed = await importWalletSeed(mnemonic);
  backupHex = bytesToHex(await encipherSeed(seed));
  console.log(`[e2e] seed file "${seedFile}" — funded mode`);
} else {
  console.log("[e2e] no seed file — unfunded mode (fresh wallet, self-created UTXO)");
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 200)));

await page.goto(APP_URL, { waitUntil: "networkidle2", timeout: 60_000 });
await page.waitForFunction("window.__probeReady === true", { timeout: 30_000 });

async function attempt(label, corrupt) {
  // pick an UNSPENT owned output for the spend
  let spendCommitment;
  try {
    const owned = JSON.parse(fs.readFileSync("shots/owned-commitments.json", "utf8")).filter(
      (c) => typeof c.commitmentHex === "string",
    );
    const blocksBase = API_BASE.replace(/\/+$/, "").replace(/\/submit$/, "");
    const blocksRes = await fetch(`${blocksBase}/blocks?from=${process.env.BLOCK_FROM ?? 331220}&to=${process.env.BLOCK_FROM ?? 331220}`);
    const { blocks } = await blocksRes.json();
    const hashByCommitment = new Map();
    for (const b of blocks) {
      for (const o of b.outputs ?? []) {
        hashByCommitment.set(o.commitment_hex.toLowerCase(), o.hash_hex);
      }
    }
    for (const c of owned) {
      const hash = hashByCommitment.get(c.commitmentHex.toLowerCase());
      if (!hash) continue;
      const check = await fetch(`${blocksBase}/utxo?hash=${hash}`);
      const j = await check.json();
      if (j.unspent) {
        spendCommitment = c.commitmentHex;
        console.log(`[e2e] spending unspent output ${c.commitmentHex.slice(0, 12)}… (${c.valueMicro} µT)`);
        break;
      }
      console.log(`[e2e] skipping spent output ${c.commitmentHex.slice(0, 12)}…`);
    }
  } catch (e) {
    console.log("[e2e] unspent-check failed, using first owned:", e.message);
  }

  const r = await page.evaluate(
    async (opts) => await window.__probe.run(opts),
    {
      backupHex,
      apiBase: API_BASE,
      blockFrom: Number(process.env.BLOCK_FROM ?? 331220),
      blockTo: Number(process.env.BLOCK_FROM ?? 331220),
      amountMicro: process.env.AMOUNT_MICRO ?? "1000000",
      feePerGram: process.env.FEE_PER_GRAM ?? "50",
      corrupt,
      spendCommitment,
      proofHexFromFile: fs.existsSync("shots/proof.hex") ? fs.readFileSync("shots/proof.hex", "utf8").trim() : "",
    },
  );
  console.log(`--- ${label} ---`);
  console.log(JSON.stringify(r, null, 2));
  if (r.ownedCommitments) {
    fs.writeFileSync("shots/owned-commitments.json", JSON.stringify(r.ownedCommitments, null, 2));
  }
  return r;
}

await attempt("corrupted tx (expect rejection)", true);
await attempt("clean self-send (expect ACCEPTED)", false);

await browser.close();
