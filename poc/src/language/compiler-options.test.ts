/**
 * The `tsconfig.json` gate, and the `!`-on-a-widened-index rule the mandatory
 * half of that gate forced.
 *
 * THREE SOURCES DISAGREED, and this file is where they were made to agree.
 * compatibility.mdx §Mandatory requires `noUncheckedIndexedAccess`; the `!`
 * provenance walk refused a `Result<A, E> | undefined`; and compatibility.mdx's
 * own worked example asserted a third thing — that `arr[i]!` "compiles only when
 * `arr` holds Results". Measured on 2026-08-28 against the code as it stood:
 *
 *   * the option was OFF in every checker literal, so `arr[i]!` compiled only
 *     because the mandated option was not enforced;
 *   * turning it on moved 2 of 515 conformance cases, both with
 *     `SMITHERS1207 postfix ! requires a Result operand` at an index read of a
 *     `Result` array — the specification's own example, refused;
 *   * `const v: number = arr[2]` and `const o: { a?: number } = { a: undefined }`
 *     both checked clean while the control `const v: number = "str"` reported
 *     `TS2322`, which is the measurement §Configuration's status paragraph
 *     recorded.
 *
 * The refusal was the wrong one of the three. The value at `results[i]` IS a
 * Result, widened by the option the specification itself mandates. The absence
 * axis is untouched: a `Result<A, E> | undefined` the AUTHOR wrote is still not
 * a `!` operand, and the two are told apart by the container's index type, which
 * the option does not widen.
 */
import { describe, expect, test } from "bun:test";
import { analyzeProject } from "./index.ts";
import {
  FORBIDDEN_COMPILER_OPTIONS,
  MANDATORY_CHECKER_OPTIONS,
  MANDATORY_COMPILER_OPTIONS,
  validateSmithersTsconfig,
} from "./compiler-options.ts";

const HEAD = `export class Missing extends Error {
  constructor(readonly key: string) { super(\`no entry for \${key}\`) }
}

function lookup(key: string): Result<string, Missing> {
  if (key !== "ada") throw new Missing(key)
  return "Ada Lovelace"
}
`;

function codes(body: string): string[] {
  const analysis = analyzeProject([{ fileName: "/project/main.sm", source: HEAD + body }]);
  return analysis.diagnostics.map((diagnostic) => `${diagnostic.code}@${diagnostic.line}:${diagnostic.column}`);
}

describe("the mandatory option table is the one the specification publishes", () => {
  // A table drifting from compatibility.mdx is the failure this gate exists to
  // stop, so the members are named here rather than derived from the constant.
  test("§Mandatory is exactly the six options", () => {
    expect([...MANDATORY_COMPILER_OPTIONS]).toEqual([
      "strict",
      "noUncheckedIndexedAccess",
      "exactOptionalPropertyTypes",
      "isolatedModules",
      "verbatimModuleSyntax",
      "useDefineForClassFields",
    ]);
  });

  test("§Forbidden is exactly the eleven options", () => {
    expect([...FORBIDDEN_COMPILER_OPTIONS]).toEqual([
      "keyofStringsOnly",
      "suppressImplicitAnyIndexErrors",
      "suppressExcessPropertyErrors",
      "noStrictGenericChecks",
      "noImplicitUseStrict",
      "out",
      "charset",
      "importsNotUsedAsValues",
      "preserveValueImports",
      "experimentalDecorators",
      "emitDecoratorMetadata",
    ]);
  });

  // The checker input and the table are one fact. Before this constant the
  // product set `strict: true` and nothing else, in five literals that had
  // already drifted from one another.
  test("every mandatory option is set in the checker input", () => {
    for (const name of MANDATORY_COMPILER_OPTIONS) {
      expect(MANDATORY_CHECKER_OPTIONS[name as keyof typeof MANDATORY_CHECKER_OPTIONS]).toBe(true);
    }
  });
});

