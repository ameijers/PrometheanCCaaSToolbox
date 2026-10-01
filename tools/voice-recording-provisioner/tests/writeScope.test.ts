import * as fs from "fs";
import * as path from "path";
import { RECORDING_COLUMNS } from "../../voice-workstream-builder/src/recordingSettings";

// The provisioner may only update, only from dataverse.ts, only msdyn_ocvoicechannelsetting, and only
// the recording/transcription columns. It never creates or deletes.

const srcDir = path.resolve(__dirname, "../src");
const files = fs.readdirSync(srcDir).filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
const read = (f: string) => fs.readFileSync(path.join(srcDir, f), "utf8");

describe("write scope", () => {
  test("the scan isn't vacuous", () => {
    expect(files).toEqual(expect.arrayContaining(["dataverse.ts", "apply.ts", "change.ts", "App.tsx"]));
  });

  test.each(files)("%s never creates or deletes, and doesn't use fetch", (file) => {
    const contents = read(file);
    ["createRecord", "deleteRecord", "executeMultiple", "execute(", "fetch("].forEach((token) => expect(contents.includes(token)).toBe(false));
  });

  test("updateRecord is only called from dataverse.ts, and only on the voice channel table", () => {
    expect(files.filter((f) => read(f).includes("updateRecord"))).toEqual(["dataverse.ts"]);
    const calls = [...read("dataverse.ts").matchAll(/updateRecord\(([^,]+),/g)].map((m) => m[1].trim());
    expect(calls).toEqual(["CHANNEL_TABLE"]);
    expect(read("dataverse.ts")).toMatch(/const CHANNEL_TABLE = "msdyn_ocvoicechannelsetting";/);
  });

  test("the writable columns are exactly the recording and transcription settings", () => {
    expect([...RECORDING_COLUMNS].sort()).toEqual([
      "msdyn_agentrecordingcontrolsenabled", "msdyn_agenttranscriptioncontrolsenabled", "msdyn_enablestoprecordingtranscriptiononhold",
      "msdyn_playrecordingtranscriptionnotifications", "msdyn_recordingenabled", "msdyn_recordingmode", "msdyn_requestuserconsentforrecording",
      "msdyn_transcriptionenabled", "msdyn_transcriptionmode", "msdyn_transcriptionshowbydefault"
    ]);
  });
});
