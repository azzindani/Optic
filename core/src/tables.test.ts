import { describe, expect, it } from "vitest";
import { htmlTableToRows } from "./tables.js";

describe("tables", () => {
  it("parses cells, strips tags, decodes entities", () => {
    const { rows } = htmlTableToRows(
      `<table><tbody><tr><td colspan="2">A &amp; B</td><td>C<br/>D</td></tr>` +
      `<tr><th>H1</th><td>  spaced   out </td></tr></tbody></table>`,
    );
    expect(rows).toEqual([["A & B", "C D"], ["H1", "spaced out"]]);
  });

  it("returns no rows for empty input", () => {
    expect(htmlTableToRows("").rows).toEqual([]);
  });
});
