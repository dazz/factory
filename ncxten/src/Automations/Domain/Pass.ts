import type { Automation } from "~/Automations/Domain/Automation.ts";
import type { Automations } from "~/Automations/Domain/Automations.ts";
import { ConsumedInput, type Finding } from "~/Automations/Domain/ConsumedInput.ts";
import type { AutomationName, Revision, SubjectId } from "~/Automations/Domain/Ids.ts";

/** The pass decision: this automation runs one session on this input. */
export interface Hit {
  readonly automation: Automation;
  readonly input: ConsumedInput;
}

/** The tracker's findings, gathered per automation by the use-case. */
export type FindingsByAutomation = ReadonlyMap<AutomationName, readonly Finding[]>;

/** What the replayed project already consumed — `Project.consumedRevision`. */
export type ConsumedRevision = (
  automation: AutomationName,
  subject: SubjectId,
) => Revision | undefined;

/**
 * One pass (FR-031): the first automation in list order with new input is the
 * hit — list order is priority, reacting beats starting new work. No hit →
 * the pass is empty, which ends the tick's drain. The new-input filter is
 * FR-035 and lives here and only here — never in a tracker adapter: a finding
 * is new iff its revision differs from the consumed one, whatever the
 * consuming session's outcome was.
 */
export function findHit(
  automations: Automations,
  findings: FindingsByAutomation,
  consumed: ConsumedRevision,
): Hit | undefined {
  for (const automation of automations.inOrder()) {
    const fresh = (findings.get(automation.name) ?? []).find(
      (finding) => consumed(automation.name, finding.subject) !== finding.revision,
    );
    if (fresh !== undefined) {
      return { automation, input: ConsumedInput.of(automation.name, fresh) };
    }
  }
  return undefined;
}
