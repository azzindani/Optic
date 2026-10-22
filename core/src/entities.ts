// Pattern NER v1: entities grounded to OCR word boxes. Honest scope:
// deterministic patterns over words (no ML model). Each hit carries the
// union rect of its words so the UI can draw it in entity colors.
import type { Box, Entity } from "./types.js";

export interface Word {
  text: string;
  box: { x: number; y: number; w: number; h: number };
  conf: number;
}

interface Rule { name: string; label: string; re: RegExp }

const RULES: Rule[] = [
  { name: "date", label: "date", re: /\b\d{4}-\d{2}-\d{2}\b|\b\d{2}-[A-Za-z]{3}-\d{2,4}\b|\b\d{2}\.\d{2}\.\d{2,4}\b/g },
  { name: "amount", label: "amount", re: /\b\d{1,3}(?:[.,]\d{3})+[.,]\d{2}\b|\b\d+\.\d{2}\b/g },
  { name: "invoice_no", label: "invoice no", re: /\b(?:INV|UGS)[-/][\w/-]+\b|\b[A-Z]{2,4}\/\d{4}-\d{2}\/\d+\b/g },
  { name: "gstin", label: "GSTIN", re: /\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d][Zz][A-Z\d]\b/g },
  { name: "email", label: "email", re: /[\w.+-]+@[\w-]+\.[\w.]+\b/g },
];

function union(boxes: Array<Word["box"]>): Box {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return {
    x, y,
    w: Math.max(...boxes.map((b) => b.x + b.w)) - x,
    h: Math.max(...boxes.map((b) => b.y + b.h)) - y,
  };
}

export function extractEntities(words: Word[]): Entity[] {
  const text = words.map((w) => w.text).join(" ");
  // Char offset of each word start in the joined string.
  const starts: number[] = [];
  let pos = 0;
  for (const w of words) {
    starts.push(pos);
    pos += w.text.length + 1;
  }
  const wordAt = (off: number): number => {
    let lo = 0;
    for (let i = 0; i < starts.length; i++) if (starts[i] <= off) lo = i;
    return lo;
  };
  const out: Entity[] = [];
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    let guard = 0;
    while ((m = rule.re.exec(text)) && guard++ < 500) {
      const a = wordAt(m.index);
      const b = wordAt(m.index + m[0].length - 1);
      const span = words.slice(a, b + 1);
      const box = union(span.map((w) => w.box));
      out.push({
        kind: `entity:${rule.name}`,
        label: rule.label,
        text: m[0],
        conf: Math.min(...span.map((w) => w.conf)),
        box: { ...box, kind: `entity:${rule.name}`, label: `${rule.label}: ${m[0]}`, conf: Math.min(...span.map((w) => w.conf)) },
      });
    }
  }
  return out;
}
