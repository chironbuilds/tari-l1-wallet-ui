import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: true,
  args: ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
await page.goto("https://tari-l1-wallet-ui.vercel.app", { waitUntil: "networkidle2", timeout: 40000 });
await new Promise((r) => setTimeout(r, 3000));
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 3000));

await page.evaluate(() => {
  [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Create new wallet"))?.click();
});
await new Promise((r) => setTimeout(r, 3000));
await page.evaluate(() => {
  [...document.querySelectorAll("button")].find((b) => b.title === "Settings")?.click();
});
await new Promise((r) => setTimeout(r, 1500));

const t0 = Date.now();
await page.evaluate(() => {
  [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Start scan"))?.click();
});

let result = null;
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  result = await page.evaluate(() => {
    const t = document.body.innerText;
    const prog = t.match(/([\d,]+) \/ ([\d,]+)/);
    const seen = t.match(/outputs seen ([\d,]+)/);
    const found = t.match(/(\d+) owned/);
    return {
      state: t.includes("scan complete") ? "done" : t.includes("scanning…") ? "running" : "none",
      current: prog?.[1],
      to: prog?.[2],
      outputsSeen: seen?.[1],
      owned: found?.[1],
    };
  });
  if (result.state === "done" || result.state === "none") break;
}
const secs = Math.round((Date.now() - t0) / 1000);
console.log("SPEED_TEST:", JSON.stringify({ seconds: secs, ...result }));
await browser.close();
