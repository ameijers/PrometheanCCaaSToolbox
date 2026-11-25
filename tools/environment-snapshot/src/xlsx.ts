// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

// A small .xlsx writer: an Office Open XML workbook is a zip of XML files. Kept in the toolbox (no new
// library) and limited to what a snapshot needs: text cells, a bold header row, a muted second header
// row, frozen headers, a filter and column widths. Files are stored in the zip uncompressed, which
// every spreadsheet program reads.

export interface Sheet {
  name: string;
  // Rows of text. With `headerRows`, the first rows are headers.
  rows: string[][];
  headerRows?: number;
  // Column widths in characters; worked out from the content when left out.
  widths?: number[];
}

// Excel allows at most 32,767 characters in a cell.
export const MAX_CELL = 32767;
const TRUNCATED = " …(cut off: longer than Excel allows in one cell)";

const XML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" };

export function xmlText(value: string): string {
  // Characters XML 1.0 doesn't allow are dropped.
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "").replace(/[&<>"]/g, (c) => XML_ESCAPES[c]);
}

export function cellValue(value: string): string {
  return value.length > MAX_CELL ? value.slice(0, MAX_CELL - TRUNCATED.length) + TRUNCATED : value;
}

// A sheet name: at most 31 characters, none of []:*?/\, and unique in the workbook.
export function sheetNames(wanted: string[]): string[] {
  const used = new Set<string>();
  return wanted.map((name) => {
    const base = (name.replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim() || "Sheet").slice(0, 31);
    let candidate = base;
    for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = `${base.slice(0, 31 - String(n).length - 1)} ${n}`;
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

// "A", "B", ..., "Z", "AA", ...
export function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

function sheetXml(sheet: Sheet): string {
  const headerRows = sheet.headerRows ?? 0;
  const columns = Math.max(1, ...sheet.rows.map((r) => r.length));
  const widths = sheet.widths ?? Array.from({ length: columns }, (_, c) => Math.min(60, Math.max(8, ...sheet.rows.slice(0, 200).map((r) => Math.min(80, (r[c] ?? "").split("\n")[0].length + 2)))));
  const cols = `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>`;
  const rows = sheet.rows.map((row, r) => {
    const style = r === 0 && headerRows ? 1 : r < headerRows ? 2 : 0;
    const cells = row.map((value, c) => value === "" ? "" : `<c r="${columnName(c)}${r + 1}" t="inlineStr"${style ? ` s="${style}"` : ""}><is><t xml:space="preserve">${xmlText(cellValue(value))}</t></is></c>`).join("");
    return `<row r="${r + 1}">${cells}</row>`;
  }).join("");
  const frozen = headerRows ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRows}" topLeftCell="A${headerRows + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` : "";
  const filter = headerRows && sheet.rows.length > headerRows ? `<autoFilter ref="A${headerRows}:${columnName(columns - 1)}${sheet.rows.length}"/>` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${frozen}${cols}<sheetData>${rows}</sheetData>${filter}</worksheet>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3"><font><sz val="10"/><name val="Calibri"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><i/><sz val="9"/><color rgb="FF5B6B7A"/><name val="Calibri"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF16324F"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEEF2F6"/></patternFill></fill></fills>
<borders count="1"><border/></borders>
<cellStyleXfs count="1"><xf/></cellStyleXfs>
<cellXfs count="3"><xf fontId="0" applyAlignment="1"><alignment vertical="top"/></xf><xf fontId="1" fillId="2" applyFont="1" applyFill="1"/><xf fontId="2" fillId="3" applyFont="1" applyFill="1"/></cellXfs>
</styleSheet>`;

export function workbookFiles(sheets: Sheet[], properties: { title: string; creator: string; created: string }): { name: string; content: string }[] {
  const names = sheetNames(sheets.map((s) => s.name));
  const props = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlText(properties.title)}</dc:title><dc:creator>${xmlText(properties.creator)}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${properties.created}</dcterms:created></cp:coreProperties>`;
  return [
    { name: "[Content_Types].xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>` },
    { name: "_rels/.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>` },
    { name: "docProps/core.xml", content: props },
    { name: "xl/workbook.xml", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${xmlText(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", content: STYLES },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, content: sheetXml(s) }))
  ];
}

// --- zip (stored, no compression) ---

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function zip(files: { name: string; content: string }[], date = new Date()): Uint8Array {
  const encoder = new TextEncoder();
  const dosTime = ((date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)) & 0xffff;
  const dosDate = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.content);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true);
    local.setUint16(10, dosTime, true); local.setUint16(12, dosDate, true); local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true); local.setUint32(22, data.length, true); local.setUint16(26, name.length, true); local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, data);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true); entry.setUint16(4, 20, true); entry.setUint16(6, 20, true); entry.setUint16(8, 0x0800, true); entry.setUint16(10, 0, true);
    entry.setUint16(12, dosTime, true); entry.setUint16(14, dosDate, true); entry.setUint32(16, crc, true); entry.setUint32(20, data.length, true); entry.setUint32(24, data.length, true);
    entry.setUint16(28, name.length, true); entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const centralSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true); end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  all.forEach((p) => { out.set(p, at); at += p.length; });
  return out;
}

export function xlsx(sheets: Sheet[], properties: { title: string; creator: string; created: string }): Uint8Array {
  return zip(workbookFiles(sheets, properties));
}
