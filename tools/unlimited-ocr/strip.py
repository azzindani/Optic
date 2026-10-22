# Unlimited-OCR request builder + output stripper. Pure python, no torch —
# safe to import/test on CPU. Mirrors the vLLM recipe:
# https://recipes.vllm.ai/baidu/Unlimited-OCR
#
# - Single image  -> gundam mode (fast crop path), window_size=128
# - Multi image   -> base mode (full fidelity),    window_size=1024
# - Prompt MUST begin with a literal space or the model returns "".
# - skip_special_tokens=False; grounding tokens stripped here.
import re

SINGLE_PROMPT = " document parsing."
MULTI_PROMPT = "Multi page parsing."

_REF_RE = re.compile(r"<\|ref\|>(.*?)<\|/ref\|>", re.DOTALL)
_DET_RE = re.compile(r"<\|det\|>.*?<\|/det\|>", re.DOTALL)


def build_body(image_urls, multi=False):
    """OpenAI-shape chat body for POST {UNLIMITED_URL}/v1/chat/completions."""
    prompt = MULTI_PROMPT if multi else SINGLE_PROMPT
    content = [{"type": "text", "text": "<image>" + prompt}]
    content += [
        {"type": "image_url", "image_url": {"url": u}} for u in image_urls
    ]
    return {
        "model": "baidu/Unlimited-OCR",
        "messages": [{"role": "user", "content": content}],
        "max_tokens": 8192,
        "temperature": 0.0,
        "skip_special_tokens": False,
        "stream": False,
        "extra_body": {
            "vllm_xargs": {
                "ngram_size": 35,
                "window_size": 1024 if multi else 128,
            }
        },
    }


def to_markdown(raw):
    """Unwrap <|ref|> text, drop <|det|> coordinate boxes -> clean markdown."""
    text = _DET_RE.sub("", raw)
    text = _REF_RE.sub(lambda m: m.group(1), text)
    return text.strip() + "\n"


if __name__ == "__main__":
    b1 = build_body(["http://x/1.png"])
    assert b1["messages"][0]["content"][0]["text"].startswith("<image> ")
    assert b1["extra_body"]["vllm_xargs"] == {"ngram_size": 35, "window_size": 128}
    b2 = build_body(["http://x/1.png", "http://x/2.png"], multi=True)
    assert b2["extra_body"]["vllm_xargs"]["window_size"] == 1024

    raw = "<|ref|>Hello **world**<|/ref|><|det|>[[12, 34]]<|/det|>\n<|ref|>Row 2<|/ref|>"
    assert to_markdown(raw) == "Hello **world**\nRow 2\n", repr(to_markdown(raw))
    print("strip.py self-test ok")