describe("validateSmithersTsconfig reports a code and a span", () => {
  const conforming = `{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "useDefineForClassFields": true
  }
}
`;

  test("a conforming tsconfig reports nothing", () => {
    expect(validateSmithersTsconfig("/project/tsconfig.json", conforming)).toEqual([]);
  });

  test("a missing mandatory option is SMITHERS6001 at the compilerOptions object", () => {
    const text = conforming.replace('    "noUncheckedIndexedAccess": true,\n', "");
    const found = validateSmithersTsconfig("/project/tsconfig.json", text);
    expect(found.map((item) => item.code)).toEqual(["SMITHERS6001"]);
    expect(found[0]!.message).toBe("a Smithers project MUST set 'noUncheckedIndexedAccess: true'");
    // The span is the object that should have contained it, so an editor can
    // put the fix where the fix goes.
    expect(text.slice(found[0]!.start, found[0]!.start + 1)).toBe("{");
    expect(found[0]!.line).toBe(2);
  });

  // The direction that used to be impossible to state at all: `strict: false`
  // was honored by the Go bridge and unrepresented in the reference.
  test("a mandatory option set to false is SMITHERS6001 at the option", () => {
    const text = conforming.replace('"strict": true', '"strict": false');
    const found = validateSmithersTsconfig("/project/tsconfig.json", text);
    expect(found.map((item) => item.code)).toEqual(["SMITHERS6001"]);
    expect(text.slice(found[0]!.start, found[0]!.start + found[0]!.length)).toBe('"strict": false');
  });

  test("every forbidden option is SMITHERS6002 at the option name", () => {
    for (const name of FORBIDDEN_COMPILER_OPTIONS) {
      const text = conforming.replace('"strict": true,', `"strict": true,\n    "${name}": true,`);
      const found = validateSmithersTsconfig("/project/tsconfig.json", text);
      expect(found.map((item) => item.code)).toEqual(["SMITHERS6002"]);
      expect(text.slice(found[0]!.start, found[0]!.start + found[0]!.length)).toBe(`"${name}"`);
    }
  });

  // §Forbidden says a deprecated option "MUST be rejected rather than ignored",
  // and a value of `false` is still the option appearing in the configuration.
  test("a forbidden option set to false is still SMITHERS6002", () => {
    const text = conforming.replace('"strict": true,', '"strict": true,\n    "experimentalDecorators": false,');
    expect(validateSmithersTsconfig("/project/tsconfig.json", text).map((item) => item.code))
      .toEqual(["SMITHERS6002"]);
  });

  test("an unclassified option is SMITHERS6003 at the option name", () => {
    const text = conforming.replace('"strict": true,', '"strict": true,\n    "notAnOption": true,');
    const found = validateSmithersTsconfig("/project/tsconfig.json", text);
    expect(found.map((item) => item.code)).toEqual(["SMITHERS6003"]);
    expect(text.slice(found[0]!.start, found[0]!.start + found[0]!.length)).toBe('"notAnOption"');
  });

  // §Emit-Scoped options "MAY differ by JavaScript host", so naming one is not
  // an error. This is the row that keeps SMITHERS6003 from being a blanket ban.
  test("an emit-scoped option is accepted", () => {
    const text = conforming.replace('"strict": true,', '"strict": true,\n    "target": "ES2022",\n    "lib": ["ESNext"],');
    expect(validateSmithersTsconfig("/project/tsconfig.json", text)).toEqual([]);
  });

  test("a tsconfig with no compilerOptions charges every mandatory option", () => {
    const found = validateSmithersTsconfig("/project/tsconfig.json", `{ "include": ["src"] }\n`);
    expect(found.map((item) => item.code)).toEqual(MANDATORY_COMPILER_OPTIONS.map(() => "SMITHERS6001"));
  });
});

/**
 * The rule that resolved the contradiction, as the four containers that carry
 * the distinction.
 *
 * A table of type-PRESERVING spellings would be vacuous here: every row would
 * pass under both the old rule and the new one. The rows that carry the
 * distinction are the ones where the container's INDEX type and the ACCESS type
 * disagree, which is exactly what `noUncheckedIndexedAccess` creates.
 */
describe("postfix ! on an index read", () => {
  test("a Result array compiles — the specification's own worked example", () => {
    expect(codes(`
export function main(i: number): Result<string, Missing> {
  const found: Result<string, Missing>[] = [lookup("ada")]
  return found[i]!
}
`)).toEqual([]);
  });

  test("a Result array indexed straight off the call compiles", () => {
    expect(codes(`
function pack(): readonly Result<string, Missing>[] { return [lookup("ada")] }
export function main(): Result<string, Missing> {
  return pack()[0]!
}
`)).toEqual([]);
  });

  // The absence axis. The author admitted `undefined` into the ELEMENT type, so
  // the index read's `| undefined` is theirs and `!` — the error axis — is not
  // the operator that removes it. `?.`/`??` are.
  test("an array whose element type is itself optional is refused", () => {
    expect(codes(`
export function main(i: number): Result<string, Missing> {
  const found: (Result<string, Missing> | undefined)[] = [lookup("ada")]
  return found[i]!
}
`)).toEqual(["SMITHERS1207@12:10"]);
  });

  test("a non-Result array is refused for the ordinary reason", () => {
    expect(codes(`
export function main(i: number): Result<string, Missing> {
  const names: string[] = ["ada"]
  const n = names[i]!
  return n
}
`)).toEqual(["SMITHERS1207@12:13"]);
  });

  // The row that decides HOW the widening is undone. Narrowing the ACCESS type
  // keeps these two apart; substituting the container's index type would have
  // collapsed both to `Result<string, Missing> | string` and accepted neither.
  test("a heterogeneous tuple accepts the Result slot and refuses the other", () => {
    expect(codes(`
export function main(): Result<string, Missing> {
  const pair: [Result<string, Missing>, string] = [lookup("ada"), "x"]
  return pair[0]!
}
`)).toEqual([]);
    expect(codes(`
export function main(): Result<string, Missing> {
  const pair: [Result<string, Missing>, string] = [lookup("ada"), "x"]
  const s = pair[1]!
  return s
}
`)).toContain("SMITHERS1207@12:13");
  });

  test("a string-indexed record of Results compiles", () => {
    expect(codes(`
export function main(k: string): Result<string, Missing> {
  const bag: Record<string, Result<string, Missing>> = { ada: lookup("ada") }
  return bag[k]!
}
`)).toEqual([]);
  });

  // The guard that proves the rule did not become "strip `| undefined` from
  // every operand". This is not an index read at all.
  test("a plain optional binding is still refused", () => {
    expect(codes(`
export function main(): Result<string, Missing> {
  const maybe: string | undefined = "Ada"
  const name = maybe!
  return name
}
`)).toEqual(["SMITHERS1207@12:16"]);
  });
});
