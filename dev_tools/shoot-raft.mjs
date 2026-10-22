// shoot-raft.mjs: loop all raft routes, screenshot each to Optic/tmp/ui-raft-<route>.png
// Usage: node shoot-raft.mjs [baseUrl]
import { chromium } from "playwright";

const base = process.argv[2] || "http://127.0.0.1:3000/";
const routes = ["review", "jobs", "graph"];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

for (const r of routes) {
  await page.click(`.appnav button:has-text("${r}")`);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `/home/opencode/work/Optic/tmp/ui-app-${r}.png` });
  console.log(`SHOT-OK ${r}`);
}
await browser.close();
console.log("ALL-DONE");
