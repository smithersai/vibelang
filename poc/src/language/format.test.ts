import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getNativeCompiler } from "../compiler/native.ts";
import { compileVibeLang } from "./compile.ts";
import { formatVibeLangSource, isFormattedVibeLangSource } from "./format.ts";
import type { Analysis } from "./model.ts";

const exampleDirectory = fileURLToPath(new URL("../../examples/language/", import.meta.url));

function example(name: string): string {
  return readFileSync(`${exampleDirectory}${name}`, "utf8");
}

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

interface Fixture {
  readonly name: string;
  readonly source: string;
  /** Skip the compile-based semantic gate for deliberately incomplete snippets. */
  readonly compiles?: boolean;
}

const fixtures: readonly Fixture[] = [
  {
    name: "ordinary TypeScript surface",
    compiles: true,
    source: `import { Panic } from "vibelang:exceptions"

class Invalid extends Error {
  constructor(readonly value: number) { super(\`bad \${value}\`) }
}

interface Row { readonly id: number; readonly label: string }

export function pick<T extends Row>(rows: readonly T[], id: number): T | undefined {
  return rows.find((row) => row.id === id)
}

export function safe(value: number): Result<number, Invalid | Panic> {
  if (value < 0) throw new Invalid(value)
  return value
}
`,
  },
  {
    name: "unformatted TypeScript surface",
    compiles: true,
    source: `class   Invalid extends Error{
constructor(readonly value:number){super(\`bad \${value}\`)}
}
export function safe(value:number):Result<number,Invalid>{
if(value<0)throw new Invalid(value)
   return value
}
`,
  },
  {
    name: "conditional declarations",
    compiles: true,
    source: `function lookup(key: string): string | null { return key === "" ? null : key }

export function describe(key: string): string {
  if(const name=lookup(key);name!==null){
return \`found \${name}\`
}else if(const fallback=lookup("");fallback!==null){
return fallback
}else{
return "nothing"
}
}
`,
  },
  {
    name: "line breaks the parse does not depend on",
    compiles: true,
    source: `export function shaped(flag: boolean): number
{
  const table =
  {
    a: 1, b: 2,
    c: 3
  }
  if (flag)
  {
    return table.a
  }
  else
  {
    return table.c
  }
}
`,
  },
  {
    name: "automatic semicolon boundaries",
    compiles: true,
    source: `export function early(): void {
  return
  const unreachable = 1
}

export function counted(values: number[]): number {
  let total = 0
  total
  ++total
  return total + values.length
}
`,
  },
  {
    name: "comments in every position",
    compiles: true,
    source: `// leading line comment

/**
 * JSDoc block that must survive verbatim.
 *   indented continuation
 */
export function annotated(value: number): number {
  // inner comment
  const doubled = value * 2 // trailing comment
  /* inline */ return doubled /* after */
}
`,
  },
  {
    name: "string, template, and regular expression contents",
    compiles: true,
    source: `export const spaced = "keep    these    spaces"
export const pattern = /a{2,3}\\s+b/gu
export const template = \`line one    with spacing
      line two indented
\${spaced}   tail\`
export function usesSlash(a: number, b: number): number { return a / b }
`,
  },
  {
    name: "example: conditional-declarations.vibe",
    source: example("conditional-declarations.vibe"),
    compiles: true,
  },
];

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** Independent native parse/emit, not the formatter's preservation predicate.
 * Exact JS retains literal/comment bytes and automatic-semicolon semantics;
 * no hand-written scanner or whitespace-stripping expression can erase them. */
function emittedJavaScript(code: string): string {
  const emitted = getNativeCompiler().transpile({ files: [{ path: "format-oracle.ts", text: code }],
    options: { target: "esnext", module: "esnext", removeComments: false },
  }).files[0]!;
  expect(emitted.diagnostics).toEqual([]);
  expect(emitted.emitSkipped).toBe(false);
  return emitted.javascript;
}

interface SemanticSnapshot {
  readonly rows: Analysis["rows"];
  readonly functions: readonly string[];
  readonly errors: readonly string[];
  readonly diagnostics: readonly string[];
  readonly javascript: string;
}

