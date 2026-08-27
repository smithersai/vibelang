/**
 * Foreign value provenance MUST NOT depend on how a property is spelled.
 *
 * `{ handler: handler }` and `{ handler }` are one program. The reference used
 * to refuse the first and accept the second, because
 * `checker.getSymbolAtLocation` answers the *property* symbol for the name of
 * an ES2015 shorthand property assignment — a symbol whose only declaration is
 * the `ShorthandPropertyAssignment` itself. Every provenance walk that follows
 * a symbol to its declaration therefore dead-ended there, and the dead end was
 * FAIL-OPEN: the walk answered "not foreign" rather than "unknown". The Go fork
 * read the shorthand correctly for a local `const` and had the same hole for a
 * directly IMPORTED binding.
 *
 * That reopens the guard `foreign-callback-trust.test.ts` exists to hold shut.
 * `SMITHERS1508`'s charter is that "a `@throws {never}` claim is about THIS
 * callee and cannot speak for the panic provenance of a callable minted in
 * another module"; rewriting one property to its shorthand walked straight past
 * it.
 *
 * The load-bearing half of this file is the NEGATIVE half. A rule that refuses
 * shorthand properties is trivially "sound" and useless, so every refusal below
 * is paired with its longhand twin at the SAME code and position, and with the
 * ordinary shorthands — a number, an owned function, an owned object, a
 * callback handed to a trusted binding — that must stay accepted.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileAndCheckProject } from "./index.ts";

const workspace = mkdtempSync(join(tmpdir(), "smithers-shorthand-provenance-"));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));

const RUNTIME = join(import.meta.dir, "../runtime/index.ts");

writeFileSync(join(workspace, "foreign.ts"), `/**
 * @module
 * @throws {never}
 */

/** @throws {never} */
export function getHandler(): (name: string) => void {
  return (name) => { void name; };
}

/** @throws {never} */
export function getRecord(): { readonly id: string } {
  return { id: "r" };
}

/** @throws {never} */
export function register(handlers: { readonly handler: (name: string) => void }): void {
  handlers.handler("x");
}

/** No @throws claim: the default checked panic case survives every call. */
export function registerUnsafe(handlers: { readonly handler: (name: string) => void }): void {
  handlers.handler("x");
}

/** @throws {never} */
export const VERSION: number = 1;
`);

interface Compiled {
  readonly codes: readonly string[];
  readonly emitted: number;
  readonly rows: Readonly<Record<string, { failures: readonly string[]; requirements: readonly string[] }>>;
}

let sequence = 0;
function compile(source: string): Compiled {
  sequence += 1;
  const fileName = join(workspace, `case-${sequence}.sm`);
  const checked = compileAndCheckProject([{ fileName, source }], {
    rootDir: workspace,
    outDir: join(workspace, "out"),
    runtimeImport: RUNTIME,
  });
  const errors = checked.result.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  const file = Object.values(checked.result.files)[0];
  return {
    codes: errors.map((diagnostic) => `${diagnostic.code}@${diagnostic.line}:${diagnostic.column}`).sort(),
    emitted: checked.emitDiagnostics.length,
    rows: (file?.analysis.rows ?? {}) as Compiled["rows"],
  };
}

/**
 * Each pair is ONE program written twice. The assertion is equality, not a
 * hard-coded code list: whatever the longhand does, the shorthand must do at
 * the identical position, which is a claim no future change can satisfy by
 * loosening both halves in the accepting direction — the third assertion pins
 * that the pair is a refusal.
 */
const PAIRS: readonly { readonly id: string; readonly longhand: string; readonly shorthand: string }[] = [
  {
    id: "a frozen object argument",
    longhand: `import { getHandler } from "./foreign.ts"
export function f(): void {
  const handler = getHandler()
  const ns = Object.freeze({ handler: handler })
  void ns
}
`,
    shorthand: `import { getHandler } from "./foreign.ts"
export function f(): void {
  const handler = getHandler()
  const ns = Object.freeze({ handler })
  void ns
}
`,
  },
  {
    id: "a nested object",
    longhand: `import { getHandler } from "./foreign.ts"
export function f(): void {
  const handler = getHandler()
  const ns = Object.freeze({ inner: { handler: handler } })
  void ns
}
`,
    shorthand: `import { getHandler } from "./foreign.ts"
