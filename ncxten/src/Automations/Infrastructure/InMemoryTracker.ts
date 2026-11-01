import type { Tracker } from "~/Automations/Application/AutomationsPorts.ts";
import type { Finding } from "~/Automations/Domain/ConsumedInput.ts";
import { type AutomationName, automationName } from "~/Automations/Domain/Ids.ts";

/**
 * The tracker stub, seeded by tests: `present(automation, finding)` is what
 * the forge would show. A finding stays presented until a test removes it —
 * the new-input judgment is the domain's (`Pass`), never the tracker's.
 */
export class InMemoryTracker implements Tracker {
  private readonly presented = new Map<AutomationName, Finding[]>();

  present(automation: string, finding: Finding): void {
    const name = automationName(automation);
    const findings = this.presented.get(name) ?? [];
    findings.push(finding);
    this.presented.set(name, findings);
  }

  clear(automation: string): void {
    this.presented.delete(automationName(automation));
  }

  findings(automation: AutomationName): Promise<readonly Finding[]> {
    return Promise.resolve([...(this.presented.get(automation) ?? [])]);
  }
}
