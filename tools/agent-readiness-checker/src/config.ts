export interface RoleGroup {
  key: string;
  label: string;
  roleNames: string[];
}

// How many days ago an agent's last known workspace login is still treated as "recent enough" for
// checkPresence (checks.ts) to pass them even though they're not logged in right now. Most agents are
// logged out most of the time — off-shift, weekends, between calls in some configurations — so "not
// currently logged in" alone isn't a structural misconfiguration worth flagging; only a genuinely
// stale or nonexistent login is (per direct operator feedback — see IMPLEMENTATION_STATUS.md "Round
// 15"). Tune this if a different cadence is more meaningful for a given environment/shift pattern.
export const PRESENCE_STALE_THRESHOLD_DAYS = 14;

// Default/fallback role names, used in two places only: (1) demo mode, which has no live `role`
// table to pick from, so its hand-authored agents' role names (see demoData.ts) are matched against
// these; (2) as a starting suggestion the first time the live role picker runs (see App.tsx) — never
// applied directly to a live environment's roster. A live connection instead uses whatever roles the
// person running the tool actually selected (see RoleSelection below), because exact out-of-box role
// names are not a reliable thing to guess: live testing found an environment where the Omnichannel
// Supervisor role had been renamed to "D365CC-Omnichannel-Supervisor", which a fixed name list could
// never have matched — see IMPLEMENTATION_STATUS.md "Round 9".
// Omnichannel-prefixed names are listed first in each group: this tool is specifically about
// contact-center/unified-routing readiness, and the Omnichannel role is the one that actually grants
// that functionality — a generic "Customer Service X" role governs case/entity access, not routing.
// suggestSelection (App.tsx) tries these names in order before falling back to a loose keyword match.
export const DEFAULT_ROLE_GROUPS: RoleGroup[] = [
  { key: "agent", label: "Agent", roleNames: ["Omnichannel Agent", "Customer Service Agent", "Customer Service Representative", "Contact Center Agent"] },
  { key: "supervisor", label: "Supervisor", roleNames: ["Omnichannel Supervisor", "Customer Service Manager", "Contact Center Supervisor", "Customer Service Team Lead"] },
  { key: "admin", label: "Omnichannel Admin", roleNames: ["Omnichannel Administrator", "Contact Center Administrator"] }
];

// A single, case-insensitive substring per group, used only to pre-check likely roles in the live
// picker before the person reviews/adjusts the selection themselves. Deliberately much looser than
// DEFAULT_ROLE_GROUPS's exact names — a substring match against the real role name is what actually
// survives renaming/cloning (e.g. "D365CC-Omnichannel-Supervisor" still contains "supervisor"),
// whereas an exact-name match does not.
export const ROLE_GROUP_SUGGESTION_KEYWORDS: Record<string, string> = {
  agent: "agent",
  supervisor: "supervisor",
  admin: "admin"
};

// A single role NAME per group key (see RoleGroup.key), picked from the environment's own live
// `role` table by the person running the tool via a dropdown per group — see App.tsx's role picker.
// This is a name, not a roleid: Dataverse security roles are business-unit-scoped (every business
// unit gets its own copy of each role, sharing one name but a distinct roleid — confirmed live, see
// IMPLEMENTATION_STATUS.md "Round 11"), so a specific roleid would silently only cover one business
// unit's worth of candidates. App.tsx's resolveRoleIds expands a picked name back to every roleid
// that shares it before querying. One role per group (rather than a checkbox list of several) is a
// deliberate simplification: it keeps the picker to three dropdowns instead of a long per-role
// checkbox matrix, matching how most environments actually map one real role to each of
// Agent/Supervisor/Omnichannel Admin. A group with no role picked is simply absent from this object.
// This is what actually drives both who appears on the roster (dataverse.ts) and the UI's
// role-group filter checkboxes once a live connection is active; DEFAULT_ROLE_GROUPS is never used
// directly against live data.
export type RoleSelection = Record<string, string>;

// The live-resolved role NAMES (not ids) satisfying the "agent" group, set once by App.tsx after the
// person confirms their role selection (translating the chosen ids back to names via the same `role`
// rows the picker showed) — defaults to DEFAULT_ROLE_GROUPS's guess so demo mode and any check run
// before a live selection exists still behave sensibly. checks.ts's checkSecurityRoles reads this
// indirectly via hasRequiredRole()/getActiveAgentRoleNames(), never the raw ids, so it stays a pure,
// synchronous function needing no Dataverse or picker awareness of its own.
let activeAgentRoleNames: string[] = DEFAULT_ROLE_GROUPS.find((g) => g.key === "agent")?.roleNames ?? [];

export function setActiveAgentRoleNames(names: string[]): void {
  activeAgentRoleNames = names;
}

export function getActiveAgentRoleNames(): string[] {
  return activeAgentRoleNames;
}

export function hasRequiredRole(agentRoleNames: string[]): boolean {
  const required = new Set(activeAgentRoleNames.map((name) => name.toLowerCase()));
  return agentRoleNames.some((name) => required.has(name.toLowerCase()));
}

// True if this agent holds at least one role whose name is in the given group's live-resolved (or,
// in demo mode, default) role-name list — used by the UI's role-group filter checkboxes.
export function matchesRoleGroup(agentRoleNames: string[], group: RoleGroup): boolean {
  const names = new Set(group.roleNames.map((n) => n.toLowerCase()));
  return agentRoleNames.some((name) => names.has(name.toLowerCase()));
}
