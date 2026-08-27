import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { analyzeProject, compileProject } from "./index.ts";

/**
 * Totality of the Error HERITAGE WALK over every receiver an ordinary program
 * can hand it.
 *
 * `isErrorType` decides the whole failure channel: which `throw` is a
 * recoverable Error (`SMITHERS1103`), which `.match()` is the compiler's
 * `Error.match` and gets exhaustiveness-checked (`SMITHERS1251`/`1253`/`1254`),
 * and which declared row constituent covers an instantiated template
 * (`SMITHERS1806`). It answers by climbing base types, and it climbed them with
 * `checker.getBaseTypes(type as ts.InterfaceType)` behind nothing but
 * `type.flags & Object`.
 *
 * That test is not the API's precondition. `getBaseTypes` handles a tuple, then
 * a symbol flagged `Class` or `Interface`, and for anything else it executes
 * `Debug.fail("type must be class or interface")`; it also reaches
 * `type.symbol.flags` unguarded, so a type with NO symbol throws a TypeError
 * from the same line. `Object` covers far more than that: an object literal, a
 * `type X = { … }` alias, a mapped `Record`, an anonymous function type, an
 * `Object.freeze` result, a `satisfies` expression, a `Proxy`, an instantiated
 * type parameter, and a tuple *reference* are all `Object` and none is a class
 * or an interface.
 *
 * So ordinary programs took the compiler down. `throw { a: 1 }` and a plain
 * `const own = { match: () => "m" }` followed by `own.match()` both escaped as
 * an unhandled throw out of the checker, which the CLI can only surface as a
 * code-less, position-less `SMITHERS_PROJECT_ERROR` — no diagnostic, no
 * position, nothing an author can act on. `throw [1] as const` produced the
 * TypeError variant. The Go fork compiled all of them correctly, so the
 * reference frontend was the divergent one.
 *
 * TWO independent walks had each been taught the same insufficient `Object`
 * test — `isErrorType` and `nominalAncestryNames` — which is why the
 * precondition now lives at one shared `baseTypesOf` helper instead of at each
 * call site. Both are exercised below.
 *
 * The negative half is the load-bearing half. Declining to climb a receiver
 * that has no heritage is one edit away from declining to climb the ones that
 * do, so every genuine rule this walk feeds is asserted to keep firing: a real
 * `Result` receiver is still exhaustiveness-checked and still RUNS, an Error
 * subclass still reaches `SMITHERS1251`/`1253`/`1254`/`1255`, retired
 * `.unwrap()` is still `SMITHERS1206`, and every non-Error throw is still
 * `SMITHERS1103` rather than silently accepted.
 */

const RUNTIME = `${import.meta.dir}/../runtime/index.ts`;

function analyze(source: string, name: string) {
  return analyzeProject([{ fileName: "main.sm", source }], {
    rootDir: `/virtual/error-heritage-${name}`,
  });
}

function codes(analysis: ReturnType<typeof analyzeProject>): readonly string[] {
  return analysis.diagnostics.filter((diagnostic) => diagnostic.severity === "error")
    .map((diagnostic) => diagnostic.code).sort();
}

/** Lower one module, transpile it, and import the result. */
async function execute(source: string, name: string) {
  const root = await mkdtemp(join(tmpdir(), `smithers-error-heritage-${name}-`));
  try {
    const compiled = compileProject([{ fileName: "main.sm", source }], {
      rootDir: root,
      outDir: root,
      outputExtension: ".mjs",
      sourceMap: false,
      runtimeImport: pathToFileURL(RUNTIME).href,
    });
    expect(compiled.diagnostics).toEqual([]);
    const transpiler = new Bun.Transpiler({ loader: "ts", target: "bun" });
    const file = compiled.files["main.sm"]!;
    await writeFile(file.outputFileName, transpiler.transformSync(file.code));
    return await import(pathToFileURL(file.outputFileName).href) as Record<string, any>;
  } finally {
    await rm(root, { recursive: true });
  }
}

/**
 * One `match`-owning receiver per shape the checker can produce. Every one of
 * these is a user's OWN `match`, never the compiler's, so every one must be
 * accepted — and before the shared precondition, all but the class, the
 * interface and the two non-`Object` shapes crashed the compiler.
 */
