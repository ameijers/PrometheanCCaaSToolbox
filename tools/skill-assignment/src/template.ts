import { ColumnDef, emptyCsvFrom, exampleCsvFrom } from "../../shared/src/columns";

// One row per user. Drives the example file, validation and the in-app column reference.
export const COLUMNS: ColumnDef[] = [
  { header: "user", required: true, description: "Sign-in name or email of the user. The user must already be a bookable resource (set up with User Setup)." },
  { header: "skills", required: true, list: true, description: "Skills to assign, by name, each with an optional rating after a colon: Skill:Rating, e.g. English:Good|Billing:4|HITL. The rating is a name (e.g. Good) or number (e.g. 3) from your rating model. Without a rating, a new skill gets no rating and an existing skill keeps its rating." }
];

const EXAMPLE_ROWS: Record<string, string>[] = [
  { user: "anna@contoso.com", skills: "English:Excellent|Dutch:Very Good|Billing:3" },
  { user: "bram@contoso.com", skills: "English:Good|Technical support" },
  { user: "dana.smit@contoso.com", skills: "English:5|Billing:Very Good" }
];

export const EXAMPLE_FILE_NAME = "skills-example.csv";
export const exampleCsv = (): string => exampleCsvFrom(COLUMNS, EXAMPLE_ROWS);
export const emptyCsv = (): string => emptyCsvFrom(COLUMNS);
