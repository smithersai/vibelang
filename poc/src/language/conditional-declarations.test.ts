import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as ts from "typescript-js";
import { analyzeSource } from "./analyze.ts";
import { compileVibe } from "./compile.ts";
import { recoverVibeSyntax } from "./recover.ts";
import { checkEmittedTypeScript, compileAndCheckVibe } from "./validate.ts";

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_VALUE = new Map([...BASE64].map((character, index) => [character, index]));

function decodeVlq(text: string): readonly number[] {
  const values: number[] = [];
  let value = 0;
  let shift = 0;
  for (const character of text) {
    const digit = BASE64_VALUE.get(character)!;
    value += (digit & 31) * 2 ** shift;
    if ((digit & 32) !== 0) {
      shift += 5;
    } else {
      values.push((value & 1) === 1 ? -Math.floor(value / 2) : Math.floor(value / 2));
      value = 0;
      shift = 0;
    }
  }
  return values;
}

function lineColumnAt(text: string, offset: number): { readonly line: number; readonly column: number } {
  const prefix = text.slice(0, offset).split(/\r\n|[\n\r\u2028\u2029]/);
  return { line: prefix.length - 1, column: prefix.at(-1)!.length };
}

function mappedPosition(wire: string, generatedCode: string, generatedOffset: number):
  { readonly line: number; readonly column: number } | undefined {
  const map = JSON.parse(wire) as { sources: string[]; mappings: string };
  const generated = lineColumnAt(generatedCode, generatedOffset);
  let source = 0;
  let originalLine = 0;
  let originalColumn = 0;
  let selected: { source?: number; line?: number; column?: number } | undefined;
  for (const [line, encodedLine] of map.mappings.split(";").entries()) {
    let generatedColumn = 0;
    for (const encoded of encodedLine ? encodedLine.split(",") : []) {
      const values = decodeVlq(encoded);
      generatedColumn += values[0]!;
      const segment: { source?: number; line?: number; column?: number } = {};
      if (values.length > 1) {
        source += values[1]!;
        originalLine += values[2]!;
        originalColumn += values[3]!;
        segment.source = source;
        segment.line = originalLine;
        segment.column = originalColumn;
      }
      if (line === generated.line && generatedColumn <= generated.column) selected = segment;
    }
  }
  if (selected?.source === undefined) return undefined;
  return { line: selected.line!, column: selected.column! };
}

function compileConditional(source: string, name: string, runtimeImport = "../runtime/index.ts") {
  return compileVibe(source, {
    fileName: `${import.meta.dir}/${name}.vibe`,
    outputFileName: `${import.meta.dir}/${name}.generated.ts`,
    sourceName: `${name}.vibe`,
    runtimeImport,
    sourceMap: true,
  });
}

async function executeConditional(source: string, name: string) {
  const compiled = compileConditional(source, name);
  expect(compiled.analysis.diagnostics).toEqual([]);
  expect(checkEmittedTypeScript(compiled.code, `${import.meta.dir}/${name}.generated.ts`)
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))).toEqual([]);
  const executable = compileConditional(
    source,
    name,
    pathToFileURL(`${import.meta.dir}/../runtime/index.ts`).href,
  );
  const javascript = new Bun.Transpiler({ loader: "ts", target: "bun" }).transformSync(executable.code);
  const directory = await mkdtemp(join(tmpdir(), "vibe-conditional-declarations-"));
  try {
    const modulePath = join(directory, `${name}.mjs`);
    await writeFile(modulePath, javascript);
    return { compiled, module: await import(pathToFileURL(modulePath).href) as Record<string, any> };
  } finally {
    await rm(directory, { recursive: true });
  }
}

test("a conditional declaration scopes its binding to the whole construct and executes", async () => {
  const { compiled, module } = await executeConditional(`
    export const reads: string[] = []
    function cache(id: string): string | null {
      reads.push(id)
      return id === "" ? null : id.toUpperCase()
    }
    export function classify(id: string): string {
      if (const user = cache(id); user !== null) {
        return "found:" + user
      } else if (const fallback = cache(id + "?"); fallback !== null) {
        return "fallback:" + fallback + ":" + String(user)
      } else {
        return "missing"
      }
    }
  `, "conditional-basic");

  // The binding is visible in the then branch, in every else branch, and the
  // whole chain evaluates the initializer exactly once.
  expect(module.classify("a")).toBe("found:A");
  expect(module.reads).toEqual(["a"]);
  module.reads.length = 0;
  expect(module.classify("")).toBe("fallback:?:null");
  expect(module.reads).toEqual(["", "?"]);

  // The rewrite is a scoped block, not a hoist into the enclosing scope.
  expect(compiled.code).toContain("const user = cache(id);");
  expect(compiled.code).toContain("const fallback = cache(id + \"?\");");
});