function semanticSnapshot(source: string, fileName: string): SemanticSnapshot {
  const compiled = compileVibeLang(source, {
    fileName: `/project/${fileName}`,
    outputFileName: `/project/${fileName}.generated.ts`,
    sourceName: fileName,
    sourceMap: false,
  });
  return {
    rows: compiled.analysis.rows,
    functions: compiled.analysis.functions.map((declaration) =>
      `${declaration.name}:${declaration.channel}:${declaration.exported}:${declaration.async}`).sort(),
    errors: compiled.analysis.errors.map((declaration) => declaration.name).sort(),
    diagnostics: compiled.analysis.diagnostics.map((entry) => `${entry.code} ${entry.message}`).sort(),
    javascript: emittedJavaScript(compiled.code),
  };
}

/* -------------------------------------------------------------------------- */
/* Properties over every fixture                                               */
/* -------------------------------------------------------------------------- */

describe("vibe format", () => {
  test("formats every fixture without failing closed", () => {
    for (const fixture of fixtures) {
      const result = formatVibeLangSource(fixture.source, { fileName: `${fixture.name}.vibe` });
      expect({ name: fixture.name, ok: result.ok, diagnostics: result.diagnostics })
        .toEqual({ name: fixture.name, ok: true, diagnostics: [] });
    }
  });

  test("is idempotent: format(format(x)) === format(x)", () => {
    for (const fixture of fixtures) {
      const first = formatVibeLangSource(fixture.source, { fileName: `${fixture.name}.vibe` });
      expect(first.ok).toBe(true);
      const second = formatVibeLangSource(first.code, { fileName: `${fixture.name}.vibe` });
      expect({ name: fixture.name, ok: second.ok, stable: second.code === first.code })
        .toEqual({ name: fixture.name, ok: true, stable: true });
      expect(isFormattedVibeLangSource(first.code, { fileName: `${fixture.name}.vibe` })).toBe(true);
    }
  });

  test("preserves analysis rows and emitted JavaScript for every fixture", () => {
    for (const fixture of fixtures) {
      if (fixture.compiles !== true) continue;
      const fileName = "fixture.vibe";
      const formatted = formatVibeLangSource(fixture.source, { fileName });
      expect(formatted.ok).toBe(true);
      const before = semanticSnapshot(fixture.source, fileName);
      const after = semanticSnapshot(formatted.code, fileName);
      expect({ name: fixture.name, ...after }).toEqual({ name: fixture.name, ...before });
    }
  });

  test("the independent emission oracle detects literal, comment, and ASI changes", () => {
    // Native formatting separately checks exact tokens and parsed structure.
    // These controls prove the host's emission comparison above is not another
    // call to that predicate, or an observer that erases meaningful whitespace.
    for (const [before, after] of [
      ['const text = "a  b";', 'const text = "a b";'],
      ['const text = `a\n  b`;', 'const text = `a\n b`;'],
      ['const re = /a  b/g;', 'const re = /a b/g;'],
      ['const re = /a/g;', 'const re = /a/i;'],
      ['/* keep  me */ const x = 1;', '/* keep me */ const x = 1;'],
      ['function f() { return\n1; }', 'function f() { return 1; }'],
      ['function f(a: number) { a\n++a; }', 'function f(a: number) { a++; a; }'],
    ]) expect(emittedJavaScript(before!)).not.toBe(emittedJavaScript(after!));
  });
});

/* -------------------------------------------------------------------------- */
/* Behaviour                                                                   */
/* -------------------------------------------------------------------------- */

