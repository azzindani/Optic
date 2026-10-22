// v1 tool registry. Only these two load; the rest are future stubs.
import type { ToolManifest } from "./types.js";

export const registry = new Map<string, ToolManifest>([
  [
    "turbo-tiny",
    {
      id: "turbo-tiny",
      version: "3.0",
      backend: "tensorrt",
      vram_gb: 4,
      tier: "tiny",
      description: "Fast lane markdown and boxes. Live plus batch.",
    },
  ],
  [
    "granite-docling",
    {
      id: "granite-docling",
      version: "258M",
      backend: "vllm",
      vram_gb: 0.5,
      tier: "tiny",
      description: "Targeted prompts, DocTags, tables. Pairs with turbo-tiny.",
    },
  ],
  [
    "unlimited-ocr",
    {
      id: "unlimited-ocr",
      version: "3B-MoE-AWQ",
      backend: "vllm",
      // Measured 2026-09-20: 2.66GB weights + KV at 8K ctx ≈ 4GB solo.
      // 32K context needs re-measurement on a free GPU.
      vram_gb: 5,
      tier: "small",
      description: "One-shot multi-page parsing to markdown. Batch-only, experimental. AWQ lane.",
    },
  ],
  [
    "segment-tiny",
    {
      id: "segment-tiny",
      version: "sam2.1-hiera-tiny",
      backend: "transformers",
      // PROVISIONAL: confirm via nvidia-smi (39M params, expect ~1GB).
      vram_gb: 1,
      tier: "tiny",
      description: "Live segmentation: box-prompted masks + auto-mask. Boxes for overlay.",
    },
  ],
  [
    "yolo-live",
    {
      id: "yolo-live",
      version: "yolo11n-seg",
      backend: "onnx",
      // PROVISIONAL: confirm via nvidia-smi (6MB weights, expect ~0.5GB).
      vram_gb: 0.5,
      tier: "tiny",
      description: "Live tier: COCO instance masks + track IDs. Fast lane; SAM2 refines.",
    },
  ],
]);
