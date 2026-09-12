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

await page.evaluate(() => {
  const labels = [...document.querySelectorAll("label")];
  const field = labels.find((l) => l.textContent?.includes("Threads"));
  if (!field) return console.log("NO THREADS FIELD");
  const btns = [...field.querySelectorAll("button")];
  btns.find((b) => b.textContent?.includes("Ludicrous"))?.click();
});
await new Promise((r) => setTimeout(r, 500));
const selected = await page.evaluate(() => {
  const labels = [...document.querySelectorAll("label")];
  const field = labels.find((l) => l.textContent?.includes("Threads"));
  return field ? [...field.querySelectorAll("button")].map((b) => ({ t: b.textContent, active: b.className.includes("btn-primary") })) : null;
});
console.log("THREADS_UI:", JSON.stringify(selected));

await page.evaluate(() => {
  [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Start scan"))?.click();
});
await new Promise((r) => setTimeout(r, 12000));
const scan = await page.evaluate(() => {
  const t = document.body.innerText;
  const m = t.match(/([\d,]+) \/ ([\d,]+)/);
  const seen = t.match(/outputs seen ([\d,]+)/);
  return { progress: m?.[1], total: m?.[2], outputsSeen: seen?.[1], done: t.includes("scan complete") };
});
console.log("SCAN_AT_24_THREADS:", JSON.stringify(scan));
await browser.close();
