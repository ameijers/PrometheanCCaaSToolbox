import { ColumnDef, emptyCsvFrom, exampleCsvFrom } from "../../shared/src/columns";

// One row per user. Drives the example file, validation and the in-app column reference.
export const COLUMNS: ColumnDef[] = [
  { header: "user", required: true, description: "Sign-in name or email of the user. The user must be in this environment and already be a bookable resource (set up with User Setup)." },
  { header: "queues", required: true, list: true, description: "Advanced queues to add the user to, by name. Queues the user is already a member of are left alone." }
];

const EXAMPLE_ROWS: Record<string, string>[] = [
  { user: "anna@contoso.com", queues: "Sales – NL|Sales – Priority customers" },
  { user: "bram@contoso.com", queues: "Sales – NL" },
  { user: "dana.smit@contoso.com", queues: "Support – Overflow|Support – Chat" }
];

export const EXAMPLE_FILE_NAME = "queue-membership-example.csv";
export const exampleCsv = (): string => exampleCsvFrom(COLUMNS, EXAMPLE_ROWS);
export const emptyCsv = (): string => emptyCsvFrom(COLUMNS);
