// Generated from demo.vs by vsc.ts — DO NOT EDIT
import { __VSError, __vsTry, __vsCatch, __vsProvide, __vsUse } from "../runtime";

// VibeScript demo — exercises errors, try/catch expressions, uses/provide DI,
// if-expressions, and the failure-vs-defect distinction.

class NotFound extends __VSError {
  declare readonly _tag: "NotFound";
  declare readonly id: number;
  constructor(fields: { id: number }) { super("NotFound", fields); }
}
class Timeout extends __VSError {
  declare readonly _tag: "Timeout";
  declare readonly ms: number;
  constructor(fields: { ms: number }) { super("Timeout", fields); }
}

interface User { id: number; name: string }

// `uses` pulls capabilities from ambient context; `!NotFound` is the (stripped) error channel.
function fetchUser(id: number): User { const Db = __vsUse("Db"); const Logger = __vsUse("Logger");
  Logger.info(`fetchUser(${id})`);
  const row = Db.query(id);
  if (row == null) {
    throw new NotFound({ id });
  }
  return row;
}

function fetchUserName(id: number): string { const Db = __vsUse("Db"); const Logger = __vsUse("Logger");
  const user = __vsTry(() => (fetchUser(id))); // try-expression: propagate the failure to the caller
  return "user is " + user.name;
}

function kaboom(): User { const Logger = __vsUse("Logger");
  Logger.info("about to hit a defect");
  throw new RangeError("boom: not a branded failure, a DEFECT");
}

const db = {
  rows: { 1: { id: 1, name: "Ada" } } as Record<number, User>,
  query(id: number): User | null { return this.rows[id] ?? null; },
};
const logger = { info: (m: string) => console.log("   [log]", m) };

__vsProvide({ Db: db, Logger: logger }, () => {
  // 1) happy path through uses/provide
  console.log("1) happy path:", fetchUserName(1));

  // 2) catch-expression with a plain fallback expression (typed failure handled)
  const name = __vsCatch(() => (fetchUserName(999)), (e: any) => ("guest (caught " + e._tag + ")"));
  console.log("2) catch fallback:", name);

  // 3) catch-expression with a switch-on-_tag fallback
  const user = __vsCatch(() => (fetchUser(999)), (e: any) => { switch (e._tag) {
    case "NotFound": return ({ id: -1, name: "anon #" + e.id });
    case "Timeout": return ({ id: -2, name: "slowpoke" });
  } throw e; })
  console.log("3) switch fallback:", user);

  // 4) if-expression
  const kind = ((user.id < 0) ? ("fallback-user") : ("real-user"));
  console.log("4) if-expression:", kind);

  // 5) a DEFECT sails straight through the catch-expression
  try {
    const nope = __vsCatch(() => (kaboom()), (e: any) => (({ id: 0, name: "should never be reached" })));
    console.log("XX NOT PRINTED", nope);
  } catch (err) {
    console.log("5) defect escaped the catch-expression:", (err as Error).message);
  }
})

// 6) outside provide: missing capability is a defect
try {
  fetchUser(1);
} catch (err) {
  console.log("6) missing capability:", (err as Error).message);
}

console.log("done.");
