// Det parser: turns Unlimited-OCR grounding tokens into overlay boxes.
// Raw stream carries `<|det|>kind [x1, y1, x2, y2]<|/det|>text` (ours) or
// `<det>kind [x1, y1, x2, y2]</det>` (demo/recipe). Coords are 0-1000
// normalized; the UI scales them to the rendered page. Only CLOSED tags
// match, so re-parsing an accumulated stream and diffing by count yields
// exactly the newly completed boxes — the reading-order cursor.
import type { Box } from "./types.js";

const DET_RE = /<\|?det\|?>\s*([a-zA-Z_]+)\s*\[(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\]\s*<\|?\/det\|?>/g;
const REF_RE = /<\|ref\|>(.*?)<\|<\/ref\|>/gs;

export interface DetBox extends Box {
  kind: string; // det:<kind> e.g. det:text, det:title, det:table
}

export function parseDet(raw: string): { boxes: DetBox[]; markdown: string } {
  const boxes: DetBox[] = [];
  let m: RegExpExecArray | null;
  DET_RE.lastIndex = 0;
  while ((m = DET_RE.exec(raw)) !== null) {
    const [, kind, x1, y1, x2, y2] = m;
    const x = Number(x1);
    const y = Number(y1);
    boxes.push({
      x, y,
      w: Math.max(0, Number(x2) - x),
      h: Math.max(0, Number(y2) - y),
      kind: `det:${kind.toLowerCase()}`,
      label: kind.toLowerCase(),
    });
  }
  DET_RE.lastIndex = 0;
  const markdown = (
    raw.replace(DET_RE, "").replace(REF_RE, "$1")
  ).trim() + "\n";
  return { boxes, markdown };
}

/** Boxes completed since the previous accumulation. Call with the full
 *  accumulated text each stream chunk; returns only the new tail. */
export function diffBoxes(prevCount: number, raw: string): { boxes: DetBox[]; total: number } {
  const { boxes } = parseDet(raw);
  return { boxes: boxes.slice(prevCount), total: boxes.length };
}
