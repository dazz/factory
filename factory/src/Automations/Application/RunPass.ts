import type { EventLog, Harness, Tracker } from "~/Automations/Application/AutomationsPorts.ts";
import type { ProjectContext } from "~/Automations/Application/StartProject.ts";
import type { Automations } from "~/Automations/Domain/Automations.ts";
import type { Finding } from "~/Automations/Domain/ConsumedInput.ts";
import type { Event } from "~/Automations/Domain/Event.ts";
import { type AutomationName, sessionId } from "~/Automations/Domain/Ids.ts";
import { findHit } from "~/Automations/Domain/Pass.ts";
import type { Limits } from "~/Automations/Domain/Policy.ts";
import { Session } from "~/Automations/Domain/Session.ts";
import type { Clock } from "~/Shared/Clock.ts";

/**
 * One pass: gather the findings, let the domain decide (`Pass.findHit`), run
 * at most one session. `SessionStarted` is appended **before** the harness is
 * dispatched (FR-043) — starting is what consumes the input, whatever the
 * outcome (FR-035, scenario 9).
 */
export class RunPass {
  constructor(
    private readonly ports: {
      readonly tracker: Tracker;
      readonly harness: Harness;
      readonly log: EventLog;
      readonly clock: Clock;
    },
    private readonly context: ProjectContext,
  ) {}

  async run(automations: Automations, limits: Limits): Promise<"session-ran" | "empty-pass"> {
    const { tracker, harness, log, clock } = this.ports;
    const project = this.context.project;

    const findings = new Map<AutomationName, readonly Finding[]>();
    for (const automation of automations.inOrder()) {
      findings.set(automation.name, await tracker.findings(automation.name));
    }
    const hit = findHit(automations, findings, (automation, subject) =>
      project.consumedRevision(automation, subject),
    );
    if (hit === undefined) return "empty-pass";

    const session = new Session(sessionId(crypto.randomUUID()), hit.automation, hit.input, limits);
    const started: Event = {
      name: "SessionStarted",
      at: clock.now(),
      automation: session.automation.name,
      subject: session.input.subject,
      revision: session.input.revision,
      sessionId: session.sessionId,
    };
    await log.append(started);
    project.apply(started);

    const outcome = await harness.run(session.automation, session.input, session.limits);
    const ended: Event =
      outcome === "aborted"
        ? {
            name: "SessionAborted",
            at: clock.now(),
            automation: session.automation.name,
            subject: session.input.subject,
            sessionId: session.sessionId,
          }
        : {
            name: "SessionFinished",
            at: clock.now(),
            automation: session.automation.name,
            subject: session.input.subject,
            sessionId: session.sessionId,
            outcome,
          };
    await log.append(ended);
    project.apply(ended);
    return "session-ran";
  }
}
