/**
 * Must-consume across a function boundary: the container half.
 *
 * A `return` is not a discharge — it is a TRANSFER, and a transfer conserves the
 * obligation only if the receiving side is charged for it. For a Result or a
 * started Promise that is automatic: the caller's own SMITHERS1301/SMITHERS1402
 * is charged at the call. For a CONTAINER of them it was not charged anywhere,
 * so moving Results into an array and returning it cancelled the obligation
 * outright:
 *
 * ```
 * function saveAll(): readonly Result<number, SaveFailed>[] {
 *   return [save(1), save(2), save(3)]        // accepted
 * }
 * const outcomes = saveAll()
 * log.info(`saved ${outcomes.length} records`) // exit 0, failure never seen
 * ```
 *
 * `save(2)` throws, the failure never reaches the row, is never consumed, and
 * the program reports success — the exact hazard SMITHERS1301/1302 exist to
 * prevent, on both backends. The contrast that names the defect is one call
 * wide: `const arr = [save(1)]; arr.length` inside one function is refused and
 * corpus-pinned (`07-must-consume/array-length-is-not-consumption-of-a-result-collection`),
 * while the identical array reached through a call was clean.
 *
 * Two coupled rules close it, and they are the SAME QUESTION asked at both ends
 * of the transfer — "does the type this value has here still carry a
 * must-consume channel?":
 *
 *   * `heldObligation` charges a call (or `new`) whose value is not itself a
 *     Result or a started Promise but still HOLDS one, walking it through the
 *     existing `bindingConsumes`/`collectionConsumed` surface with
 *     `collection = true`;
 *   * `transferReachesCaller` lets a `return` discharge a stored collection only
 *     when the enclosing function's return type still carries the channel, so
 *     `function f(): unknown { return [make()] }` cannot launder it past a type
 *     that no rule can charge.
 *
 * This NARROWS the transfer rule; it does not widen it.
 * `07-must-consume/a-lifted-call-stored-into-a-plainly-typed-array-is-still-a-discard`
 * pins that a store transfers ownership only when the CONTAINER'S OWN TYPE still
 * carries the channel — a lifted `risky()` stored into a `number[]` is a discard
 * at the element — and that case is unchanged here, because the new rule asks
 * that same question of the value a call hands back rather than assuming any
 * container is transparent.
 *
 * The load-bearing half of this file is the NEGATIVE half. Every refusal is
 * paired with the acceptance that proves the rule did not simply widen: a
 * collection handed to `Result.all`, an element read back out with `!`, an
 * awaited `Promise.all`, an object of Results consumed through its property, and
 * a container with no channel in it at all all stay clean.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileAndCheckProject } from "./index.ts";

const workspace = mkdtempSync(join(tmpdir(), "smithers-must-consume-collections-"));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));

const RUNTIME = join(import.meta.dir, "../runtime/index.ts");

const PRELUDE = `class Missing extends Error {}
function one(): Result<number, Missing> { throw new Missing("gone") }
`;

let sequence = 0;
function compile(source: string): readonly string[] {
  sequence += 1;
  const fileName = join(workspace, `case-${sequence}.sm`);
  const checked = compileAndCheckProject([{ fileName, source }], {
    rootDir: workspace,
    outDir: join(workspace, "out"),
    runtimeImport: RUNTIME,
  });
  return checked.result.diagnostics
    .filter((diagnostic) => diagnostic.severity === "error")
    .map((diagnostic) => diagnostic.code);
}

/**
 * Every way a callee can hand a container of Results back to a caller.
 *
 * Add a row here before adding a reporting site anywhere: a new row that already
 * passes is the evidence that the receiving rule is a question about the value's
 * TYPE rather than a list of shapes somebody remembered to extend. The reviewer
 * measured 4 of 12 of these broken; the pair of rules closes 20.
 */
