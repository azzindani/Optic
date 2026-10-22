import { describe, expect, it } from "vitest";
import { mapToSchema, missingRequired, SCHEMAS } from "./schemas.js";

const invoice = SCHEMAS.find((s) => s.id === "invoice")!;

describe("schemas", () => {
  it("maps entities to invoice fields, max amount wins total", () => {
    const mapped = mapToSchema(invoice, [
      { kind: "entity:invoice_no", text: "UGS/2022-23/5087", conf: 0.95 },
      { kind: "entity:date", text: "16-Mar-23", conf: 0.96 },
      { kind: "entity:amount", text: "1,392.00", conf: 0.9 },
      { kind: "entity:amount", text: "26,942.85", conf: 0.93 },
    ]);
    expect(mapped.invoice_no?.value).toBe("UGS/2022-23/5087");
    expect(mapped.total?.value).toBe("26,942.85");
    expect(mapped.tax?.value).toBe("1,392.00");
    expect(missingRequired(invoice, mapped)).toEqual([]);
  });

  it("flags missing required fields, leaves unmapped null", () => {
    const reg = SCHEMAS.find((s) => s.id === "registration")!;
    const mapped = mapToSchema(reg, []);
    expect(mapped.entity_name).toBeNull();
    expect(missingRequired(reg, mapped)).toContain("entity_name");
  });
});
