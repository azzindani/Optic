import { describe, expect, it } from "vitest";
import { diffBoxes, parseDet } from "./det.js";

// Shapes copied from real unlimited-ocr outputs (contract p00) plus the
// recipe/demo `<det>` variant from the baidu Space frontend.
const RAW = `<|det|>header [845, 60, 919, 71]<|/det|>Exhibit 10.5
<|det|>title [360, 104, 639, 116]<|/det|>TRANSPORTATION SERVICES AGREEMENT
<|det|>text [79, 127, 904, 165]<|/det|>This Transportation Services Agreement
<det>table [137, 192, 860, 593]</det><table><tr><td>Model</td></tr></table>`;

describe("parseDet", () => {
  it("extracts boxes with det: kinds in 0-1000 space", () => {
    const { boxes, markdown } = parseDet(RAW);
    expect(boxes).toHaveLength(4);
    expect(boxes[0]).toMatchObject({ x: 845, y: 60, w: 74, h: 11, kind: "det:header", label: "header" });
    expect(boxes[2]).toMatchObject({ kind: "det:text" });
    expect(boxes[3]).toMatchObject({ kind: "det:table", x: 137, y: 192, w: 723, h: 401 });
    expect(markdown).toContain("TRANSPORTATION SERVICES AGREEMENT");
    expect(markdown).not.toContain("<|det|>");
    expect(markdown).not.toContain("</det>");
  });

  it("ignores unclosed trailing tags (streaming safety)", () => {
    const { boxes } = parseDet(RAW + "\n<|det|>text [10, 20, 30, 40]");
    expect(boxes).toHaveLength(4);
  });

  it("diffBoxes yields only newly closed boxes", () => {
    const cut = RAW.indexOf("<|det|>text [79");
    const first = diffBoxes(0, RAW.slice(0, cut));
    expect(first.boxes.map((b) => b.kind)).toEqual(["det:header", "det:title"]);
    const second = diffBoxes(first.total, RAW);
    expect(second.boxes.map((b) => b.kind)).toEqual(["det:text", "det:table"]);
    expect(second.total).toBe(4);
  });
});
