# Live instance-segmentation sidecar: YOLO11n-seg over ultralytics.
# Endpoints: GET /health, POST /infer ({image_b64} ->
# {boxes: [{x,y,w,h,kind,label,conf}]}). Tracking IDs persist across
# frames within one process (model.track persist=True); label carries
# "class#id" so the UI overlay shows identity. kind is yolo:<class>.
# Boxes are source pixels; the UI scales to its canvas.
import base64
import io
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from PIL import Image

MODEL_ID = os.environ.get("MODEL_ID", "yolo11n-seg.pt")
CONF = float(os.environ.get("CONF", "0.25"))

_device = "cuda"
_model = None
_lock = threading.Lock()


def get_model():
    global _model
    with _lock:
        if _model is None:
            from ultralytics import YOLO

            _model = YOLO(MODEL_ID)
            print("yolo ready", flush=True)
        return _model


def run_infer(raw: bytes):
    import time

    model = get_model()
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    t0 = time.time()
    # persist=True keeps track IDs stable across frames (live tracking).
    res = model.track(list([img]), persist=True, conf=CONF, verbose=False)[0]
    dt = time.time() - t0
    boxes = []
    if res.boxes is not None:
        ids = res.boxes.id.int().tolist() if res.boxes.id is not None else [-1] * len(res.boxes)
        for i, b in enumerate(res.boxes.xyxy.tolist()):
            cls = model.names[int(res.boxes.cls[i])]
            tid = ids[i]
            x0, y0, x1, y1 = (int(v) for v in b)
            boxes.append({
                "x": x0, "y": y0, "w": max(0, x1 - x0), "h": max(0, y1 - y0),
                "kind": f"yolo:{cls}",
                "label": f"{cls}#{tid}" if tid >= 0 else cls,
                "conf": round(float(res.boxes.conf[i]), 3),
            })
    print(f"infer {len(boxes)} boxes in {dt:.2f}s", flush=True)
    return {"boxes": boxes, "model": MODEL_ID, "latency_s": round(dt, 3)}


class Handler(BaseHTTPRequestHandler):
    server_version = "yolo-sidecar/1"

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
            self._json(200, run_infer(base64.b64decode(b64)))
        except Exception as e:
            self._json(500, {"error": str(e)[:300]})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8005"))
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"yolo sidecar on 127.0.0.1:{port} device={_device}", flush=True)
    srv.serve_forever()
