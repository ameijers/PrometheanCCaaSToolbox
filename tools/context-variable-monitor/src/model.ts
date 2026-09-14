export type ContextVariableType = "text" | "number" | "boolean" | "entityReference" | "unknown";

export interface Workstream {
  id: string;
  name: string;
  active: boolean;
}

export interface ContextVariableDefinition {
  id: string;
  name: string;
  displayName: string;
  type: ContextVariableType;
}

// One value actually captured on a specific call, as written to
// msdyn_ocliveworkitemcontextitemelastic — includes both officially-defined context variables and
// bot/system-internal values (e.g. va_BotName) that were never declared as a context variable.
export interface CapturedValue {
  name: string;
  rawValue: string;
  displayValue: string;
  type: ContextVariableType;
  capturedOn?: string; // ISO
}

export interface WorkItemSummary {
  id: string;
  title: string;
  createdOn: string; // ISO
  active: boolean;
}

export interface MatchedVariable {
  definition: ContextVariableDefinition;
  value?: CapturedValue;
}

// The full picture for one call: its defined variables (set or not), plus anything else the call
// captured that isn't an officially-defined variable — informative for debugging IVR/bot config.
export interface MonitorSnapshot {
  matched: MatchedVariable[];
  extra: CapturedValue[];
}
