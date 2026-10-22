// color-check.mjs: feed a real invoice frame through the gateway, open the
// job in the React UI, screenshot legend + entity chips + text.
// The overlay canvas path was proven separately (tmp/debug-demo.png).
// Usage: node color-check.mjs [gateway] [frame-png]
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";

const GW = process.argv[2] ?? "http://127.0.0.1:3110";
const FRAME = process.argv[3] ?? "/tmp/ocr-test.png";

await fetch(`${GW}/v1/tools/turbo-tiny/load`, { method: "POST" });
const job = await (await fetch(`${GW}/v1/jobs`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ tool_id: "turbo-tiny", mode: "live" }),
})).json();
const jpeg = "data:image/png;base64," + (await readFile(FRAME)).toString("base64");
await fetch(`${GW}/v1/jobs/${job.id}/frames`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ jpeg }),
});

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(`${GW}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
const ok = await page.evaluate(async (jid) => {
  const rows = [...document.querySelectorAll(".job")];
  const row = rows.find((r) => r.textContent.includes(jid.slice(0, 8)));
  if (!row) return false;
  row.click();
  return true;
}, job.id);
if (!ok) throw new Error("job row missing");
await page.waitForTimeout(9000);
await page.screenshot({ path: "/home/opencode/work/Optic/tmp/ui-color.png" });
await browser.close();
console.log("COLOR-OK");
