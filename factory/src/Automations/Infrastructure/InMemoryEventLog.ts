import type { EventLog } from "~/Automations/Application/AutomationsPorts.ts";
import type { Event } from "~/Automations/Domain/Event.ts";

/** The event log in memory: same contract as `JsonlEventLog`, no disk. */
export class InMemoryEventLog implements EventLog {
  private readonly events: Event[] = [];

  append(event: Event): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }

  async *replay(): AsyncIterable<Event> {
    yield* [...this.events];
  }

  /** For assertions: everything appended so far, in order. */
  appended(): readonly Event[] {
    return [...this.events];
  }

  /** For assertions: the `kind` of this log is the domain name, in order. */
  names(): readonly string[] {
    return this.events.map((event) => event.name);
  }
}
