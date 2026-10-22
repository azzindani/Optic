// Doctype schemas: required fields per use-case, mapped from entity
// kinds. Fields with no matching kind stay empty for the user to fill —
// flexibility over hallucination. ERP systems consume the result JSON.
export interface FieldSpec {
  key: string;
  label: string;
  entityKinds: string[];
  required: boolean;
  pick?: "first" | "max_conf" | "max_amount";
}

export interface DoctypeSchema {
  id: string;
  label: string;
  fields: FieldSpec[];
  tables: boolean;
}

export const SCHEMAS: DoctypeSchema[] = [
  {
    id: "invoice",
    label: "Invoice",
    tables: true,
    fields: [
      { key: "invoice_no", label: "Invoice no", entityKinds: ["entity:invoice_no"], required: true, pick: "first" },
      { key: "date", label: "Date", entityKinds: ["entity:date"], required: true, pick: "first" },
      { key: "total", label: "Total amount", entityKinds: ["entity:amount"], required: true, pick: "max_amount" },
      { key: "tax", label: "Tax", entityKinds: ["entity:amount"], required: false, pick: "first" },
      { key: "seller_gstin", label: "Seller GSTIN", entityKinds: ["entity:gstin"], required: false, pick: "first" },
      { key: "seller_email", label: "Seller email", entityKinds: ["entity:email"], required: false, pick: "first" },
    ],
  },
  {
    id: "registration",
    label: "Basic registration",
    tables: false,
    fields: [
      { key: "entity_name", label: "Entity name", entityKinds: [], required: true },
      { key: "address", label: "Address", entityKinds: [], required: true },
      { key: "phone", label: "Phone", entityKinds: [], required: false },
      { key: "bank_account", label: "Bank account", entityKinds: [], required: false },
      { key: "pic", label: "PIC", entityKinds: [], required: false },
      { key: "email", label: "Email", entityKinds: ["entity:email"], required: false, pick: "first" },
    ],
  },
];

export interface FlatEntity { kind: string; text: string; conf: number; page?: number }

function amountValue(text: string): number {
  return Number(text.replace(/[^\d.]/g, ""));
}

export function mapToSchema(
  schema: DoctypeSchema,
  entities: FlatEntity[],
): Record<string, { value: string; conf: number; page?: number } | null> {
  const out: Record<string, { value: string; conf: number; page?: number } | null> = {};
  for (const f of schema.fields) {
    const cands = entities.filter((e) => f.entityKinds.includes(e.kind));
    if (!cands.length) {
      out[f.key] = null;
      continue;
    }
    let best = cands[0];
    if (f.pick === "max_conf") best = cands.reduce((a, b) => (b.conf > a.conf ? b : a));
    if (f.pick === "max_amount") {
      best = cands.reduce((a, b) => (amountValue(b.text) > amountValue(a.text) ? b : a));
    }
    out[f.key] = { value: best.text, conf: best.conf, page: best.page };
  }
  return out;
}

export function missingRequired(
  schema: DoctypeSchema,
  mapped: Record<string, unknown>,
): string[] {
  return schema.fields.filter((f) => f.required && !mapped[f.key]).map((f) => f.key);
}
