import { describe, expect, it } from "vitest";
import { sidecarBase, sidecarHint } from "./worker.js";

describe("sidecar routing", () => {
  it("maps each lane to its own env with generic fallback", () => {
    process.env.TURBO_URL = "http://t:8000";
    process.env.UNLIMITED_URL = "http://u:8003";
    process.env.SEGMENT_URL = "http://s:8004";
    process.env.YOLO_URL = "http://y:8005";
    process.env.GENERIC_SIDECAR_URL = "http://g:8099";
    expect(sidecarBase("turbo-tiny")).toBe("http://t:8000");
    expect(sidecarBase("turbo-small")).toBe("http://t:8000");
    expect(sidecarBase("unlimited-ocr")).toBe("http://u:8003");
    expect(sidecarBase("segment-tiny")).toBe("http://s:8004");
    expect(sidecarBase("yolo-live")).toBe("http://y:8005");
    expect(sidecarBase("granite-docling")).toBe("http://g:8099");
    expect(sidecarHint("yolo-live")).toMatch("YOLO_URL");
    delete process.env.TURBO_URL;
    delete process.env.UNLIMITED_URL;
    delete process.env.SEGMENT_URL;
    delete process.env.YOLO_URL;
    delete process.env.GENERIC_SIDECAR_URL;
    expect(sidecarBase("yolo-live")).toBeNull();
  });
});
