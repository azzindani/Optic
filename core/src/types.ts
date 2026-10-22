// Shared domain types. No framework imports here.

export type JobStatus =
  | "queued"
  | "active"
  | "done"
  | "error"
  | "interrupted";

export type JobMode = "batch" | "live";

export interface Job {
  id: string;
  owner_id: string;
  tool_id: string;
  mode: JobMode;
  status: JobStatus;
  input_refs: string[];
  artifact_refs: string[];
  error: string | null;
  idempotency_key: string | null;
  options?: { tables?: boolean };
  created_at: string;
  updated_at: string;
}

export type JobEventType =
  | "status"
  | "page"
  | "box"
  | "markdown"
  | "fields"
  | "tables";

export interface JobEvent {
  seq: number;
  job_id: string;
  type: JobEventType;
  data: unknown;
  created_at: string;
}

export interface ToolManifest {
  id: string;
  version: string;
  backend: "tensorrt" | "vllm" | "onnx" | "transformers" | "sglang";
  vram_gb: number;
  tier: "tiny" | "small" | "medium" | "full";
  description: string;
}

// Box kinds drive multi-color overlays. `text` is plain OCR;
// `layout:<class>` are region detections (table, figure, title…);
// `entity:<name>` are recognized entities grounded to word boxes.
export type BoxKind = string;

export interface Box {
  x: number; y: number; w: number; h: number;
  kind?: BoxKind;
  label?: string;
  conf?: number;
}

export interface Entity {
  kind: string;
  label: string;
  text: string;
  conf: number;
  box: Box;
}

export interface GpuStatus {
  total_gb: number;
  cap_gb: number;
  used_gb: number;
  loaded: string[];
}
