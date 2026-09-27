// The one interface the scan reads through. dataverse.ts implements it over Xrm.WebApi (live);
// demoData.ts implements it over bundled sample data. Nothing else in the tool knows which one it
// has — demo mode runs exactly the same scan, discovery and analysis code as a live environment.

export interface LookupMetadata {
  // Logical name of the lookup attribute on the table being described (value read as `_<attribute>_value`).
  attribute: string;
  // Logical name of the table it points to.
  target: string;
}

export interface TableMetadata {
  primaryId: string;
  primaryName?: string;
  // null when the relationship metadata couldn't be read — the table can still be scanned, but no
  // relationships are discovered from it.
  lookups: LookupMetadata[] | null;
}

export type AccessFailure = "notFound" | "noPermission" | "error";

// metadata: null means "couldn't ask" (e.g. no client URL) — the scan falls back to the reference
// map's primary-key names and tries to read the table anyway.
export type DescribeResult = { status: "ok"; metadata: TableMetadata | null } | { status: AccessFailure; message: string };

export interface ReadRequest {
  logicalName: string;
  select: string[];
  // Lookups that only come back through $expand; the value is surfaced as `_<navigation>_value`.
  expand: { navigation: string; idField: string }[];
  filter?: string;
}

export interface ReadResult {
  rows: Record<string, unknown>[];
  // Requested columns/expands that don't exist (or can't be queried) here and were left out.
  droppedColumns: string[];
  // False when the filter was requested but had to be dropped (or the source ignores filters).
  filterApplied: boolean;
}

export class DataAccessError extends Error {
  constructor(readonly kind: AccessFailure, message: string) {
    super(message);
  }
}

export interface DataSource {
  mode: "live" | "demo";
  describeTable(logicalName: string): Promise<DescribeResult>;
  readTable(request: ReadRequest): Promise<ReadResult>;
}