describe("vibe format output", () => {
  test("indents and spaces ordinary TypeScript deterministically", () => {
    const result = formatVibeLangSource(`export function safe(value:number):Result<number,Error>{\nif(value<0)throw new Error("x")\n   return value\n}\n`);
    expect(result.ok).toBe(true);
    expect(result.code).toBe(
      `export function safe(value: number): Result<number, Error> {\n` +
      `  if (value < 0) throw new Error("x")\n` +
      `  return value\n` +
      `}\n`,
    );
  });

  test("never reflows string, template, or regular expression contents", () => {
    const source = `const a = "two    spaces"\nconst b = \`line\n    indented   tail\`\nconst c = /a  b/g\n`;
    const result = formatVibeLangSource(`   ${source}`);
    expect(result.ok).toBe(true);
    expect(result.code).toContain(`"two    spaces"`);
    expect(result.code).toContain("`line\n    indented   tail`");
    expect(result.code).toContain("/a  b/g");
  });

  test("keeps leading, inline, and trailing comments", () => {
    const result = formatVibeLangSource(
      `// leading\nexport function f():void{\n// own line\n   /* inline */ const x=1 // trailing\n}\n`,
    );
    expect(result.ok).toBe(true);
    expect(result.code).toContain("// leading\n");
    expect(result.code).toContain("// own line");
    expect(result.code).toContain("/* inline */ const x = 1 // trailing");
    expect(formatVibeLangSource(`export function f():void{\n// own line\nconst x=1\n}\n`).code)
      .toBe(`export function f(): void {\n  // own line\n  const x = 1\n}\n`);
  });

  test("trims trailing whitespace and ends the module with one newline", () => {
    const result = formatVibeLangSource(`const a = 1   \nconst b = 2\t\n\n\n`);
    expect(result.ok).toBe(true);
    expect(result.code).toBe(`const a = 1\nconst b = 2\n`);
  });

  test("reports an already-formatted module as unchanged", () => {
    const formatted = formatVibeLangSource(example("conditional-declarations.vibe"));
    expect(formatted.ok).toBe(true);
    expect(formatted.changed).toBe(false);
    expect(formatted.code).toBe(example("conditional-declarations.vibe"));
  });

  test("the repository's language examples are already formatted", () => {
    for (const name of ["conditional-declarations.vibe"]) {
      expect({ name, formatted: isFormattedVibeLangSource(example(name), { fileName: name }) })
        .toEqual({ name, formatted: true });
    }
  });

  test("joins a brace or else onto its header when the parse does not change", () => {
    expect(formatVibeLangSource(`function f()\n{\n  return 1\n}\n`).code)
      .toBe(`function f() {\n  return 1\n}\n`);
    expect(formatVibeLangSource(`if (a)\n{\n1\n}\nelse\n{\n2\n}\n`).code)
      .toBe(`if (a) {\n  1\n}\nelse {\n  2\n}\n`);
  });

  test("keeps every automatic-semicolon boundary exactly where it was", () => {
    const source = `function f() {\n  return\n  1\n}\n`;
    const result = formatVibeLangSource(source);
    expect(result.ok).toBe(true);
    expect(result.code).toBe(source);

    const postfix = `function g(a: number) {\n  a\n  ++a\n  return a\n}\n`;
    expect(formatVibeLangSource(postfix).code).toBe(postfix);
  });

  test("preserves the module's own newline convention", () => {
    const result = formatVibeLangSource(`export function f():void{\r\nconst x=1\r\n}\r\n`);
    expect(result.ok).toBe(true);
    expect(result.code).toBe(`export function f(): void {\r\n  const x = 1\r\n}\r\n`);
  });
});

/* -------------------------------------------------------------------------- */
/* Fail-closed behaviour                                                       */
/* -------------------------------------------------------------------------- */

describe("vibe format fail-closed", () => {
  test("never rewrites a module whose masked source does not parse", () => {
    const source = `export function broken(): number {\n  const x = (1 +\n  return x\n`;
    const result = formatVibeLangSource(source, { fileName: "broken.vibe" });
    expect(result.ok).toBe(false);
    expect(result.changed).toBe(false);
    expect(result.code).toBe(source);
    expect(result.diagnostics.map((entry) => entry.code)).toEqual(["VIBE1901"]);
    expect(result.diagnostics[0]!.line).toBeGreaterThan(0);
    expect(result.diagnostics[0]!.column).toBeGreaterThan(0);
  });

  test("never rewrites retired VibeLang syntax it cannot mask", () => {
    const source = `export function legacy(value: number): number {\n  return value orelse 0\n}\n`;
    const result = formatVibeLangSource(source, { fileName: "legacy.vibe" });
    expect(result.ok).toBe(false);
    expect(result.code).toBe(source);
    expect(result.diagnostics.map((entry) => entry.code)).toEqual(["VIBE1901"]);
  });

  test("refuses a module larger than the formatter budget", () => {
    const source = `const a = 1\n`.repeat(400_000);
    const result = formatVibeLangSource(source);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((entry) => entry.code)).toEqual(["VIBE1900"]);
    expect(result.code).toBe(source);
  });

  test("rejects an out-of-range indent size", () => {
    expect(() => formatVibeLangSource("const a = 1\n", { indentSize: 0 })).toThrow(TypeError);
    expect(() => formatVibeLangSource("const a = 1\n", { indentSize: 9 })).toThrow(TypeError);
  });

  test("formats an empty module to an empty module", () => {
    const result = formatVibeLangSource("");
    expect(result.ok).toBe(true);
    expect(result.code).toBe("");
  });
});
