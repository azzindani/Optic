// Minimal HTML table -> rows parser for TurboOCR SLANet output.
// Machine-generated markup only (<table>/<tr>/<td>/<th>, entities).
export type TableData = { rows: string[][] };

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ").trim();
}

export function htmlTableToRows(html: string): TableData {
  const rows: string[][] = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let tr: RegExpExecArray | null;
  while ((tr = trRe.exec(html))) {
    const cells: string[] = [];
    const tdRe = /<(td|th)[^>]*>([\s\S]*?)<\/\1>/gi;
    let td: RegExpExecArray | null;
    while ((td = tdRe.exec(tr[1]))) cells.push(decodeEntities(td[2]));
    if (cells.length) rows.push(cells);
  }
  return { rows };
}
