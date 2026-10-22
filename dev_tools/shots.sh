#!/bin/bash
# shots.sh: render p1 + overlay TurboOCR boxes -> Optic/tmp/shots/.
# Usage: shots.sh <turbo-base> (expects /tmp/sweep TSV already run OR runs OCR per file)
BASE=${1:-http://localhost:8000}
OUT=/home/opencode/work/Optic/tmp/shots
mkdir -p "$OUT"
/tmp/visvenv/bin/python - "$BASE" "$OUT" <<'EOF'
import json, subprocess, sys
import fitz
from PIL import Image, ImageDraw
import os

base, out = sys.argv[1], sys.argv[2]
root = "/home/opencode/work/Optic/samples"
files = sorted(f for f in os.listdir(root) if f.endswith(".pdf") and "Zone.Identifier" not in f)
for name in files:
    path = os.path.join(root, name)
    try:
        doc = fitz.open(path)
        if len(doc) == 0:
            continue
        pix = doc[0].get_pixmap(dpi=100)
        png = "/tmp/shot-page.png"
        pix.save(png)
        r = subprocess.run(
            ["curl", "-s", "--max-time", "300", "-X", "POST", base + "/ocr/raw",
             "--data-binary", "@" + png, "-H", "Content-Type: image/png",
             "-o", "/tmp/shot-res.json"],
            capture_output=True)
        d = json.load(open("/tmp/shot-res.json"))
        img = Image.open(png).convert("RGB")
        dr = ImageDraw.Draw(img)
        n = 0
        for res in d.get("results", []):
            bb = res["bounding_box"]
            xs = [p[0] for p in bb]; ys = [p[1] for p in bb]
            dr.rectangle([min(xs), min(ys), max(xs), max(ys)], outline="red", width=2)
            n += 1
        img.save(os.path.join(out, name + ".p1.png"))
        print(f"{name}: boxes={n}", flush=True)
    except Exception as e:
        print(f"{name}: ERROR {str(e)[:120]}", flush=True)
print("SHOTS-DONE")
EOF