export function f(): void {
  const handler = getHandler()
  const ns = Object.freeze({ inner: { handler } })
  void ns
}
`,
  },
  {
    id: "a const alias in between",
    longhand: `import { getHandler } from "./foreign.ts"
export function f(): void {
  const handler = getHandler()
  const h = handler
  const ns = Object.freeze({ h: h })
  void ns
}
`,
    shorthand: `import { getHandler } from "./foreign.ts"
export function f(): void {
  const handler = getHandler()
  const h = handler
  const ns = Object.freeze({ h })
  void ns
}
`,
  },
  {
    id: "an Object.assign argument",
    longhand: `import { getHandler } from "./foreign.ts"
export function f(): void {
  const handler = getHandler()
  const ns = Object.assign({}, { handler: handler })
  void ns
}
`,
    shorthand: `import { getHandler } from "./foreign.ts"
export function f(): void {
  const handler = getHandler()
  const ns = Object.assign({}, { handler })
  void ns
}
`,
  },
  {
    id: "a spread of the object that holds it",
    longhand: `import { getHandler } from "./foreign.ts"
export function f(): void {
  const handler = getHandler()
  const src = { handler: handler }
  const ns = Object.freeze({ ...src })
  void ns
}
`,
    shorthand: `import { getHandler } from "./foreign.ts"
export function f(): void {
  const handler = getHandler()
  const src = { handler }
  const ns = Object.freeze({ ...src })
  void ns
}
`,
  },
  {
    id: "destructuring and rebuilding",
    longhand: `import { getHandler } from "./foreign.ts"
export function f(): void {
  const handler = getHandler()
  const src = { handler: handler }
  const { handler: h } = src
  const ns = Object.freeze({ h: h })
  void ns
}
`,
    shorthand: `import { getHandler } from "./foreign.ts"
export function f(): void {
  const handler = getHandler()
  const src = { handler: handler }
  const { handler: h } = src
  const ns = Object.freeze({ h })
  void ns
}
`,
  },
  {
    id: "a return statement",
    longhand: `import { getHandler } from "./foreign.ts"
export function f(): { readonly handler: (name: string) => void } {
  const handler = getHandler()
  return { handler: handler }
}
`,
    shorthand: `import { getHandler } from "./foreign.ts"
export function f(): { readonly handler: (name: string) => void } {
  const handler = getHandler()
  return { handler }
}
`,
  },
  {
    id: "a mutable alias",
    longhand: `import { getHandler } from "./foreign.ts"
export function f(): void {
  const handler = getHandler()
  let ns = { handler: handler }
  ns = { handler: handler }
  void ns
}
`,
    shorthand: `import { getHandler } from "./foreign.ts"
export function f(): void {
  const handler = getHandler()
  let ns = { handler }
  ns = { handler }
  void ns
}
`,
  },
  {
    id: "a module-scope frozen namespace",
    longhand: `import { getHandler } from "./foreign.ts"
const handler = getHandler()
export const NS = Object.freeze({ handler: handler })
`,
    shorthand: `import { getHandler } from "./foreign.ts"
const handler = getHandler()
export const NS = Object.freeze({ handler })
`,
  },
  {
    id: "a directly imported callable",
    longhand: `import { getHandler } from "./foreign.ts"
export function f(): void {
  const ns = Object.freeze({ getHandler: getHandler })
  void ns
}
`,
    shorthand: `import { getHandler } from "./foreign.ts"
export function f(): void {
  const ns = Object.freeze({ getHandler })
  void ns
}
`,
  },
  {
    id: "a renamed import",
    longhand: `import { getHandler as make } from "./foreign.ts"
export function f(): void {
  const ns = Object.freeze({ make: make })
  void ns
}
`,
    shorthand: `import { getHandler as make } from "./foreign.ts"
export function f(): void {
  const ns = Object.freeze({ make })
  void ns
}
`,
  },
  {
    id: "a namespace import",
    longhand: `import * as foreign from "./foreign.ts"
export function f(): void {
  const ns = Object.freeze({ foreign: foreign })
  void ns
}
`,
    shorthand: `import * as foreign from "./foreign.ts"
