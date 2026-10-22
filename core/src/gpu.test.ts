import { beforeEach, describe, expect, it } from "vitest";
import { gpuStatus, loadTool, unloadAll, unloadTool } from "./gpu.js";

describe("gpu manager", () => {
  beforeEach(() => unloadAll());

  it("loads within cap and reports usage", () => {
    expect(loadTool("turbo-tiny").ok).toBe(true);
    expect(loadTool("granite-docling").ok).toBe(true);
    const s = gpuStatus();
    expect(s.loaded).toEqual(expect.arrayContaining(["turbo-tiny", "granite-docling"]));
    expect(s.used_gb).toBeCloseTo(4.5);
  });

  it("rejects unknown tools", () => {
    expect(loadTool("nope").ok).toBe(false);
  });

  it("segment-tiny fits beside the assist lane", () => {
    expect(loadTool("turbo-tiny").ok).toBe(true);
    expect(loadTool("granite-docling").ok).toBe(true);
    expect(loadTool("segment-tiny").ok).toBe(true);
    expect(loadTool("yolo-live").ok).toBe(true);
    expect(gpuStatus().used_gb).toBeCloseTo(6);
    // Full turbo pipeline + unlimited stays exclusive.
    unloadAll();
    expect(loadTool("turbo-tiny").ok).toBe(true);
    expect(loadTool("unlimited-ocr").ok).toBe(false);
  });
  it("unlimited-ocr fits beside granite, not beside turbo", () => {
    expect(loadTool("granite-docling").ok).toBe(true);
    expect(loadTool("unlimited-ocr").ok).toBe(true);
    expect(gpuStatus().used_gb).toBeCloseTo(5.5);
    unloadAll();
    expect(loadTool("turbo-tiny").ok).toBe(true);
    const r = loadTool("unlimited-ocr");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Unload turbo-tiny first/);
  });

  it("unload frees budget", () => {
    loadTool("turbo-tiny");
    unloadTool("turbo-tiny");
    expect(gpuStatus().used_gb).toBe(0);
    expect(loadTool("granite-docling").ok).toBe(true);
  });
});
