// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { demoSource } from "../src/demoData";
import { buildDocument } from "../src/document";
import { fileName, workbook, workbookSheets } from "../src/excel";
import { Snapshot } from "../src/model";
import { takeSnapshot } from "../src/snapshot";
import { MAX_CELL, cellValue, columnName, crc32, sheetNames, workbookFiles, xmlText, zip } from "../src/xlsx";

// Reads a stored (uncompressed) zip back into its files, checking each entry's checksum.
function unzip(bytes: Uint8Array): Record<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files: Record<string, string> = {};
  const decoder = new TextDecoder();
  let at = 0;
  while (view.getUint32(at, true) === 0x04034b50) {
    expect(view.getUint16(at + 8, true)).toBe(0); // stored
    const crc = view.getUint32(at + 14, true);
    const size = view.getUint32(at + 18, true);
    const nameLength = view.getUint16(at + 26, true);
    const name = decoder.decode(bytes.subarray(at + 30, at + 30 + nameLength));
    const data = bytes.subarray(at + 30 + nameLength, at + 30 + nameLength + size);
    expect(crc32(data)).toBe(crc);
    files[name] = decoder.decode(data);
    at += 30 + nameLength + size;
  }
  expect(view.getUint32(bytes.length - 22, true)).toBe(0x06054b50);
  expect(view.getUint16(bytes.length - 22 + 10, true)).toBe(Object.keys(files).length);
  return files;
}

let snapshot: Snapshot;
beforeAll(async () => { snapshot = await takeSnapshot(demoSource); });

describe("xlsx writer", () => {
  test("checksum, column names, escaping and cell limits", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect([0, 25, 26, 51, 52, 701, 702].map(columnName)).toEqual(["A", "Z", "AA", "AZ", "BA", "ZZ", "AAA"]);
    expect(xmlText("a < b & \"c\"\u0001")).toBe("a &lt; b &amp; &quot;c&quot;");
    expect(cellValue("x".repeat(MAX_CELL + 10))).toHaveLength(MAX_CELL);
    expect(cellValue("x".repeat(MAX_CELL + 10))).toMatch(/cut off/);
  });

  test("sheet names are valid and unique", () => {
    expect(sheetNames(["Queues", "queues", "A very long name that goes on and on", "a/b:c*d?", ""])).toEqual(["Queues", "queues 2", "A very long name that goes on a", "a b c d", "Sheet"]);
  });

  test("a workbook is a valid zip with every part", () => {
    const files = unzip(zip(workbookFiles([{ name: "One", rows: [["a", "b"], ["1", ""]], headerRows: 1 }], { title: "T", creator: "C", created: "2026-11-25T10:00:00Z" })));
    expect(Object.keys(files)).toEqual(["[Content_Types].xml", "_rels/.rels", "docProps/core.xml", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml"]);
    expect(files["xl/worksheets/sheet1.xml"]).toContain("<c r=\"A1\" t=\"inlineStr\" s=\"1\"><is><t xml:space=\"preserve\">a</t></is></c>");
    expect(files["xl/worksheets/sheet1.xml"]).toContain("<pane ySplit=\"1\" topLeftCell=\"A2\"");
    expect(files["xl/worksheets/sheet1.xml"]).toContain("<autoFilter ref=\"A1:B2\"/>");
    // An empty cell isn't written.
    expect(files["xl/worksheets/sheet1.xml"]).not.toContain("r=\"B2\"");
  });
});

describe("the snapshot workbook", () => {
  test("About, overviews, one sheet per table and Columns", () => {
    const sheets = workbookSheets(snapshot, buildDocument(snapshot));
    expect(sheets.slice(0, 4).map((s) => s.name)).toEqual(["About", "Routing rules", "Queues", "Agents"]);
    expect(sheets[sheets.length - 1].name).toBe("Columns");
    expect(sheets).toHaveLength(4 + snapshot.tables.length + 1);
    const about = sheets[0].rows;
    expect(about[1]).toEqual(["Environment", "sample environment"]);
    expect(about).toContainEqual(["Workstreams", "Workstreams (msdyn_liveworkstream)", "Workstreams", "5", "Left out (secrets): msdyn_apikey, msdyn_secureapikey"]);
    expect(about).toContainEqual(["Channels and phone numbers", "Facebook pages (msdyn_ocfbpage)", "Facebook pages", "Not in this environment", "This table isn't in this environment."]);
    const routing = sheets[1].rows;
    expect(routing).toContainEqual(["Sales – Voice", "Queue identification: Route to queue", "Sales route", "1", "Dutch callers", "Yes", "Customer language is \"nl-NL\"", "Route to queue \"Sales – NL\""]);
    expect(routing).toContainEqual(expect.arrayContaining(["Sales – NL", "Skills first – Assignment: Assignment", "Exact skill match"]));
    const queues = sheets.find((s) => s.name === "Queues")!.rows;
    expect(queues).toContainEqual(["Sales – EN", "Voice", "Least active", "Office hours", "Sales – Voice", "Liam de Vries, Noah Smith", ""]);
    const workstreams = sheets.find((s) => s.name === "Workstreams")!.rows;
    expect(workstreams[0][0]).toBe("Name");
    expect(workstreams).toHaveLength(6);
  });

  test("the file holds no secret and opens as a workbook", () => {
    const files = unzip(workbook(snapshot, buildDocument(snapshot)));
    const all = Object.values(files).join("\n");
    expect(all).not.toContain("SAMPLE-SECRET-KEY");
    // The About sheet names the columns left out; no sheet has them as a column.
    const columnsSheet = Object.entries(files).filter(([name]) => name.startsWith("xl/worksheets/")).pop()![1];
    expect(columnsSheet).not.toMatch(/apikey/);
    expect(files["xl/workbook.xml"]).toContain("<sheet name=\"About\" sheetId=\"1\" r:id=\"rId1\"/>");
    expect(files["docProps/core.xml"]).toContain("<dc:creator>Sample user</dc:creator>");
  });

  test("file names", () => {
    expect(fileName({ ...snapshot, environment: "academyexperiment.crm.dynamics.com", takenAt: "2026-11-25T09:30:12.000Z" }, "xlsx")).toBe("contact-center-snapshot-academyexperiment-202611250930.xlsx");
  });
});
