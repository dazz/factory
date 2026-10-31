declare const brand: unique symbol;

/** Nominal typing: a SubjectId never passes where an AutomationName is expected. */
type Branded<Brand extends string> = string & { readonly [brand]: Brand };

export type AutomationName = Branded<"AutomationName">;
export type SubjectId = Branded<"SubjectId">;
export type Revision = Branded<"Revision">;
export type SessionId = Branded<"SessionId">;
export type CommitId = Branded<"CommitId">;

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Kebab-case, unique within the file (contracts/automations.md) — names the automation in events and status. */
export function automationName(value: string): AutomationName {
  if (!KEBAB_CASE.test(value)) {
    throw new Error(`automation name must be kebab-case, got ${JSON.stringify(value)}`);
  }
  return value as AutomationName;
}

export function subjectId(value: string): SubjectId {
  return nonEmpty(value, "subject") as SubjectId;
}

export function revision(value: string): Revision {
  return nonEmpty(value, "revision") as Revision;
}

export function sessionId(value: string): SessionId {
  return nonEmpty(value, "session id") as SessionId;
}

export function commitId(value: string): CommitId {
  return nonEmpty(value, "commit id") as CommitId;
}

function nonEmpty(value: string, what: string): string {
  if (value.trim() === "") throw new Error(`${what} must not be empty`);
  return value;
}
