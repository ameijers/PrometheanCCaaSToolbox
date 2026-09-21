// Security roles that grant access to the Contact Center / Omnichannel agent experience. An agent
// needs at least one of these (case-insensitive exact match on role name) to be considered covered
// by the "Security roles" check. Out-of-box role names vary by license/SKU and by what an org has
// renamed or cloned them to, so this list is deliberately just the common out-of-box names — edit it
// to match the role(s) your own environment actually uses for agent access.
export const REQUIRED_SECURITY_ROLE_NAMES: string[] = [
  "Customer Service Agent",
  "Customer Service Representative",
  "Omnichannel Agent",
  "Contact Center Agent"
];

export function hasRequiredRole(agentRoleNames: string[]): boolean {
  const required = new Set(REQUIRED_SECURITY_ROLE_NAMES.map((name) => name.toLowerCase()));
  return agentRoleNames.some((name) => required.has(name.toLowerCase()));
}