const MATCH_RECEIVERS: Readonly<Record<string, string>> = {
  objectLiteral: `const own = { match: () => "m" }`,
  asConst: `const own = { match: () => "m" } as const`,
  typeAlias: `type T = { match(): string }\nconst own: T = { match: () => "m" }`,
  interfaceTyped: `interface I { match(): string }\nconst own: I = { match: () => "m" }`,
  classInstance: `class C { match(): string { return "m" } }\nconst own = new C()`,
  unionOfLiterals: `const flag: boolean = true\nconst own = flag ? { match: () => "a" } : { match: () => "b" }`,
  intersection: `interface A { a: number }\ntype T = A & { match(): string }\nconst own = { a: 1, match: () => "m" } as T`,
  anyCast: `const own = JSON.parse("{}") as any`,
  castThroughUnknown: `const own = null as unknown as { match(): string }`,
  mappedRecord: `const own: Record<"match", () => string> = { match: () => "m" }`,
  callableWithProperty: `type F = { (): string; match(): string }\nconst own = Object.assign(() => "f", { match: () => "m" }) as F`,
  arrayIntersection: `type T = string[] & { match(): string }\nconst own = Object.assign(["a"], { match: () => "m" }) as T`,
  proxy: `const own = new Proxy({ match: () => "m" }, {})`,
  instantiatedTypeParameter: `function pick<T extends { match(): string }>(v: T): T { return v }\nconst own = pick({ match: () => "m" })`,
  satisfiesWrapped: `type T = { match(): string }\nconst own = { match: () => "m" } satisfies T`,
  frozen: `const own = Object.freeze({ match: () => "m" })`,
  getter: `const own = { get match(): () => string { return () => "m" } }`,
};

/** Every static spelling `memberSelection` recognizes reaches the same walk. */
const MATCH_SPELLINGS: Readonly<Record<string, string>> = {
  dot: `own.match()`,
  stringIndex: `own["match"]()`,
  constKey: `own[KEY]()`,
  parenthesizedReceiver: `(own).match()`,
  parenthesizedCallee: `(own.match)()`,
  optionalChain: `own?.match()`,
};

