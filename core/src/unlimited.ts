// Unlimited-OCR chat client (vLLM OpenAI shape). Mirrors
// tools/unlimited-ocr/strip.py: literal-space single prompt, multi prompt,
// n-gram vllm_xargs windows. Streaming mode accumulates delta.content and
// yields the full raw text per SSE chunk so callers can diff det boxes
// incrementally (see det.ts). repetition_penalty 1.15 is our measured
// anti-loop default (recipe n-gram processor alone looped on multi-page).
export interface ChatOpts {
  multi?: boolean;
  maxTokens?: number;
  repetitionPenalty?: number;
  stream?: boolean;
  /** Abort ms. Defaults: 2 min single, 10 min streaming (multi-page
   *  decodes run minutes). A hung sidecar must fail the job, not the route. */
  timeoutMs?: number;
}

function withTimeout(ms: number): { signal: AbortSignal; done: () => void } {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, done: () => clearTimeout(t) };
}

export function buildChatBody(images: string[], opts: ChatOpts = {}): Record<string, unknown> {
  const multi = opts.multi ?? images.length > 1;
  const prompt = multi ? "Multi page parsing." : " document parsing.";
  const content: unknown[] = [{ type: "text", text: "<image>" + prompt }];
  for (const b64 of images) {
    const url = b64.startsWith("data:") ? b64 : `data:image/png;base64,${b64}`;
    content.push({ type: "image_url", image_url: { url } });
  }
  return {
    model: "baidu/Unlimited-OCR",
    messages: [{ role: "user", content }],
    max_tokens: opts.maxTokens ?? (multi ? 13000 : 2048),
    temperature: 0.0,
    repetition_penalty: opts.repetitionPenalty ?? 1.15,
    skip_special_tokens: false,
    stream: opts.stream ?? false,
    extra_body: {
      vllm_xargs: { ngram_size: 35, window_size: multi ? 1024 : 128 },
    },
  };
}

export function unlimitedBase(): string | null {
  return process.env.UNLIMITED_URL ?? null;
}

/** POST a non-streaming completion, return the raw message content. */
export async function completeChat(base: string, images: string[], opts: ChatOpts = {}): Promise<string> {
  const { signal, done } = withTimeout(opts.timeoutMs ?? 120_000);
  try {
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildChatBody(images, { ...opts, stream: false })),
      signal,
    });
    if (!res.ok) throw new Error(`unlimited ${res.status}`);
    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }>;
    };
    const text = body.choices?.[0]?.message?.content;
    if (typeof text !== "string") throw new Error("unlimited: empty content");
    return text;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("unlimited: timed out waiting for sidecar");
    }
    throw err;
  } finally {
    done();
  }
}

/** POST a streaming completion. onRaw fires with the ACCUMULATED raw text
 *  after every SSE delta so callers can diff det boxes (det.ts). Resolves
 *  with the final raw text. */
export async function streamChat(
  base: string,
  images: string[],
  onRaw: (accumulated: string) => void,
  opts: ChatOpts = {},
): Promise<string> {
  const { signal, done } = withTimeout(opts.timeoutMs ?? 600_000);
  try {
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildChatBody(images, { ...opts, stream: true })),
      signal,
    });
    if (!res.ok || !res.body) throw new Error(`unlimited ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let acc = "";
    for (;;) {
      const { done: end, value } = await reader.read();
      if (end) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() ?? "";
      for (const part of parts) {
        for (const line of part.split("\n")) {
          const t = line.trim();
          if (!t.startsWith("data:")) continue;
          const payload = t.slice(5).trim();
          if (payload === "[DONE]") continue;
          try {
            const delta = (JSON.parse(payload) as {
              choices?: Array<{ delta?: { content?: unknown } }>;
            }).choices?.[0]?.delta?.content;
            if (typeof delta === "string" && delta) {
              acc += delta;
              onRaw(acc);
            }
          } catch { /* keep-alive/comment lines */ }
        }
      }
    }
    return acc;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("unlimited: timed out waiting for sidecar");
    }
    throw err;
  } finally {
    done();
  }
}