const LAUNDERED: readonly { readonly id: string; readonly body: string }[] = [
  {
    id: "an array of Results returned and read for its length",
    body: `function pack(): readonly Result<number, Missing>[] { return [one()] }
export function g(): number { const a = pack(); return a.length }`,
  },
  {
    id: "an object of Results returned and never read at all",
    body: `function hold(): { readonly r: Result<number, Missing> } { return { r: one() } }
export function g(): number { const b = hold(); return 0 }`,
  },
  {
    id: "a tuple of Results returned",
    body: `function pack(): readonly [Result<number, Missing>] { return [one()] }
export function g(): number { const t = pack(); return t.length }`,
  },
  {
    id: "a nested container of Results returned",
    body: `function pack(): readonly (readonly Result<number, Missing>[])[] { return [[one()]] }
export function g(): number { const n = pack(); return n.length }`,
  },
  {
    id: "a container returned through a ternary",
    body:
      `function pack(flag: boolean): readonly Result<number, Missing>[] { return flag ? [one()] : [] }
export function g(): number { const a = pack(true); return a.length }`,
  },
  {
    id: "a container returned through a nullish fallback",
    body:
      `function pack(fallback: readonly Result<number, Missing>[] | undefined): readonly Result<number, Missing>[] { return fallback ?? [one()] }
export function g(): number { const a = pack(undefined); return a.length }`,
  },
  {
    id: "an async function returning Promise<Result[]>, awaited and dropped",
    body: `async function pack(): Promise<readonly Result<number, Missing>[]> { return [one()] }
export async function g(): Promise<number> { const a = await pack(); return a.length }`,
  },
  {
    id: "an arrow with an inferred container return type",
    body: `const pack = () => [one()]
export function g(): number { const a = pack(); return a.length }`,
  },
  {
    id: "a container returned from a callback and dropped",
    body: `export function g(): number { return [1].map(() => [one()]).length }`,
  },
  {
    id: "a container stored on a class field and returned",
    body: `class Box {
  readonly rs: readonly Result<number, Missing>[] = [one()]
  all(): readonly Result<number, Missing>[] { return this.rs }
}
export function g(): number { const b = new Box(); return b.all().length }`,
  },
  {
    id: "a container laundered through a return type that cannot carry the channel",
    body: `function pack(): unknown { return [one()] }
export function g(): number { const a = pack(); return 0 }`,
  },
  {
    id: "a container bound inside the callee and then returned",
    body:
      `function pack(): readonly Result<number, Missing>[] { const arr = [one()]; return arr }
export function g(): number { const a = pack(); return a.length }`,
  },
  {
    id: "a returned container iterated with for-of",
    body: `function pack(): readonly Result<number, Missing>[] { return [one()] }
export function g(): number { let n = 0; for (const r of pack()) { n += 1 } return n }`,
  },
  {
    id: "a returned container discarded as a statement",
    body: `function pack(): readonly Result<number, Missing>[] { return [one()] }
export function g(): number { pack(); return 0 }`,
  },
  {
    id: "a container returned from an object method",
    body: `const api = { pack(): readonly Result<number, Missing>[] { return [one()] } }
export function g(): number { const a = api.pack(); return a.length }`,
  },
  {
    id: "a container returned through an as-cast",
    body:
      `function pack(): readonly Result<number, Missing>[] { return [one()] as readonly Result<number, Missing>[] }
export function g(): number { const a = pack(); return a.length }`,
  },
];

describe("a returned collection of Results charges its receiver", () => {
  for (const { id, body } of LAUNDERED) {
    test(id, () => {
      expect(compile(`${PRELUDE}${body}\n`)).toContain("SMITHERS1301");
    });
  }

  test("a returned collection of started Promises is a SMITHERS1402, not a 1301", () => {
    const codes = compile(`async function work(): Promise<number> { return 1 }
function starts(): readonly Promise<number>[] { return [work()] }
export function g(): number { const ps = starts(); return ps.length }
`);
    expect(codes).toContain("SMITHERS1402");
    expect(codes).not.toContain("SMITHERS1301");
  });

  test("a class field assigned in a constructor and returned is charged at both ends", () => {
    const codes = compile(`${PRELUDE}class Box {
  readonly rs: readonly Result<number, Missing>[]
  constructor() { this.rs = [one()] }
  all(): readonly Result<number, Missing>[] { return this.rs }
}
export function g(): number { const b = new Box(); return b.all().length }
`);
    expect(codes.filter((code) => code === "SMITHERS1301")).toHaveLength(2);
  });
});

