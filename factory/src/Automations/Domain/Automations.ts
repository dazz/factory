import type { Automation } from "~/Automations/Domain/Automation.ts";
import type { CommitId } from "~/Automations/Domain/Ids.ts";

/**
 * The validated `automations.yml` as a whole: all automations plus the commit
 * they were read at. "Last valid version" is a replace-on-valid rule (FR-012):
 * a newly valid file replaces this value entirely, an invalid one leaves it in
 * effect — holding the newest valid instance is the tick's job, never a merge.
 */
export class Automations {
  private constructor(
    private readonly list: readonly Automation[],
    readonly commit: CommitId,
  ) {}

  static of(list: readonly Automation[], commit: CommitId): Automations {
    if (list.length === 0) throw new Error("automations: at least one entry is required");
    const names = new Set<string>();
    for (const automation of list) {
      if (names.has(automation.name)) {
        throw new Error(`automations: duplicate name ${automation.name}`);
      }
      names.add(automation.name);
    }
    return new Automations([...list], commit);
  }

  /** List order is priority (FR-031): reacting beats starting new work. */
  inOrder(): readonly Automation[] {
    return this.list;
  }
}
