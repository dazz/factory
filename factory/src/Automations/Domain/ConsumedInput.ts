import type { AutomationName, Revision, SubjectId } from "~/Automations/Domain/Ids.ts";

/** A finding as the tracker reports it — deliberately free of any new/old judgment. */
export interface Finding {
  readonly subject: SubjectId;
  readonly revision: Revision;
}

/**
 * The identity FR-035 filters on: starting a session consumes exactly this —
 * automation + subject at a revision — whatever the session's outcome.
 */
export class ConsumedInput {
  constructor(
    readonly automation: AutomationName,
    readonly subject: SubjectId,
    readonly revision: Revision,
  ) {}

  static of(automation: AutomationName, finding: Finding): ConsumedInput {
    return new ConsumedInput(automation, finding.subject, finding.revision);
  }

  equals(other: ConsumedInput): boolean {
    return (
      this.automation === other.automation &&
      this.subject === other.subject &&
      this.revision === other.revision
    );
  }
}
