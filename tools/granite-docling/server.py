# Targeted extraction sidecar: Granite-Docling-258M VLM over vLLM-free
# transformers + torch CUDA. Endpoints: GET /health, POST /infer
# ({image_b64} -> {text, fields}). Fields v1 are rule-assisted over the
# VLM transcription and labeled as such; the VLM supplies layout-aware
# text, rules map it to the invoice schema.
import base64
import io
import json
import os
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import torch
from PIL import Image

MODEL_ID = os.environ.get("MODEL_ID", "ibm-granite/granite-docling-258M")

_device = "cuda" if torch.cuda.is_available() else "cpu"
_model = None
_processor = None
_lock = threading.Lock()


def get_stack():
    global _model, _processor
    with _lock:
        if _model is None:
            from transformers import AutoProcessor

            try:
                from transformers import AutoModelForVision2Seq as VLM
            except ImportError:
                from transformers import AutoModelForImageTextToText as VLM

            _processor = AutoProcessor.from_pretrained(MODEL_ID, trust_remote_code=True)
            # Official recipe: bfloat16 on CUDA (fp16/fp32 emit "!!!").
            # See model card Troubleshooting.
            _model = VLM.from_pretrained(
                MODEL_ID, trust_remote_code=True,
                dtype=torch.bfloat16 if _device == "cuda" else torch.float32,
            ).to(_device).eval()
            print(f"granite ready device={_device}", flush=True)
        return _model, _processor


FIELD_PATTERNS = {
    "invoice_no": r"(?:invoice\s*(?:no|number|#)?\s*[:\-]?\s*)([A-Z0-9][\w\-/]+)",
    "date": r"(\d{4}-\d{2}-\d{2})",
    "total": r"total\s*(?:due)?\s*[:\-]?\s*(?:USD\s*)?([\d,]+\.\d{2})",
    "hs_code": r"HS\s*code\s*[:\-]?\s*([\d.]+)",
}


def extract_fields(text):
    fields = {"_method": "rules-over-vlm-text v1"}
    for key, pat in FIELD_PATTERNS.items():
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            fields[key] = m.group(1)
    return fields


def run_infer(raw: bytes):
    import time

    model, processor = get_stack()
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    # Downscale: DocTags at 144 DPI needs no more than ~1000px.
    img.thumbnail((1024, 1024))
    messages = [{
        "role": "user",
        "content": [
            {"type": "image"},
            {"type": "text", "text": "Convert this page to docling."},
        ],
    }]
    prompt = processor.apply_chat_template(messages, add_generation_prompt=True)
    inputs = processor(text=[prompt], images=[img], return_tensors="pt").to(_device)
    budget = int(os.environ.get("MAX_TOKENS", "256"))
    t0 = time.time()
    with torch.no_grad():
        out = model.generate(**inputs, max_new_tokens=budget, use_cache=True)
    dt = time.time() - t0
    # Official recipe: strip the prompt, keep special tokens (DocTags).
    cut = inputs["input_ids"].shape[-1]
    text = processor.batch_decode(out[:, cut:], skip_special_tokens=False)[0].lstrip()
    print(f"infer {len(text)} chars in {dt:.1f}s", flush=True)
    return {"text": text, "fields": extract_fields(text)}


class Handler(BaseHTTPRequestHandler):
    server_version = "granite-sidecar/1"

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
            self._json(200, {"ok": True, "device": _device, "loaded": _model is not None})
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
    port = int(os.environ.get("PORT", "8002"))
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"granite sidecar on 127.0.0.1:{port} device={_device}", flush=True)
    srv.serve_forever()