export function f(): void {
  const ns = Object.freeze({ foreign })
  void ns
}
`,
  },
  {
    id: "a foreign object that is not callable",
    longhand: `import { getRecord } from "./foreign.ts"
export function f(): void {
  const record = getRecord()
  const ns = Object.freeze({ record: record })
  void ns
}
`,
    shorthand: `import { getRecord } from "./foreign.ts"
export function f(): void {
  const record = getRecord()
  const ns = Object.freeze({ record })
  void ns
}
`,
  },
];

describe("a shorthand property decides exactly what its longhand twin decides", () => {
  for (const pair of PAIRS) {
    test(`${pair.id}: shorthand and longhand agree, and both refuse`, () => {
      const longhand = compile(pair.longhand);
      const shorthand = compile(pair.shorthand);
      expect(shorthand.codes).toEqual(longhand.codes);
      // Without this the pair would also be satisfied by accepting both.
      expect(shorthand.codes.some((code) => code.startsWith("SMITHERS1508@"))).toBe(true);
      expect(shorthand.emitted).toBe(0);
    });
  }
});

describe("the shorthands that must stay accepted", () => {
  const ACCEPTED: readonly { readonly id: string; readonly source: string }[] = [
    {
      id: "a number",
      source: `export function f(): void {
  const count = 1
  const ns = Object.freeze({ count })
  void ns
}
`,
    },
    {
      id: "an owned function declaration",
      source: `function own(name: string): void { void name }
export function f(): void {
  const ns = Object.freeze({ own })
  void ns
}
`,
    },
    {
      id: "an owned arrow",
      source: `export function f(): void {
  const own = (name: string): void => { void name }
  const ns = Object.freeze({ own })
  void ns
}
`,
    },
    {
      id: "an owned object",
      source: `export function f(): void {
  const own = { a: 1 }
  const ns = Object.freeze({ own })
  void ns
}
`,
    },
    {
      id: "the result of an owned factory",
      source: `function make(): (name: string) => void { return (name) => { void name } }
export function f(): void {
  const own = make()
  const ns = Object.freeze({ own })
  void ns
}
`,
    },
    {
      id: "a foreign PRIMITIVE, which cannot execute",
      source: `import { VERSION } from "./foreign.ts"
export function f(): void {
  const ns = Object.freeze({ VERSION })
  void ns
}
`,
    },
    {
      id: "owned callbacks handed to a TRUSTED binding",
      source: `import { register } from "./foreign.ts"
export function f(sink: string[]): void {
  const handler = (name: string): void => { sink.push(name) }
  register({ handler })
}
`,
    },
    {
      id: "an owned object returned in shorthand",
      source: `export function f(): { readonly own: { readonly a: number } } {
  const own = { a: 1 }
  return { own }
}
`,
    },
    {
      id: "the PLAIN member destructured out of an object that also holds a foreign callable",
      source: `import { getHandler } from "./foreign.ts"
export function f(): void {
  const handler = getHandler()
  const src = { handler: handler, plain: 1 }
  const { plain } = src
  const ns = Object.freeze({ plain })
  void ns
}
`,
    },
  ];

  for (const accepted of ACCEPTED) {
    test(`${accepted.id} is accepted with an empty row`, () => {
      const compiled = compile(accepted.source);
      expect(compiled.codes).toEqual([]);
      expect(compiled.emitted).toBe(0);
      expect(compiled.rows["f"]).toEqual({ failures: [], requirements: [] });
    });
  }
});

describe("the neighbouring rules are untouched", () => {
  test("an UNTRUSTED host still refuses the shorthand at the same position as the longhand", () => {
    const longhand = compile(`import { getHandler, registerUnsafe } from "./foreign.ts"
export function f(): void {
  const handler = getHandler()
  registerUnsafe({ handler: handler })
}
`);
    const shorthand = compile(`import { getHandler, registerUnsafe } from "./foreign.ts"
export function f(): void {
  const handler = getHandler()
  registerUnsafe({ handler })
}
`);
    expect(longhand.codes).toEqual(["SMITHERS1101@2:1", "SMITHERS1301@4:3", "SMITHERS1509@4:18"]);
    expect(shorthand.codes).toEqual(longhand.codes);
  });

  test("an owned callback into an untrusted host is still SMITHERS1509, shorthand or not", () => {
    expect(compile(`import { registerUnsafe } from "./foreign.ts"
