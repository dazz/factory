/**
 * An append or fsync failed (FR-053): the factory never acts without a
 * record — the process ends with exit 74, the supervisor restarts it and
 * the replay catches up. Its own file, not `AutomationsPorts.ts`: the UI
 * names this error to map it to the exit code, and the UI imports no ports.
 */
export class EventLogUnwritable extends Error {}