describe("the Error heritage walk is total over every receiver shape", () => {
  test("a user's own .match() compiles on every receiver kind", () => {
    for (const [name, declaration] of Object.entries(MATCH_RECEIVERS)) {
      const analysis = analyze(
        `const KEY = "match" as const\nexport function main(): string {\n${declaration}\n  return String(own.match()) + KEY\n}\n`,
        name,
      );
      expect({ [name]: codes(analysis) }).toEqual({ [name]: [] });
    }
  });

  test("every static member spelling of a user's own .match() compiles", () => {
    for (const [name, call] of Object.entries(MATCH_SPELLINGS)) {
      const analysis = analyze(
        `const KEY = "match" as const\nexport function main(): string {\n  const own = { match: () => "m" }\n  return String(${call})\n}\n`,
        name,
      );
      expect({ [name]: codes(analysis) }).toEqual({ [name]: [] });
    }
  });

  test("a non-Error throw of any shape is SMITHERS1103, never an unhandled failure", () => {
    // Each entry is `Object`-flagged or otherwise reached the walk. The verdict
    // is a POSITIONED diagnostic in every cell: the walk declining to climb a
    // shape without heritage is what lets the ordinary rule reach its answer.
    const operands: Readonly<Record<string, string>> = {
      objectLiteral: `{ a: 1 }`,
      asConstObject: `{ a: 1 } as const`,
      tupleAsConst: `[1] as const`,
      arrayLiteral: `[1]`,
      arrow: `() => 1`,
      functionExpression: `function () { return 1 }`,
      frozen: `Object.freeze({ a: 1 })`,
      proxy: `new Proxy({ a: 1 }, {})`,
      getterObject: `{ get a(): number { return 1 } }`,
      regexp: `/x/`,
      symbol: `Symbol("x")`,
      map: `new Map()`,
      anonymousClassInstance: `new (class { a = 1 })()`,
      string: `"x"`,
      nullLiteral: `null`,
      undefinedLiteral: `undefined`,
    };
    for (const [name, operand] of Object.entries(operands)) {
      const analysis = analyze(`export function main(): string { throw ${operand} }\n`, name);
      expect({ [name]: codes(analysis) }).toEqual({ [name]: ["SMITHERS1103"] });
      const reported = analysis.diagnostics.find((diagnostic) => diagnostic.code === "SMITHERS1103");
      expect({ [name]: reported?.line }).toEqual({ [name]: 1 });
    }
  });

  test("a named, aliased, mapped, or generic throw operand is still SMITHERS1103", () => {
    const cases: Readonly<Record<string, string>> = {
      typeAliasValue: `type T = { a: number }\nexport function main(): string { const e: T = { a: 1 }\n  throw e }`,
      interfaceValue: `interface I { a: number }\nexport function main(): string { const e: I = { a: 1 }\n  throw e }`,
      indexedAccess: `type Box = { inner: { a: number } }\nexport function main(): string { const e: Box["inner"] = { a: 1 }\n  throw e }`,
      record: `export function main(): string { const e: Record<string, number> = {}\n  throw e }`,
      castThroughUnknown: `export function main(): string { const e = null as unknown as { a: number }\n  throw e }`,
      unionOfLiterals: `export function main(): string { const f: boolean = true\n  throw f ? { a: 1 } : { b: 2 } }`,
      readonlyTuple: `export function main(): string { const e: readonly [number] = [1]\n  throw e }`,
      namedTuple: `type T = [a: number]\nexport function main(): string { const e: T = [1]\n  throw e }`,
      typeParameter: `export function main<T extends { a: number }>(v: T): string { throw v }`,
      satisfies: `type T = { a: number }\nexport function main(): string { throw { a: 1 } satisfies T }`,
      nestedArrow: `export function main(): string {\n  const g = () => { throw { a: 1 } }\n  g()\n  return "x"\n}`,
      classMethod: `class K { m(): string { throw { a: 1 } } }\nexport function main(): string { return new K().m() }`,
    };
    for (const [name, source] of Object.entries(cases)) {
      expect({ [name]: codes(analyze(source, name)) }).toEqual({ [name]: ["SMITHERS1103"] });
    }
  });

  test("a structurally Error-shaped row constituent is walked without failing", () => {
    // The SECOND walk, `nominalAncestryNames`. `E extends Error` is a
    // STRUCTURAL constraint, so a `{ name, message }` type alias satisfies it
    // and reaches the ancestry climb as an anonymous object type — a shape with
    // no heritage to read, from a template instantiation that must still get an
    // ordinary verdict.
    const library = `
      export class Timeout extends Error {}
      export function attempt<A, E extends Error>(
        limit: number,
        operation: () => Result<A, E>,
      ): Result<A, E | Timeout> {
        if (limit <= 0) throw new Timeout()
        return operation()!
      }
    `;
    const consumer = `
      import { attempt, Timeout } from "./library.sm"
      type FakeErr = { name: string; message: string }
      export function main(): Result<number, FakeErr | Timeout> {
        return attempt<number, FakeErr>(1, (): Result<number, FakeErr> => { throw { name: "n", message: "m" } })!
      }
    `;
    const analysis = analyzeProject([
      { fileName: "library.sm", source: library },
      { fileName: "consumer.sm", source: consumer },
    ], { rootDir: "/virtual/error-heritage-structural" });
    // The structural alias is not a nominal Error, so the throw inside the
    // callback is refused by the ordinary rule. What matters is that a
    // POSITIONED diagnostic is what comes back at all.
    expect(codes(analysis)).toEqual(["SMITHERS1103"]);
    expect(analysis.diagnostics.every((diagnostic) => diagnostic.line > 0)).toBe(true);
  });

  test("a nominal row template still instantiates clean", () => {
    const library = `
      export class Timeout extends Error {}
      export function attempt<A, E extends Error>(
        limit: number,
        operation: () => Result<A, E>,
      ): Result<A, E | Timeout> {
        if (limit <= 0) throw new Timeout()
        return operation()!
      }
    `;
    const consumer = `
      import { attempt, Timeout } from "./library.sm"
      export class Missing extends Error {}
      export function main(): Result<number, Missing | Timeout> {
        return attempt<number, Missing>(1, (): Result<number, Missing> => { throw new Missing() })!
      }
    `;
    const analysis = analyzeProject([
      { fileName: "library.sm", source: library },
      { fileName: "consumer.sm", source: consumer },
    ], { rootDir: "/virtual/error-heritage-nominal" });
    expect(codes(analysis)).toEqual([]);
  });
});

