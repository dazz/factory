import type { AutomationName } from "~/Automations/Domain/Ids.ts";

/**
 * One entry of `automations.yml` (contracts/automations.md). The skill ref is
 * opaque in this slice — the fake harness only records it; the gate is
 * declared and validated, unused until 003. The automation's deterministic
 * precheck is the new-input check for exactly this automation (FR-031) —
 * answered by the tracker's findings and decided in `Pass`.
 */
export class Automation {
  constructor(
    readonly name: AutomationName,
    readonly skill: string,
    readonly gate: string | undefined = undefined,
  ) {
    if (skill.trim() === "") throw new Error(`automation ${name}: skill must not be empty`);
    if (gate !== undefined && gate.trim() === "") {
      throw new Error(`automation ${name}: gate must not be empty when declared`);
    }
  }
}
