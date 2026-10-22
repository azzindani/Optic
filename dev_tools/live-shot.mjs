// live-shot.mjs: screenshot the multi-color live demo (table + boxes).
// Usage: node live-shot.mjs (gateway :3109, demo static :8099)
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto("http://127.0.0.1:8099/live-demo.html", { waitUntil: "networkidle" });
await page.waitForTimeout(12000);
await page.screenshot({ path: "/home/opencode/work/Optic/tmp/live-color.png" });
await browser.close();
console.log("SHOT-OK");
