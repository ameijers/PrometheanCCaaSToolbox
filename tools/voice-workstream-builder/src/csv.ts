// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

// A small RFC 4180 CSV reader/writer. The delimiter is detected from the header line, because Excel
// saves "CSV" with a semicolon in locales that use a decimal comma (Dutch, German, …) and a tab when
// saved as text.

export interface CsvRecord {
  line: number; // 1-based line number of the record in the file, for error messages
  cells: string[];
}

export interface ParsedCsv {
  delimiter: string;
  headers: string[];
  records: CsvRecord[];
}

const CANDIDATE_DELIMITERS = [",", ";", "\t"];

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  let best = ",";
  let bestCount = 0;
  CANDIDATE_DELIMITERS.forEach((delimiter) => {
    let count = 0;
    let quoted = false;
    for (const ch of firstLine) {
      if (ch === "\"") quoted = !quoted;
      else if (!quoted && ch === delimiter) count++;
    }
    if (count > bestCount) { best = delimiter; bestCount = count; }
  });
  return best;
}

export function parseCsv(input: string): ParsedCsv {
  const text = input.replace(/^﻿/, "");
  const delimiter = detectDelimiter(text);
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let recordLine = 1;

  const endRecord = () => {
    cells.push(cell);
    if (cells.some((c) => c.trim() !== "")) records.push({ line: recordLine, cells });
    cells = [];
    cell = "";
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === "\"") {
        if (text[i + 1] === "\"") { cell += "\""; i++; } else quoted = false;
      } else {
        if (ch === "\n") line++;
        cell += ch;
      }
      continue;
    }
    if (ch === "\"") quoted = true;
    else if (ch === delimiter) { cells.push(cell); cell = ""; }
    else if (ch === "\r") continue;
    else if (ch === "\n") { endRecord(); line++; recordLine = line; }
    else cell += ch;
  }
  if (cell !== "" || cells.length) endRecord();

  const [header, ...rest] = records;
  return { delimiter, headers: (header?.cells ?? []).map((h) => h.trim()), records: rest };
}

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, "\"\"")}"` : value;
}

export function toCsv(headers: string[], rows: string[][]): string {
  return [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
}

// Excel only reads a downloaded CSV as UTF-8 (names with accents, the en dash) when it starts with a BOM.
export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob(["﻿", content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
