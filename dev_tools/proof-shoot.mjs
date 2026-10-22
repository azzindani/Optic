// proof-shoot.mjs: wrap screenshot set -> Optic/tmp/proof-2026-09-20/
// Usage: node proof-shoot.mjs [baseUrl]
import { chromium } from "playwright";

const base = process.argv[2] || "http://127.0.0.1:3000/";
const out = "/home/opencode/work/Optic/tmp/proof-2026-09-20/";
const routes = ["review", "jobs", "graph"];
const sizes = [
  ["desktop", 1600, 950],
  ["tablet", 820, 1100],
  ["phone", 390, 844],
];

const browser = await chromium.launch({
  executablePath: "/home/opencode/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell",
});
for (const [name, w, h] of sizes) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  for (const r of routes) {
    await page.click(`.appnav button:has-text("${r}")`);
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${out}${name}-${r}.png` });
    console.log(`SHOT-OK ${name}-${r}`);
  }
  await page.close();
}
await browser.close();
console.log("ALL-DONE");
