// Typed gateway client. Same /v1 contract headless users get.
export interface ToolManifest {
  id: string; version: string; backend: string;
  vram_gb: number; tier: string; description: string;
}
export interface GpuStatus { total_gb: number; cap_gb: number; used_gb: number; loaded: string[] }
export interface Job {
  id: string; tool_id: string; mode: "batch" | "live"; status: string;
  input_refs: string[]; artifact_refs: string[]; error: string | null;
  created_at: string;
}
export interface Box {
  x: number; y: number; w: number; h: number;
  kind?: string; label?: string; conf?: number;
}
export interface EntityHit { kind: string; label: string; text: string; conf: number }
export interface DoctypeSchema { id: string; label: string }

// Box-kind palette shared by overlay, legend and entity chips.
export const PALETTE: Record<string, string> = {
  text: "#3fb950",
  "layout:table": "#58a6ff",
  "layout:figure": "#bc8cff",
  "layout:picture": "#bc8cff",
  "layout:title": "#d29922",
  "layout:header": "#d29922",
  "entity:date": "#39c5cf",
  "entity:amount": "#f0883e",
  "entity:invoice_no": "#e3b341",
  "entity:gstin": "#ff7b72",
  "entity:email": "#7ee787",
  "segment:mask": "#f778ba",
};
export const colorFor = (kind?: string): string => {
  if (!kind) return PALETTE.text;
  if (PALETTE[kind]) return PALETTE[kind];
  if (kind.startsWith("entity:")) return "#e3b341";
  if (kind.startsWith("layout:")) return "#58a6ff";
  if (kind.startsWith("det:")) return "#00d4ff";
  if (kind.startsWith("yolo:")) return "#ff9ff3";
  return PALETTE.text;
};

const j = async (r: Response) => {
  if (!r.ok) throw new Error((await r.json().catch(() => ({})) as { error?: string }).error ?? r.statusText);
  return r.json();
};

export const api = {
  tools: (): Promise<ToolManifest[]> => fetch("/v1/tools").then(j),
  gpu: (): Promise<GpuStatus> => fetch("/v1/gpu").then(j),
  loadTool: (id: string) => fetch(`/v1/tools/${id}/load`, { method: "POST" }).then(j),
  jobs: (): Promise<Job[]> => fetch("/v1/jobs").then(j),
  createJob: (tool_id: string, mode: string, input_refs: string[]): Promise<Job> =>
    fetch("/v1/jobs", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ tool_id, mode, input_refs }),
    }).then(j),
  uploadPdf: (id: string, buf: ArrayBuffer) =>
    fetch(`/v1/jobs/${id}/pdf?entities=1&tables=1`, {
      method: "POST", headers: { "content-type": "application/pdf" }, body: buf,
    }).then(j),
  postPages: (id: string, pages: string[]) =>
    fetch(`/v1/jobs/${id}/pages`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ pages }),
    }).then(j),
  postFrame: (id: string, jpeg: string) =>
    fetch(`/v1/jobs/${id}/frames`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jpeg }),
    }).then(j),
  schemas: (): Promise<DoctypeSchema[]> => fetch("/v1/schemas").then(j),
  result: (id: string, schema?: string): Promise<unknown> =>
    fetch(`/v1/jobs/${id}/result${schema ? `?schema=${schema}` : ""}`).then(j),
  overrideField: (id: string, key: string, value: string) =>
    fetch(`/v1/jobs/${id}/fields`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, value }),
    }).then(j),
  inputUrl: (id: string) => `/v1/jobs/${id}/input`,
};
