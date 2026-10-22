# Turbo-compatible OCR sidecar: POST /ocr/raw (raw image bytes),
# POST /infer (JSON image_b64), GET /health. Backed by RapidOCR on
# onnxruntime-gpu when CUDA is present, CPU otherwise. Response shape
# matches TurboOCR: { results: [{ text, confidence, bounding_box }] }.
import base64
import io
import json
import os
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
import onnxruntime as ort
from PIL import Image

PROVIDERS = ["CUDAExecutionProvider", "CPUExecutionProvider"]
AVAILABLE = ort.get_available_providers()

_engine = None
_engine_lock = threading.Lock()


def get_engine():
    global _engine
    with _engine_lock:
        if _engine is None:
            from rapidocr_onnxruntime import RapidOCR

            use_cuda = "CUDAExecutionProvider" in AVAILABLE
            try:
                # Newer builds accept execution providers explicitly.
                _engine = RapidOCR(providers=PROVIDERS) if use_cuda else RapidOCR()
            except TypeError:
                _engine = RapidOCR()
            print(f"engine ready cuda={use_cuda} available={AVAILABLE}", flush=True)
        return _engine


def ocr_bytes(raw: bytes):
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    arr = np.asarray(img)[:, :, ::-1]
    engine = get_engine()
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
        tmp = f.name
    try:
        Image.fromarray(arr[:, :, ::-1]).save(tmp)
        out, _ = engine(tmp)
    finally:
        os.unlink(tmp)
    results = []
    for item in out or []:
        box, text, conf = item[0], item[1], float(item[2])
        quad = [[float(p[0]), float(p[1])] for p in box]
        results.append({"text": text, "confidence": conf, "bounding_box": quad})
    return {"results": results}


class Handler(BaseHTTPRequestHandler):
    server_version = "sidecar/1"

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
            self._json(200, {"ok": True, "providers": AVAILABLE, "loaded": _engine is not None})
        else:
            self._json(404, {"error": "unknown route"})

    def do_POST(self):
        length = int(self.headers.get("content-length") or 0)
        raw = self.rfile.read(length)
        try:
            if self.path == "/ocr/raw":
                self._json(200, ocr_bytes(raw))
            elif self.path == "/infer":
                payload = json.loads(raw.decode())
                b64 = payload.get("image_b64", "")
                if "," in b64:
                    b64 = b64.split(",", 1)[1]
                self._json(200, ocr_bytes(base64.b64decode(b64)))
            else:
                self._json(404, {"error": "unknown route"})
        except Exception as e:  # never leak a stack to the gateway
            self._json(500, {"error": str(e)[:300]})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8001"))
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"sidecar on 127.0.0.1:{port} providers={AVAILABLE}", flush=True)
    srv.serve_forever()
