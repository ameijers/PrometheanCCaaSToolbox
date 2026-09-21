import { bulkToCsv, bulkToMarkdown, detailToCsv, detailToMarkdown } from "../src/export";
import { AgentReadiness, CheckResult } from "../src/model";

const passCheck: CheckResult = { id: "account", category: "account", status: "pass", title: "Account is enabled and interactive", evidence: "Account is enabled.", explanation: "Matters because X." };
const failCheck: CheckResult = { id: "queueMembership", category: "queueMembership", status: "fail", title: "Belongs to at least one active, routable queue", evidence: "Queues: Legacy Queue (disabled, not routed to)", explanation: "Matters because Y.", suggestedFix: "Add to a routable queue." };

const readyAgent: AgentReadiness = { agentId: "a1", agentName: "Ada Lovelace", domainName: "ada@contoso.com", overallStatus: "ready", checks: [passCheck], failedCount: 0, warnCount: 0, unknownCount: 0 };
const notReadyAgent: AgentReadiness = { agentId: "a2", agentName: "Grace Hopper, Sr.", overallStatus: "notReady", checks: [passCheck, failCheck], failedCount: 1, warnCount: 0, unknownCount: 0, topIssue: "Belongs to at least one active, routable queue" };

describe("bulkToCsv", () => {
  test("includes a header row and one row per agent", () => {
    const csv = bulkToCsv([readyAgent, notReadyAgent]);
    const lines = csv.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("Agent,Domain name,Overall status,Failed,Warnings,Not verifiable,Top issue");
    expect(lines[1]).toContain("Ada Lovelace");
    expect(lines[1]).toContain("Ready");
  });

  test("quotes and escapes a field containing a comma", () => {
    const csv = bulkToCsv([notReadyAgent]);
    expect(csv).toContain('"Grace Hopper, Sr."');
  });
});

describe("bulkToMarkdown", () => {
  test("renders a markdown table with one row per agent", () => {
    const md = bulkToMarkdown([readyAgent, notReadyAgent]);
    expect(md).toContain("| Agent | Domain name |");
    expect(md).toContain("| Ada Lovelace |");
    expect(md).toContain("| Grace Hopper, Sr. |");
  });
});

describe("detailToCsv", () => {
  test("includes agent header lines and one row per check", () => {
    const csv = detailToCsv(notReadyAgent);
    expect(csv).toContain("Agent: Grace Hopper, Sr.");
    expect(csv).toContain("Overall status: Not ready");
    const lines = csv.split("\n");
    expect(lines.filter((l) => l.includes("Belongs to at least one"))).toHaveLength(1);
  });
});

describe("detailToMarkdown", () => {
  test("renders a markdown table with one row per check and escapes pipes in evidence", () => {
    const withPipe: AgentReadiness = { ...readyAgent, checks: [{ ...passCheck, evidence: "Queues: A | B" }] };
    const md = detailToMarkdown(withPipe);
    expect(md).toContain("# Ada Lovelace — readiness detail");
    expect(md).toContain("Queues: A \\| B");
  });
});
