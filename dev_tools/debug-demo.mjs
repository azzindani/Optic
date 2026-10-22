// Debug the demo page: console logs + overlay pixel probe + screenshot.
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("console", (m) => console.log("CONSOLE:", m.text()));
page.on("pageerror", (e) => console.log("PAGEERROR:", String(e).slice(0, 300)));
await page.goto("http://127.0.0.1:8099/live-demo.html", { waitUntil: "networkidle" });
await page.waitForTimeout(12000);
const probe = await page.evaluate(() => {
  const ov = document.getElementById("overlay");
  const md = document.getElementById("markdown");
  const c = document.createElement("canvas");
  c.width = 4; c.height = 4;
  // sample overlay pixels: draw overlay scaled into probe, count non-transparent
  const octx = ov.getContext("2d");
  const d = octx.getImageData(0, 0, ov.width, ov.height).data;
  let ink = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) ink++;
  return { ow: ov.width, oh: ov.height, ink, mdlen: md.textContent.length };
});
console.log("PROBE:", JSON.stringify(probe));
await page.screenshot({ path: "/home/opencode/work/Optic/tmp/debug-demo.png" });
await browser.close();
console.log("DBG-OK");
