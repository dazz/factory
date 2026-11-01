import type { Automation } from "~/Automations/Domain/Automation.ts";
import type { ConsumedInput } from "~/Automations/Domain/ConsumedInput.ts";
import type { SessionOutcome } from "~/Automations/Domain/Event.ts";
import type { SessionId } from "~/Automations/Domain/Ids.ts";
import type { Limits } from "~/Automations/Domain/Policy.ts";

/**
 * One session: an automation run once on its consumed input, under the
 * policy's limits (FR-032). The outcome arrives when the harness returns —
 * until then the session is open.
 */
export class Session {
  constructor(
    readonly sessionId: SessionId,
    readonly automation: Automation,
    readonly input: ConsumedInput,
    readonly limits: Limits,
    readonly outcome: SessionOutcome | undefined = undefined,
  ) {
    if (input.automation !== automation.name) {
      throw new Error(
        `session ${sessionId}: input belongs to ${input.automation}, not ${automation.name}`,
      );
    }
  }

  finishedWith(outcome: SessionOutcome): Session {
    return new Session(this.sessionId, this.automation, this.input, this.limits, outcome);
  }

  isOpen(): boolean {
    return this.outcome === undefined;
  }
}