export function f(sink: string[]): void {
  const handler = (name: string): void => { sink.push(name) }
  registerUnsafe({ handler })
}
`).codes).toEqual(["SMITHERS1101@2:1", "SMITHERS1301@4:3", "SMITHERS1509@4:18"]);
  });

  test("a shorthand METHOD that calls a foreign callable is still the callback rule, not this one", () => {
    // The method is a Smithers-owned closure, so nothing foreign escapes; what
    // is charged is the checked panic channel of the call inside its body.
    expect(compile(`import { getHandler } from "./foreign.ts"
export function f(): void {
  const handler = getHandler()
  const ns = Object.freeze({ run(name: string): void { handler(name) } })
  void ns
}
`).codes).toEqual(["SMITHERS1301@4:56"]);
  });
});

/**
 * The same rewrite, one rule over.
 *
 * `checkHostGlobals` skipped every identifier `isDeclarationName` claimed, and
 * a `ShorthandPropertyAssignment`'s `name` IS its own reference — so
 * `Object.freeze({ process })` was accepted, and the value read back out of it
 * worked. `ambientAuthorityUses` had already carved the shorthand back out for
 * the `Date`/`Math`/`performance`/`crypto` rule and the SMITHERS1601 branch had
 * not, which is why `{ Date }` was refused and `{ process }` was not.
 */
describe("ambient authority cannot be laundered through a shorthand property either", () => {
  const AMBIENT: readonly { readonly id: string; readonly longhand: string; readonly shorthand: string; readonly code: string }[] = [
    {
      id: "process",
      longhand: `export function f(): void {
  const ns = Object.freeze({ process: process })
  void ns
}
`,
      shorthand: `export function f(): void {
  const ns = Object.freeze({ process })
  void ns
}
`,
      code: "SMITHERS1601",
    },
    {
      id: "setTimeout",
      longhand: `export function f(): void {
  const ns = Object.freeze({ setTimeout: setTimeout })
  void ns
}
`,
      shorthand: `export function f(): void {
  const ns = Object.freeze({ setTimeout })
  void ns
}
`,
      code: "SMITHERS1601",
    },
  ];

  for (const ambient of AMBIENT) {
    test(`${ambient.id} in a shorthand is refused, exactly as its longhand is`, () => {
      const longhand = compile(ambient.longhand);
      const shorthand = compile(ambient.shorthand);
      expect(longhand.codes.map((entry) => entry.split("@")[0])).toEqual([ambient.code]);
      expect(shorthand.codes.map((entry) => entry.split("@")[0])).toEqual([ambient.code]);
    });
  }

  test("the value read back out of the shorthand is refused at the shorthand", () => {
    expect(compile(`export function f(): string {
  const ns = { process }
  return \`\${ns.process.platform}\`
}
`).codes).toEqual(["SMITHERS1601@2:16"]);
  });

  test("Date in a shorthand keeps its own capability rule, unchanged", () => {
    // This branch already carved the shorthand out, so it is the control that
    // proves the fix did not have to invent the behaviour it produced.
    expect(compile(`export function f(): void {
  const ns = Object.freeze({ Date })
  void ns
}
`).codes).toEqual(["SMITHERS1602@2:30"]);
  });

  test("an OWNED binding that merely shares the name is still ordinary", () => {
    for (const source of [
      `export function f(): void {
  const process = 1
  const ns = Object.freeze({ process })
  void ns
}
`,
      `export function f(): void {
  const setTimeout = 1
  const ns = Object.freeze({ setTimeout })
  void ns
}
`,
    ]) {
      expect(compile(source).codes).toEqual([]);
    }
  });

  test("an ordinary property NAME spelled like a host global is still a name", () => {
    // `{ process: 1 }` declares a property; nothing reads the global. The
    // carve-out is for the shorthand only.
    expect(compile(`export function f(): void {
  const ns = Object.freeze({ process: 1, setTimeout: 2 })
  void ns
}
`).codes).toEqual([]);
  });

  test("a declaration actually named after a host global is still a declaration", () => {
    expect(compile(`function process(value: string): string { return value }
export function f(): string {
  return process("x")
}
`).codes).toEqual([]);
  });
});
