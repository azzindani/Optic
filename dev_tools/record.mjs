// Record 30 s of live extraction: serves live-demo.html, drives Chromium
// with video capture, saves to Optic/tmp/live-30s.webm.
// Usage: node record.mjs (gateway on :3109, demo static on :8099)
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

const ROOT = new URL(".", import.meta.url).pathname;
const MIME = { ".html": "text/html", ".png": "image/png" };
const server = createServer(async (req, res) => {
  const path = req.url === "/" ? "/live-demo.html" : req.url;
  try {
    const file = path === "/live-demo.html"
      ? ROOT + "/live-demo.html"
      : "/home/opencode/work/Optic/tmp" + path;
    const body = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404); res.end("nope");
  }
});
await new Promise((r) => server.listen(8099, r));

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: "/home/opencode/work/Optic/tmp", size: { width: 1280, height: 800 } },
});
const page = await ctx.newPage();
await page.goto("http://127.0.0.1:8099/", { waitUntil: "networkidle" });
await page.waitForTimeout(30000);
const video = await page.video().path();
await ctx.close();
await browser.close();
server.close();
import { rename } from "node:fs/promises";
await rename(video, "/home/opencode/work/Optic/tmp/live-30s.webm");
console.log("VIDEO-OK /home/opencode/work/Optic/tmp/live-30s.webm");
