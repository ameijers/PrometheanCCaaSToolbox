// Copyright (c) 2026 Alexander Meijers
// SPDX-License-Identifier: MIT

import * as fs from "fs";
import * as path from "path";
import { GROUPS, TOOLS, matches, webResourceName } from "../src/tools";

const root = path.resolve(__dirname, "../../..");
const config = JSON.parse(fs.readFileSync(path.join(root, "deploy.config.json"), "utf8"));

describe("Toolbox Home", () => {
  test("lists exactly the tools in deploy.config.json (besides itself)", () => {
    const deployed = Object.keys(config.tools).filter((k) => k !== "home").sort();
    expect(TOOLS.map((t) => t.key).sort()).toEqual(deployed);
  });

  test("every card opens a web resource that the deploy config publishes", () => {
    TOOLS.forEach((t) => {
      const names = config.tools[t.key].webResources.map((w: { name: string }) => w.name);
      expect(names).toContain(webResourceName(t.key));
    });
  });

  test("every tool is in a known group, and every group has tools", () => {
    const ids = GROUPS.map((g) => g.id);
    TOOLS.forEach((t) => expect(ids).toContain(t.group));
    GROUPS.forEach((g) => expect(TOOLS.some((t) => t.group === g.id)).toBe(true));
  });

  test("search matches name and description, case-insensitive", () => {
    const names = (q: string) => TOOLS.filter((t) => matches(t, q)).map((t) => t.name);
    expect(names("VOICEMAIL")).toEqual(["Voicemail Builder"]);
    expect(names("capacity profiles")).toEqual(["Capacity Profile Assignment", "User Setup"]);
    expect(names("  ")).toHaveLength(TOOLS.length);
  });

  test("the page never reads or writes Dataverse", () => {
    const dir = path.resolve(__dirname, "../src");
    fs.readdirSync(dir).forEach((f) => {
      const code = fs.readFileSync(path.join(dir, f), "utf8");
      expect(code).not.toMatch(/WebApi|fetch\(|readAll|createRecord|updateRecord|deleteRecord/);
    });
  });
});
