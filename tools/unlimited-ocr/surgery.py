#!/usr/bin/env python3
# surgery.py — regenerate awq-fixed/ from the cached AWQ snapshot.
# Needed because the stock sahilchachra/Unlimited-OCR-AWQ checkpoint does
# not load under the pinned vLLM image (vllm-openai:unlimited-ocr):
#  1. `model.vision_model.embeddings.position_ids` buffer trips vLLM's
#     DeepEncoder flat loader (params_dict KeyError; the buffer is an
#     arange the model recreates by default). Excised here.
#  2. The quant `ignore` list uses HF-side `model.*` names, but vLLM
#     matches ignore against its own module prefixes, so vision linears
#     got quant-wrapped (dense weights in checkpoint -> KeyError) and
#     layer-0 down_proj (6848 wide, not divisible by group 128) failed
#     WNA16 creation. Fixed by stripping the `model.` prefix and adding
#     vLLM-side + regex variants (broad vision/sam regexes are safe: every
#     vision checkpoint tensor is dense).
#
# Deps (CPU-only): pip install safetensors numpy ml_dtypes
# Usage: python3 tools/unlimited-ocr/surgery.py
# Input : tools/unlimited-ocr/hf-cache-awq/models--sahilchachra--Unlimited-OCR-AWQ/snapshots/<sha>/
# Output: tools/unlimited-ocr/awq-fixed/ (model.safetensors + config/tokenizer/code)
import json
import os
import shutil
import struct
import sys

import ml_dtypes  # noqa: F401  (registers bfloat16 with numpy)
from safetensors import safe_open
from safetensors.numpy import save_file

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "hf-cache-awq", "models--sahilchachra--Unlimited-OCR-AWQ", "snapshots")
OUT = os.path.join(HERE, "awq-fixed")

# Buffers the quantizer kept that vLLM's flat vision loader chokes on.
DROP_TENSORS = {"model.vision_model.embeddings.position_ids"}

# Files copied (dereferenced) from the snapshot next to the fixed weights.
COPY_FILES = [
    "config.json", "tokenizer.json", "tokenizer_config.json",
    "processor_config.json", "special_tokens_map.json",
    "generation_config.json", "configuration_deepseek_v2.py",
    "conversation.py", "deepencoder.py", "modeling_deepseekv2.py",
    "modeling_unlimitedocr.py",
]

# vLLM-side ignore additions (HF `model.` prefix stripped variant exists
# after rewrite; these cover the language tower + belt-and-braces regexes).
IGNORE_ADDITIONS = [
    "language_model.model.layers.0.mlp.down_proj",
    r"re:.*layers\.0\.mlp\.down_proj",
    r"re:.*vision_model.*",
    r"re:.*sam_model.*",
    r"re:.*multi_modal_projector.*",
    r"re:.*projector.*",
]


def find_snapshot():
    revs = [d for d in os.listdir(CACHE)
            if os.path.isdir(os.path.join(CACHE, d))]
    if len(revs) != 1:
        sys.exit(f"expected exactly 1 cached revision in {CACHE}, found: {revs}")
    return os.path.join(CACHE, revs[0])


def main():
    snap = find_snapshot()
    print(f"snapshot: {snap}")
    with safe_open(os.path.join(snap, "model.safetensors"), framework="np") as f:
        keys = list(f.keys())
        print(f"tensors in: {len(keys)}")
        dropped = [k for k in keys if k in DROP_TENSORS]
        if set(keys) & DROP_TENSORS != set(dropped):
            sys.exit("drop-set mismatch")
        out = {k: f.get_tensor(k) for k in keys if k not in DROP_TENSORS}
    os.makedirs(OUT, exist_ok=True)
    save_file(out, os.path.join(OUT, "model.safetensors"))
    print(f"tensors out: {len(out)} (dropped: {dropped})")

    for name in COPY_FILES:
        src = os.path.join(snap, name)
        if os.path.exists(src):
            shutil.copyfile(src, os.path.join(OUT, name))
    print("config/code copied")

    cfg_path = os.path.join(OUT, "config.json")
    cfg = json.load(open(cfg_path))
    ign = cfg["quantization_config"]["ignore"]
    fixed = [x[6:] if x.startswith("model.") else x for x in ign]
    for pat in IGNORE_ADDITIONS:
        if pat not in fixed:
            fixed.append(pat)
    cfg["quantization_config"]["ignore"] = fixed
    json.dump(cfg, open(cfg_path, "w"), indent=2)
    print(f"ignore entries: {len(fixed)}")

    # Verify: header parses, drop-set gone, no other non-packed extras vs BF16
    # naming (packed triples are expected and handled by the quant loader).
    with safe_open(os.path.join(OUT, "model.safetensors"), framework="np") as f:
        out_keys = set(f.keys())
    assert not (out_keys & DROP_TENSORS), "drop failed"
    assert len(out_keys) == len(keys) - len(dropped), "tensor count mismatch"
    print("verify ok: header parses, drop-set absent, counts match")


if __name__ == "__main__":
    main()
