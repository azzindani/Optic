import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildChatBody, completeChat, streamChat } from "./unlimited.js";
import { diffBoxes } from "./det.js";

describe("buildChatBody", () => {
  it("single uses literal-space prompt + window 128", () => {
    const b = buildChatBody(["AAA"]) as { messages: Array<{ content: Array<{ text: string }> }>; extra_body: { vllm_xargs: Record<string, number> } };
    expect(b.messages[0].content[0].text).toBe("<image> document parsing.");
    expect(b.extra_body.vllm_xargs).toEqual({ ngram_size: 35, window_size: 128 });
  });

  it("multi uses window 1024 + repetition penalty default", () => {
    const b = buildChatBody(["A", "B"], { multi: true }) as {
      messages: Array<{ content: Array<{ text: string }> }>;
      extra_body: { vllm_xargs: Record<string, number> };
      repetition_penalty: number;
    };
    expect(b.messages[0].content[0].text).toBe("<image>Multi page parsing.");
    expect(b.extra_body.vllm_xargs.window_size).toBe(1024);
    expect(b.repetition_penalty).toBe(1.15);
  });
});

// Canned vLLM SSE server: splits a det tag across chunks to prove the
// incremental diff path only fires on CLOSED tags.
function startMock(chunks: string[]): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        const streaming = (JSON.parse(body) as { stream?: boolean }).stream === true;
        if (!streaming) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ choices: [{ message: { content: chunks.join("") }, finish_reason: "stop" }] }));
          return;
        }
        res.writeHead(200, { "content-type": "text/event-stream", connection: "keep-alive" });
        (async () => {
          for (const c of chunks) {
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`);
          }
          res.write("data: [DONE]\n\n");
          res.end();
        })();
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const a = server.address();
      const port = typeof a === "object" && a ? a.port : 0;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

describe("timeouts", () => {
  let server: Server | undefined;
  let url = "";
  beforeEach(async () => {
    server = createServer(() => { /* never responds: hangs */ });
    await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
    const a = server.address();
    url = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
  });
  afterEach(() => { server?.close(); });

  it("completeChat aborts a hung sidecar", async () => {
    await expect(completeChat(url, ["AAA"], { timeoutMs: 200 }))
      .rejects.toThrow("timed out");
  }, 10_000);

  it("streamChat aborts a hung sidecar", async () => {
    await expect(streamChat(url, ["AAA"], () => {}, { timeoutMs: 200 }))
      .rejects.toThrow("timed out");
  }, 10_000);
});

describe("streamChat", () => {
  let server: Server | undefined;
  let url = "";
  beforeEach(async () => {
    const s = await startMock(["<|det|>title [1", "00, 200, 300, 220]<|/det|>Hi", " there"]);
    server = s.server;
    url = s.url;
  });
  afterEach(() => { server?.close(); });

  it("assembles chunks; boxes fire only on closed tags", async () => {
    const seen: string[] = [];
    let boxTotal = 0;
    let boxKinds: string[] = [];
    const final = await streamChat(url, ["AAA"], (acc) => {
      seen.push(acc);
      const d = diffBoxes(boxTotal, acc);
      boxTotal = d.total;
      boxKinds = [...boxKinds, ...d.boxes.map((b) => b.kind ?? "")];
    });
    expect(final).toBe("<|det|>title [100, 200, 300, 220]<|/det|>Hi there");
    expect(boxKinds).toEqual(["det:title"]);
    expect(seen.length).toBeGreaterThanOrEqual(3);
  });

  it("completeChat returns full content non-streaming", async () => {
    const text = await completeChat(url, ["AAA"]);
    expect(text).toContain("Hi there");
  });
});