test("the binding does not escape the construct", () => {
  const source = `declare function cache(id: string): string | null
export function classify(id: string): string {
  if (const user = cache(id); user !== null) { return user }
  return user ?? "none"
}
`;
  // Analysis itself is clean, and the scoping is enforced by the acceptance
  // rule: the generated program has no such binding after the construct.
  const checked = compileAndCheckVibe(source, {
    fileName: `${import.meta.dir}/conditional-escape.vibe`,
    outputFileName: `${import.meta.dir}/conditional-escape.generated.ts`,
    sourceName: "conditional-escape.vibe",
    runtimeImport: "../runtime/index.ts",
    sourceMap: false,
  });
  expect(checked.ok).toBe(false);
  expect(checked.emitDiagnostics.map((diagnostic) =>
    ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))).toEqual(["Cannot find name 'user'."]);
});

test("a conditional declaration composes with Result unwrap lowering", () => {
  const compiled = compileConditional(`class Missing extends Error {}
function lookup(id: string): Result<string, Missing> {
  if (id === "") throw new Missing()
  return id
}
export function run(id: string): Result<string, Missing> {
  if (const found = lookup(id).unwrap(); found.length > 2) {
    return found.toUpperCase()
  } else {
    return found
  }
}
`, "conditional-unwrap");
  expect(compiled.analysis.diagnostics).toEqual([]);
  expect(compiled.analysis.rows.run).toEqual({ failures: ["Missing"], requirements: [] });
  // The moved declaration is an ordinary statement-safe unwrap host.
  expect(compiled.code).toContain("__vsInspectResult(lookup(id))");
  expect(compiled.code).toContain("const found = __vibe_result_1.value;");
  expect(checkEmittedTypeScript(compiled.code, `${import.meta.dir}/conditional-unwrap.generated.ts`)
    .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)).toEqual([]);
});

test("moved conditional-declaration text keeps character-exact source provenance", () => {
  const source = `declare function cache(id: string): string | null
export function classify(id: string): string {
  if (const user = cache(id); user !== null) {
    return user
  }
  return "none"
}
`;
  const compiled = compileConditional(source, "conditional-map");
  expect(compiled.analysis.diagnostics).toEqual([]);
  const map = compiled.sourceMap!;
  for (const text of ["cache(id)", "user !== null", "return user"]) {
    const generatedOffset = compiled.code.indexOf(text);
    expect(generatedOffset).toBeGreaterThan(-1);
    expect(mappedPosition(map, compiled.code, generatedOffset))
      .toEqual(lineColumnAt(source, source.indexOf(text)));
  }
});

test("refuses conditional-declaration shapes whose scoping is not provable", () => {
  const cases: readonly (readonly [string, string, string])[] = [
    [
      "braceless then",
      `declare function cache(id: string): string | null
export function classify(id: string): string {
  if (const user = cache(id); user !== null) return user
  return "none"
}`,
      "braced",
    ],
    [
      "var",
      `declare function cache(id: string): string | null
export function classify(id: string): string {
  if (var user = cache(id); user !== null) { return user }
  return "none"
}`,
      "hoists out of the conditional construct",
    ],
    [
      "two separators",
      `declare function cache(id: string): string | null
export function classify(id: string): string {
  if (const user = cache(id); user !== null; true) { return user }
  return "none"
}`,
      "exactly one `;`",
    ],
    [
      "no declaration",
      `export function classify(id: string): string {
  if (id; id !== "") { return id }
  return "none"
}`,
      "must begin with `const` or `let`",
    ],
    [
      "empty condition",
      `declare function cache(id: string): string | null
export function classify(id: string): string {
  if (const user = cache(id); ) { return "x" }
  return "none"
}`,
      "both a declaration and a condition",
    ],
  ];
  for (const [label, source, fragment] of cases) {
    const analysis = analyzeSource(source);
    const refused = analysis.diagnostics.filter((diagnostic) => diagnostic.code === "VIBE1717");
    expect(refused, label).toHaveLength(1);
    expect(refused[0]!.message, label).toContain(fragment);
    // The authored text is left untouched, so nothing is silently rescoped.
    expect(recoverVibeSyntax(source).parseSource, label).toBe(source);
  }
});

test("the conditional-declarations example compiles, checks, and executes", async () => {
  const source = await Bun.file(
    resolve(import.meta.dir, "../../examples/language/conditional-declarations.vibe"),
  ).text();
  const { module } = await executeConditional(source, "conditional-declarations-example");
  expect(module.describe("ada")).toBe("found Ada Lovelace");
  expect(module.describe("missing")).toBe("fell back to anonymous for missing");
  expect(module.initials("ada").match({
    ok: (value: string) => value,
    error: () => "unreachable",
  })).toBe("AL");
  expect(module.initials("nope").match({
    ok: () => "unreachable",
    error: (error: Error) => error.constructor.name,
  })).toBe("Missing");
});

test("ordinary conditionals and semicolons inside them are untouched", () => {
  const source = `export function classify(id: string): string {
  if (id !== "") {
    const upper = id.toUpperCase();
    return upper
  }
  const arrow = (value: string) => { const inner = value; return inner }
  if (arrow(id).length > 0) { return "arrow" }
  return "none"
}
`;
  const recovered = recoverVibeSyntax(source);
  expect(recovered.changed).toBe(false);
  expect(recovered.parseSource).toBe(source);
  expect(analyzeSource(source).diagnostics).toEqual([]);
});
