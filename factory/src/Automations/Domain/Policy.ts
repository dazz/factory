import { IsoDuration } from "~/Automations/Domain/IsoDuration.ts";

/**
 * The tick bounds (contracts/policy.md): they catch the two classic typos —
 * `PT15S` (every 15 seconds, hammers the forge's rate limits) and `P15M`
 * (fifteen months, effectively never).
 */
export const TICK_MINIMUM = IsoDuration.parse("PT1M", "tick minimum");
export const TICK_MAXIMUM = IsoDuration.parse("PT24H", "tick maximum");

/** What the policy declares in `~/.config/factory/<owner>/<repo>.yaml` when nothing is set. */
export const DEFAULT_TICK = IsoDuration.parse("PT15M", "tick default");

const MINIMUM_TURNS = 1;
const REPOSITORY = /^[^/\s]+\/[^/\s]+$/;

/** Per-session limits, handed to the harness (FR-032). */
export interface Limits {
  readonly turns: number;
  readonly time: IsoDuration;
}

export interface PolicyFields {
  /** `owner/repo` — the project ID itself; everything but the checkout derives from it. */
  readonly repository: string;
  /** The forge host for event lines (`github.com`) — omitted on lines without a valid policy. */
  readonly forge: string;
  /** The local clone; the only path in the policy (contracts/policy.md). */
  readonly checkout: string;
  readonly tick: IsoDuration;
  readonly limits: Limits;
}

/**
 * The validated policy value object — the fields this slice uses (FR-003);
 * the full schema with its defaults lives in `YamlPolicy` (zod,
 * Infrastructure), which hands over a parsed `Policy` or a problem.
 */
export class Policy {
  readonly repository: string;
  readonly forge: string;
  readonly checkout: string;
  readonly tick: IsoDuration;
  readonly limits: Limits;

  constructor(fields: PolicyFields) {
    const { repository, forge, checkout, tick, limits } = fields;
    if (!REPOSITORY.test(repository)) {
      throw new Error(`repo.repository: ${JSON.stringify(repository)} is not owner/repo`);
    }
    if (forge.trim() === "") {
      throw new Error("repo.forge: must not be empty");
    }
    if (!checkout.startsWith("/")) {
      throw new Error(`repo.paths.checkout: ${JSON.stringify(checkout)} is not an absolute path`);
    }
    if (tick.milliseconds < TICK_MINIMUM.milliseconds) {
      throw new Error(`policy.tick: ${tick.text} is below the minimum ${TICK_MINIMUM.text}`);
    }
    if (tick.milliseconds > TICK_MAXIMUM.milliseconds) {
      throw new Error(`policy.tick: ${tick.text} is above the maximum ${TICK_MAXIMUM.text}`);
    }
    if (!Number.isInteger(limits.turns) || limits.turns < MINIMUM_TURNS) {
      throw new Error(`policy.limits.turns: must be a positive integer, got ${limits.turns}`);
    }
    if (limits.time.milliseconds <= 0) {
      throw new Error(`policy.limits.time: ${limits.time.text} must be a positive duration`);
    }
    this.repository = repository;
    this.forge = forge;
    this.checkout = checkout;
    this.tick = tick;
    this.limits = limits;
  }
}
