# Live segmentation sidecar: SAM2-tiny over transformers + torch CUDA.
# Endpoints: GET /health, POST /infer ({image_b64, boxes_1000?} ->
# {boxes: [{x,y,w,h,kind,label,conf}]}). Two modes:
# - boxes_1000 given (0-1000, e.g. det boxes): box-prompted masks, ~1s.
# - omitted: auto-mask generation (~4s laptop, sparse on dense docs).
# Boxes are mask bboxes in SOURCE pixels; the UI scales to its canvas.
# Downscales to 640px longest side for latency; boxes mapped back.
import base64
import io
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import torch
from PIL import Image

MODEL_ID = os.environ.get("MODEL_ID", "facebook/sam2.1-hiera-tiny")
MAX_SIDE = int(os.environ.get("MAX_SIDE", "640"))
TOP_K = int(os.environ.get("TOP_K", "25"))

_device = "cuda" if torch.cuda.is_available() else "cpu"
_model = None
_processor = None
_gen = None
_lock = threading.RLock()  # reentrant: get_autogen nests get_stack


def get_stack():
    global _model, _processor
    with _lock:
        if _model is None:
            from transformers import Sam2Model, Sam2Processor

            _processor = Sam2Processor.from_pretrained(MODEL_ID)
            _model = Sam2Model.from_pretrained(MODEL_ID).to(_device).eval()
            print(f"segment ready device={_device}", flush=True)
        return _model, _processor


def get_autogen():
    # NOTE: built from MODEL_ID (not the shared instance): constructing the
    # pipeline around a live model instance hangs. Own copy shares the HF
    # cache, so no re-download. Proven 4s on laptop GPU.
    global _gen
    with _lock:
        if _gen is None:
            from transformers import pipeline

            get_stack()
            _gen = pipeline("mask-generation", model=MODEL_ID,
                            device=0 if _device == "cuda" else -1)
        return _gen


def run_infer(raw: bytes, boxes_1000=None):
    import time

    import numpy as np

    model, processor = get_stack()
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    W, H = img.size
    img.thumbnail((MAX_SIDE, MAX_SIDE))
    t0 = time.time()
    boxes = []
    with torch.no_grad():
        if boxes_1000:
            px = [[b[0] / 1000 * W, b[1] / 1000 * H,
                   b[2] / 1000 * W, b[3] / 1000 * H] for b in boxes_1000]
            inputs = processor(images=img, input_boxes=[px],
                               return_tensors="pt").to(_device)
            out = model(**inputs)
            masks = processor.post_process_masks(
                out.pred_masks.cpu(), inputs["original_sizes"].cpu(),
                binarize=True)[0][0]
            for mi in range(masks.shape[0]):
                m = masks[mi].numpy()
                if m.sum() == 0:
                    continue
                ys, xs = np.where(m > 0)
                # Map thumbnail coords back to source pixels.
                sx, sy = W / img.size[0], H / img.size[1]
                x0, y0 = int(xs.min() * sx), int(ys.min() * sy)
                x1, y1 = int(xs.max() * sx), int(ys.max() * sy)
                boxes.append({"x": x0, "y": y0, "w": x1 - x0, "h": y1 - y0,
                              "kind": "segment:mask", "label": "mask",
                              "conf": round(float(m.sum()) / m.size, 4)})
        else:
            gen = get_autogen()
            out = gen(img, points_per_batch=64)
            sx, sy = W / img.size[0], H / img.size[1]
            cands = []
            for t in out["masks"]:
                m = (t.detach().cpu().float().numpy() > 0.5)
                fg = int(m.sum())
                if fg < 100:
                    continue
                ys, xs = np.where(m)
                # Upscale thumbnail mask coords back to source pixels.
                th, tw = m.shape[-2], m.shape[-1]
                kx, ky = W / tw, H / th
                x0, y0 = int(xs.min() * kx), int(ys.min() * ky)
                x1, y1 = int(xs.max() * kx), int(ys.max() * ky)
                cands.append((fg, {"x": x0, "y": y0,
                                   "w": max(0, x1 - x0), "h": max(0, y1 - y0),
                                   "kind": "segment:mask", "label": "mask",
                                   # Fill ratio, NOT model confidence.
                                   "conf": round(fg / m.size, 4)}))
            cands.sort(reverse=True, key=lambda c: c[0])
            boxes = [c[1] for c in cands[:TOP_K]]
    dt = time.time() - t0
    print(f"infer {len(boxes)} boxes in {dt:.1f}s", flush=True)
    return {"boxes": boxes, "model": MODEL_ID.split("/")[-1],
            "latency_s": round(dt, 2)}


class Handler(BaseHTTPRequestHandler):
    server_version = "segment-sidecar/1"

    def log_message(self, *args):
        pass

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._json(200, {"ok": True, "device": _device,
                             "loaded": _model is not None})
        else:
            self._json(404, {"error": "unknown route"})

    def do_POST(self):
        if self.path != "/infer":
            self._json(404, {"error": "unknown route"})
            return
        try:
            length = int(self.headers.get("content-length") or 0)
            payload = json.loads(self.rfile.read(length).decode())
            b64 = payload.get("image_b64", "")
            if "," in b64:
                b64 = b64.split(",", 1)[1]
            self._json(200, run_infer(base64.b64decode(b64),
                                      payload.get("boxes_1000")))
        except Exception as e:
            self._json(500, {"error": str(e)[:300]})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8004"))
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"segment sidecar on 127.0.0.1:{port} device={_device}", flush=True)
    srv.serve_forever()
