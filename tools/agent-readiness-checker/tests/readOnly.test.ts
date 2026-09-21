import * as fs from "fs";
import * as path from "path";

// This tool's hard constraint is "never create, update, or delete any Dataverse record" — this test
// statically guards that by scanning every source file for the Xrm.WebApi write methods. It's a
// blunt instrument (a string match, not real static analysis), but that's the point: it fails loudly
// on the mere presence of the text "createRecord"/"updateRecord"/"deleteRecord" anywhere in src/,
// so a future change can't introduce a write call without this test catching it immediately.
const FORBIDDEN_METHODS = ["createRecord", "updateRecord", "deleteRecord", "executeMultiple", "execute("];

describe("read-only guarantee", () => {
  const srcDir = path.resolve(__dirname, "../src");
  const files = fs.readdirSync(srcDir).filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));

  test("scanned at least the expected source files (sanity check the scan itself isn't vacuous)", () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
    expect(files).toContain("dataverse.ts");
  });

  test.each(files)("%s contains no Xrm.WebApi write method calls", (file) => {
    const contents = fs.readFileSync(path.join(srcDir, file), "utf8");
    FORBIDDEN_METHODS.forEach((method) => {
      expect(contents.includes(method)).toBe(false);
    });
  });
});
