// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import { parseCsv, toCsv } from "../src/csv";

describe("parseCsv", () => {
  test("reads headers and records, with line numbers", () => {
    const csv = parseCsv("a,b\n1,2\n3,4\n");
    expect(csv.headers).toEqual(["a", "b"]);
    expect(csv.records).toEqual([{ line: 2, cells: ["1", "2"] }, { line: 3, cells: ["3", "4"] }]);
  });

  test("handles quotes, escaped quotes, delimiters and newlines inside quotes", () => {
    const csv = parseCsv("name,note\r\n\"Sales, NL\",\"said \"\"hi\"\"\nthen left\"\r\nnext,x");
    expect(csv.records[0].cells).toEqual(["Sales, NL", "said \"hi\"\nthen left"]);
    // The quoted newline moves the next record's line number on.
    expect(csv.records[1]).toEqual({ line: 4, cells: ["next", "x"] });
  });

  test("detects semicolon and tab delimiters, as saved by Excel in other locales", () => {
    expect(parseCsv("a;b\n1;2").records[0].cells).toEqual(["1", "2"]);
    expect(parseCsv("a\tb\n1\t2").records[0].cells).toEqual(["1", "2"]);
    expect(parseCsv("a;b\n\"1,5\";2").records[0].cells).toEqual(["1,5", "2"]);
  });

  test("strips a UTF-8 BOM and skips blank lines, including lines of empty cells", () => {
    const csv = parseCsv("﻿a,b\n\n1,2\n,\n");
    expect(csv.headers).toEqual(["a", "b"]);
    expect(csv.records).toHaveLength(1);
  });

  test("round-trips through toCsv", () => {
    const text = toCsv(["x", "y"], [["a,b", "c\"d"], ["", "e"]]);
    expect(parseCsv(text).records.map((r) => r.cells)).toEqual([["a,b", "c\"d"], ["", "e"]]);
  });
});
