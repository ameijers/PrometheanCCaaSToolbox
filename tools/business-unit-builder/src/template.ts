import { toCsv } from "../../voice-workstream-builder/src/csv";

// The CSV contract: one row per business unit. Each column maps to one businessunit column; maxLength
// is that column's own limit from the environment's metadata, checked before anything is created.
// This list drives the example file, validation, the payload and the in-app column reference.

export interface ColumnDef {
  header: string;
  column?: string;      // businessunit column it's written to (parent is a lookup, handled separately)
  maxLength?: number;
  required?: boolean;
  description: string;
}

export const COLUMNS: ColumnDef[] = [
  { header: "name", column: "name", maxLength: 160, required: true, description: "Name of the new business unit. Must not exist in the environment yet." },
  { header: "parent_business_unit", description: "Name of the parent: an existing business unit, or another business unit in this file. Empty means directly under the root business unit." },
  { header: "description", column: "description", maxLength: 2000, description: "Free text." },
  { header: "division", column: "divisionname", maxLength: 100, description: "Division name." },
  { header: "cost_center", column: "costcenter", maxLength: 100, description: "Cost center." },
  { header: "email", column: "emailaddress", maxLength: 100, description: "Email address, e.g. contactcenter@contoso.com." },
  { header: "website", column: "websiteurl", maxLength: 200, description: "Website, e.g. https://www.contoso.com." },
  { header: "address_name", column: "address1_name", maxLength: 100, description: "Name of the main address, e.g. Head office." },
  { header: "street", column: "address1_line1", maxLength: 250, description: "Street and number." },
  { header: "city", column: "address1_city", maxLength: 80, description: "City." },
  { header: "postal_code", column: "address1_postalcode", maxLength: 20, description: "Postal code." },
  { header: "country", column: "address1_country", maxLength: 80, description: "Country." },
  { header: "phone", column: "address1_telephone1", maxLength: 50, description: "Main phone number." }
];

export const COLUMN_BY_HEADER = new Map(COLUMNS.map((c) => [c.header, c]));

export function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

// A three-level hierarchy under the root, one business unit under an existing one ("Sales"), and the
// rows deliberately not in creation order: the tool works the order out. Every name exists in the
// sample environment.
const EXAMPLE_ROWS: Record<string, string>[] = [
  { name: "Contact Center NL – Inbound", parent_business_unit: "Contact Center NL", description: "Inbound voice and chat agents, Netherlands" },
  { name: "Contact Center", description: "All contact center teams", division: "Customer Service", cost_center: "CC-000", email: "contactcenter@contoso.com", website: "https://www.contoso.com" },
  { name: "Contact Center NL", parent_business_unit: "Contact Center", division: "Customer Service", cost_center: "CC-100", address_name: "Amsterdam office", street: "Keizersgracht 1", city: "Amsterdam", postal_code: "1015 AA", country: "Netherlands", phone: "+31201234567" },
  { name: "Contact Center NL – Outbound", parent_business_unit: "Contact Center NL", description: "Outbound and callback agents, Netherlands" },
  { name: "Contact Center BE", parent_business_unit: "Contact Center", division: "Customer Service", cost_center: "CC-200", city: "Antwerpen", country: "Belgium" },
  { name: "Sales – Partners", parent_business_unit: "Sales", description: "Partner sales desk" }
];

export const EXAMPLE_FILE_NAME = "business-units-example.csv";

export function exampleCsv(): string {
  const headers = COLUMNS.map((c) => c.header);
  return toCsv(headers, EXAMPLE_ROWS.map((row) => headers.map((h) => row[h] ?? "")));
}

export function emptyTemplateCsv(): string {
  return toCsv(COLUMNS.map((c) => c.header), []);
}
