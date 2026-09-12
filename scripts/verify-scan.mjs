import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: true,
  args: [
    "--no-sandbox",
    "--enable-unsafe-swiftshader",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--window-size=1440,900",
  ],
  defaultViewport: { width: 1440, height: 900 },
});

const page = await browser.newPage();
await page.goto("http://localhost:5199/", { waitUntil: "networkidle2", timeout: 30000 });
await new Promise((r) => setTimeout(r, 2500));

await page.evaluate(() => {
  [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Create new wallet"))?.click();
});
await new Promise((r) => setTimeout(r, 3000));
await page.evaluate(() => {
  [...document.querySelectorAll("button")].find((b) => b.title === "Settings")?.click();
});
await new Promise((r) => setTimeout(r, 1200));

await page.evaluate(() => {
  const inputs = [...document.querySelectorAll("input")];
  const from = inputs.find((i) => i.value && /^\d{6,}$/.test(i.value));
  if (from) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(from, "330676");
    from.dispatchEvent(new Event("input", { bubbles: true }));
  }
});
await page.evaluate(() => {
  const labels = [...document.querySelectorAll("label")];
  const toField = labels.find((l) => l.textContent?.includes("Scan to"));
  const input = toField?.querySelector("input");
  if (input) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, "330680");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
});
await page.evaluate(() => {
  [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Start scan"))?.click();
});
await new Promise((r) => setTimeout(r, 12000));

const result = await page.evaluate(() => {
  const text = document.body.innerText;
  const m = text.match(/blocks ([\d,]+) · outputs seen ([\d,]+) · (\d+) owned/);
  return {
    scanRan: !!m,
    blocks: m?.[1],
    outputsSeen: m?.[2],
    owned: m?.[3],
    utxoCards: (text.match(/UTXOs/g) || []).length,
  };
});
console.log("SCAN_RESULT:", JSON.stringify(result));
await page.screenshot({ path: "shots/05-scan.png" });

await browser.close();