describe("the genuine Error and Result rules the walk feeds still fire", () => {
  const ERRORS = `export class A extends Error {}\nexport class B extends Error {}\nexport class C extends Error {}\n`;

  test("Error.match keeps its object-literal, exhaustiveness, and fallback rules", () => {
    const cases: Readonly<Record<string, { source: string; expected: readonly string[] }>> = {
      exhaustive: {
        source: `export function main(): string {\n  const e: A | B = new A()\n  return e.match({ A: () => "a", B: () => "b" })\n}`,
        expected: [],
      },
      missingCase: {
        source: `export function main(): string {\n  const e: A | B = new A()\n  return e.match({ A: () => "a" })\n}`,
        expected: ["SMITHERS1253"],
      },
      extraCase: {
        source: `export function main(): string {\n  const e: A = new A()\n  return e.match({ A: () => "a", C: () => "c" })\n}`,
        expected: ["SMITHERS1254"],
      },
      nonLiteralHandlers: {
        source: `const H = { A: () => "a" }\nexport function main(): string {\n  const e: A = new A()\n  return e.match(H)\n}`,
        expected: ["SMITHERS1251"],
      },
      partialWithoutFallback: {
        source: `export function main(): string {\n  const e: A | B = new A()\n  return e.matchPartial({ A: () => "a" })\n}`,
        expected: ["SMITHERS1255"],
      },
    };
    for (const [name, { source, expected }] of Object.entries(cases)) {
      expect({ [name]: codes(analyze(ERRORS + source, name)) }).toEqual({ [name]: expected });
    }
  });

  test("an Error subclass carrying its own match() still reaches the Error.match rule", () => {
    // The receiver precondition is nominal, not spelled: an Error subclass is a
    // class and the walk climbs it, so this stays the compiler's rule.
    const analysis = analyze(
      `class E extends Error { match(): string { return "m" } }\nexport function main(): string {\n  return new E().match()\n}\n`,
      "error-subclass-match",
    );
    expect(codes(analysis)).toEqual(["SMITHERS1251"]);
  });

  test("retired Result.unwrap() is still SMITHERS1206", () => {
    const analysis = analyze(
      `export class Missing extends Error {}\nexport function lookup(k: string): Result<number, Missing> {\n  if (k === "") throw new Missing()\n  return 1\n}\nexport function main(): Result<number, Missing> { return lookup("a").unwrap() }\n`,
      "retired-unwrap",
    );
    expect(codes(analysis)).toEqual(["SMITHERS1206"]);
  });

  test("a user's own .match() executes, and a real Result.match still selects both variants", async () => {
    const module = await execute(
      `export class Missing extends Error {}
export function lookup(k: string): Result<number, Missing> {
  if (k === "") throw new Missing()
  return 7
}
export function own(): string {
  const literal = { match: () => "literal" }
  const aliased: { match(): string } = { match: () => "aliased" }
  const frozen = Object.freeze({ match: () => "frozen" })
  const KEY = "match" as const
  return [literal.match(), aliased["match"](), frozen[KEY](), (literal).match(), (literal.match)()].join("|")
}
export function success(): string {
  return lookup("a").match({ ok: (value) => "ok:" + String(value), error: () => "err" })
}
export function failure(): string {
  return lookup("").match({ ok: (value) => "ok:" + String(value), error: (error) => "err:" + error.constructor.name })
}
`,
      "execution",
    );
    expect(module.own()).toBe("literal|aliased|frozen|literal|literal");
    expect(module.success()).toBe("ok:7");
    expect(module.failure()).toBe("err:Missing");
  });
});
