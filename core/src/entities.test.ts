import { describe, expect, it } from "vitest";
import { extractEntities, type Word } from "./entities.js";

const w = (text: string, x = 0): Word => ({ text, box: { x, y: 0, w: 10, h: 10 }, conf: 0.99 });

describe("entities", () => {
  it("grounds dates, amounts, ids and emails to word boxes", () => {
    const words = [
      w("Invoice", 0), w("UGS/2022-23/5087", 10), w("dated", 20), w("16-Mar-23", 30),
      w("Total", 40), w("26,942.85", 50), w("GSTIN", 60), w("07AAQPS8060E1ZB", 70),
      w("ushagas@yahoo.co.in", 80),
    ];
    const ents = extractEntities(words);
    const byKind = Object.fromEntries(ents.map((e) => [e.kind, e]));
    expect(byKind["entity:invoice_no"].text).toBe("UGS/2022-23/5087");
    expect(byKind["entity:date"].text).toBe("16-Mar-23");
    expect(byKind["entity:amount"].text).toBe("26,942.85");
    expect(byKind["entity:gstin"].text).toBe("07AAQPS8060E1ZB");
    expect(byKind["entity:email"].text).toBe("ushagas@yahoo.co.in");
    // Box union spans the matched words.
    expect(byKind["entity:amount"].box.x).toBe(50);
    expect(byKind["entity:gstin"].box.kind).toBe("entity:gstin");
    expect(byKind["entity:date"].conf).toBeCloseTo(0.99);
  });

  it("returns nothing on plain prose", () => {
    expect(extractEntities([w("hello"), w("world")])).toEqual([]);
  });
});
