/**
 * An ISO 8601 duration from a policy or automations file: `PT15M` is fifteen
 * minutes, `P15M` fifteen months — both parse, and the bounds in `Policy`
 * reject the typo. Carries the original text and the milliseconds
 * (data-model.md). The predecessor wrapped `Temporal.Duration` (Deno); Bun
 * runs Temporal but TypeScript does not type it yet, so the parsing is ours.
 */

const PATTERN =
  /^P(?=.)(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?=.)(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

const MS_PER_SECOND = 1_000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const DAYS_PER_WEEK = 7;
// Nominal, not calendar: months and years only ever appear in typos (`P15M`),
// which the Policy bounds reject — the exact length never matters.
const DAYS_PER_MONTH = 30;
const DAYS_PER_YEAR = 365;

const MS_PER_MINUTE = SECONDS_PER_MINUTE * MS_PER_SECOND;
const MS_PER_HOUR = MINUTES_PER_HOUR * MS_PER_MINUTE;
const MS_PER_DAY = HOURS_PER_DAY * MS_PER_HOUR;

export class IsoDuration {
  private constructor(
    /** The original spelling — events carry this, never the milliseconds. */
    readonly text: string,
    readonly milliseconds: number,
  ) {}

  /** `where` names the field for the error message, e.g. `policy.tick`. */
  static parse(text: string, where: string): IsoDuration {
    const match = PATTERN.exec(text);
    if (match === null) {
      throw new Error(
        `${where}: ${JSON.stringify(text)} is not an ISO 8601 duration (PT15M = 15 minutes)`,
      );
    }
    const [, years, months, weeks, days, hours, minutes, seconds] = match;
    const totalDays =
      amount(years) * DAYS_PER_YEAR +
      amount(months) * DAYS_PER_MONTH +
      amount(weeks) * DAYS_PER_WEEK +
      amount(days);
    const milliseconds =
      totalDays * MS_PER_DAY +
      amount(hours) * MS_PER_HOUR +
      amount(minutes) * MS_PER_MINUTE +
      amount(seconds) * MS_PER_SECOND;
    return new IsoDuration(text, milliseconds);
  }
}

function amount(group: string | undefined): number {
  return group === undefined ? 0 : Number(group);
}