/**
 * The over-correction guards.
 *
 * Six over-corrections have shipped in this repository. A rule that charges a
 * receiver is one wrong step away from refusing every program that uses a
 * collection at all, so each acceptance below is the twin of a refusal above.
 */
describe("consuming the collection keeps it clean", () => {
  test("a returned collection with NO caller is an ordinary transfer", () => {
    // Exactly what `export function f(): Result<A, E> { return one() }` is: the
    // obligation leaves for a caller this file does not contain. Charging here
    // would refuse every library that publishes a collection of Results.
    expect(compile(`${PRELUDE}export function pack(): readonly Result<number, Missing>[] { return [one()] }
`)).toEqual([]);
  });

  test("handing the collection to Result.all discharges it", () => {
    expect(compile(`${PRELUDE}function pack(): readonly Result<number, Missing>[] { return [one()] }
export function g(): Result<readonly number[], Missing> { return Result.all(pack()) }
`)).toEqual([]);
  });

  test("reading an element back out with postfix ! discharges it", () => {
    expect(compile(`${PRELUDE}function pack(): readonly Result<number, Missing>[] { return [one()] }
export function g(): Result<number, Missing> { const a = pack(); return a[0]! }
`)).toEqual([]);
  });

  test("indexing the call directly with postfix ! discharges it", () => {
    expect(compile(`${PRELUDE}function pack(): readonly Result<number, Missing>[] { return [one()] }
export function g(): Result<number, Missing> { return pack()[0]! }
`)).toEqual([]);
  });

  test("awaiting the async collection and collecting it discharges it", () => {
    expect(compile(`${PRELUDE}async function pack(): Promise<readonly Result<number, Missing>[]> { return [one()] }
export async function g(): Promise<Result<readonly number[], Missing>> {
  const a = await pack()
  return Result.all(a)
}
`)).toEqual([]);
  });

  test("a recognized Promise combinator owns what it hands back", () => {
    // 07-must-consume/the-ambient-promise-all-discharges-a-bound-promise is the
    // corpus twin: `collectionConsumed` already defines a recognized combinator
    // as owning everything handed to it, so its product is the consumed one.
    expect(compile(`async function work(): Promise<number> { return 1 }
function starts(): readonly Promise<number>[] { return [work()] }
export async function g(): Promise<number> {
  const ps = starts()
  const all = await Promise.all(ps)
  return all.length
}
`)).toEqual([]);
  });

  test("an object of Results returned across a boundary is consumed by its property", () => {
    // The corpus case an-object-of-results-returned-from-a-function-is-consumed-by-its-property,
    // which is the shape the receiving rule must NOT refuse.
    expect(compile(`${PRELUDE}function hold(): { found: Result<number, Missing> } { return { found: one() } }
export function g(): Result<number, Missing> { const bag = hold(); return bag.found! }
`)).toEqual([]);
  });

  test("a container with no must-consume channel in it is untouched", () => {
    expect(compile(`function two(): number { return 2 }
function pack(): readonly number[] { return [two()] }
export function g(): number { const a = pack(); return a.length }
`)).toEqual([]);
  });

  test("Result.all over a literal is still the ordinary spelling", () => {
    expect(compile(`${PRELUDE}export function g(): Result<readonly number[], Missing> { return Result.all([one(), one()]) }
`)).toEqual([]);
  });

  test("Result.all over a bound array is still the ordinary spelling", () => {
    expect(compile(`${PRELUDE}export function g(): Result<readonly number[], Missing> {
  const arr = [one(), one()]
  return Result.all(arr)
}
`)).toEqual([]);
  });

  test("a lifted call stored into a plainly typed array is still charged at the ELEMENT", () => {
    // 07-must-consume/a-lifted-call-stored-into-a-plainly-typed-array-is-still-a-discard.
    // `risky` is inferred `Result<number, Missing>` while its declaration says
    // `number`, so the array's own type is `number[]`, the store is a fiction,
    // and the receiving rule must not adopt it: `main()` hands back `number[]`,
    // which carries no channel, so nothing is charged at the call.
    expect(compile(`class Missing extends Error {}
function risky(key: string) {
  if (key !== "ada") throw new Missing()
  return 1
}
export function main(): number[] {
  return [risky("ada")]
}
`)).toEqual(["SMITHERS1301"]);
  });
});
