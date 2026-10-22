# verify.py — CPU-only comparison of Unlimited-OCR markdown against the
# existing TurboOCR-stitched baseline in tmp/markdown/. Pure stdlib, no
# torch, no GPU. Run any time:
#   python3 verify.py <unlimited.md> <baseline.md> [--min-coverage 0.85]
# Exit 0 = PASS, 1 = FAIL. Self-test: python3 verify.py --selftest
import re
import sys

WORD_RE = re.compile(r"[a-z0-9]+(?:[./-][a-z0-9]+)*")


def words(text):
    return WORD_RE.findall(text.lower())


def metrics(text):
    lines = text.splitlines()
    return {
        "chars": len(text),
        "words": len(words(text)),
        "lines": len(lines),
        "headings": sum(1 for l in lines if l.startswith("#")),
        "table_rows": sum(1 for l in lines if "|" in l),
    }


def compare(candidate, baseline, min_coverage=0.85):
    cw, bw = set(words(candidate)), set(words(baseline))
    coverage = len(cw & bw) / max(len(bw), 1)
    cm, bm = metrics(candidate), metrics(baseline)
    checks = {
        "coverage": (coverage, coverage >= min_coverage),
        "length_ratio": (
            cm["chars"] / max(bm["chars"], 1),
            0.5 <= cm["chars"] / max(bm["chars"], 1) <= 2.0,
        ),
        "tables_kept": (
            cm["table_rows"] / max(bm["table_rows"], 1) if bm["table_rows"] else 1.0,
            True,  # informational only; tables vary by renderer
        ),
    }
    verdict = all(ok for _, ok in (checks["coverage"], checks["length_ratio"]))
    return {
        "candidate": cm, "baseline": bm,
        "coverage": round(coverage, 4),
        "checks": {k: {"value": round(v, 4), "ok": ok} for k, (v, ok) in checks.items()},
        "verdict": "PASS" if verdict else "FAIL",
    }


def _selftest():
    base = "# Agreement\n\nTransportation services for a fee of 100.00 USD.\n\n| a | b |\n| 1 | 2 |\n"
    good = "# Agreement\n\nTransportation services for a fee of 100.00 USD.\n\n| a | b |\n| 1 | 2 |\n| 3 | 4 |\n"
    bad = "# Other\n\nCompletely unrelated text about weather.\n"
    r1 = compare(good, base)
    assert r1["verdict"] == "PASS", r1
    assert r1["coverage"] >= 0.9, r1
    r2 = compare(bad, base)
    assert r2["verdict"] == "FAIL", r2
    assert r2["coverage"] < 0.5, r2
    print("verify.py self-test ok")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        _selftest()
    else:
        args = [a for a in sys.argv[1:] if not a.startswith("--")]
        if len(args) != 2:
            sys.exit("usage: verify.py <unlimited.md> <baseline.md> [--min-coverage 0.85]")
        mc = 0.85
        for a in sys.argv:
            if a.startswith("--min-coverage="):
                mc = float(a.split("=", 1)[1])
        cand = open(args[0], encoding="utf-8", errors="replace").read()
        base = open(args[1], encoding="utf-8", errors="replace").read()
        rep = compare(cand, base, mc)
        print(f"candidate: {rep['candidate']}")
        print(f"baseline:  {rep['baseline']}")
        print(f"coverage:  {rep['coverage']} checks: {rep['checks']}")
        print(rep["verdict"])
        sys.exit(0 if rep["verdict"] == "PASS" else 1)
