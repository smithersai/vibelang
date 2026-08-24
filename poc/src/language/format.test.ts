import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as ts from "typescript-js";
import { compileSmithers } from "./compile.ts";
import { formatSmithersSource, isFormattedSmithersSource } from "./format.ts";
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
    source: `import { Panic } from "smithers:exceptions"

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
    name: "example: conditional-declarations.sm",
    source: example("conditional-declarations.sm"),
    compiles: true,
  },
];

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

interface EmittedToken {
  readonly kind: ts.SyntaxKind;
  readonly text: string;
}

const SLASH_CANNOT_START_REGEX: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.Identifier,
  ts.SyntaxKind.NumericLiteral,
  ts.SyntaxKind.BigIntLiteral,
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.RegularExpressionLiteral,
  ts.SyntaxKind.CloseParenToken,
  ts.SyntaxKind.CloseBracketToken,
  ts.SyntaxKind.ThisKeyword,
  ts.SyntaxKind.SuperKeyword,
  ts.SyntaxKind.TrueKeyword,
  ts.SyntaxKind.FalseKeyword,
  ts.SyntaxKind.NullKeyword,
]);

/**
 * Every token and comment of a module, whitespace removed. Written here rather
 * than imported so the assertion is independent of the formatter's own gate.
 * The template and regular-expression re-scans are required: without them a
 * `${...}` substitution makes the scanner read formatted whitespace as literal
 * content and the comparison would pass or fail for the wrong reason.
 */
function emittedTokens(code: string): readonly EmittedToken[] {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, code);
  const tokens: EmittedToken[] = [];
  const templateBraceDepths: number[] = [];
  let braceDepth = 0;
  let previous: ts.SyntaxKind | undefined;
  for (;;) {
    let kind = scanner.scan();
    if (kind === ts.SyntaxKind.EndOfFileToken) break;
    if ((kind === ts.SyntaxKind.SlashToken || kind === ts.SyntaxKind.SlashEqualsToken) &&
      (previous === undefined || !SLASH_CANNOT_START_REGEX.has(previous))) {
      kind = scanner.reScanSlashToken();
    }
    if (kind === ts.SyntaxKind.CloseBraceToken && templateBraceDepths.length > 0 &&
      braceDepth === templateBraceDepths[templateBraceDepths.length - 1]) {
      kind = scanner.reScanTemplateToken(false);
      if (kind === ts.SyntaxKind.TemplateTail) templateBraceDepths.pop();
    } else if (kind === ts.SyntaxKind.OpenBraceToken) braceDepth += 1;
    else if (kind === ts.SyntaxKind.CloseBraceToken) braceDepth -= 1;
    if (kind === ts.SyntaxKind.TemplateHead) templateBraceDepths.push(braceDepth);
    if (kind !== ts.SyntaxKind.WhitespaceTrivia && kind !== ts.SyntaxKind.NewLineTrivia) {
      tokens.push({ kind, text: scanner.getTokenText() });
      previous = kind;
    }
  }
  return tokens;
}

/** The emitted module as JavaScript, so type positions cannot mask a change. */
function emittedJavaScript(code: string): string {
  return ts.transpileModule(code, {
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      removeComments: false,
    },
  }).outputText;
}

interface SemanticSnapshot {
  readonly rows: Analysis["rows"];
  readonly functions: readonly string[];
  readonly errors: readonly string[];
  readonly diagnostics: readonly string[];
  readonly javascript: readonly EmittedToken[];
}

function semanticSnapshot(source: string, fileName: string): SemanticSnapshot {
  const compiled = compileSmithers(source, {
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
    javascript: emittedTokens(emittedJavaScript(compiled.code)),
  };
}

/* -------------------------------------------------------------------------- */
/* Properties over every fixture                                               */
/* -------------------------------------------------------------------------- */

describe("smithers format", () => {
  test("formats every fixture without failing closed", () => {
    for (const fixture of fixtures) {
      const result = formatSmithersSource(fixture.source, { fileName: `${fixture.name}.sm` });
      expect({ name: fixture.name, ok: result.ok, diagnostics: result.diagnostics })
        .toEqual({ name: fixture.name, ok: true, diagnostics: [] });
    }
  });

  test("is idempotent: format(format(x)) === format(x)", () => {
    for (const fixture of fixtures) {
      const first = formatSmithersSource(fixture.source, { fileName: `${fixture.name}.sm` });
      expect(first.ok).toBe(true);
      const second = formatSmithersSource(first.code, { fileName: `${fixture.name}.sm` });
      expect({ name: fixture.name, ok: second.ok, stable: second.code === first.code })
        .toEqual({ name: fixture.name, ok: true, stable: true });
      expect(isFormattedSmithersSource(first.code, { fileName: `${fixture.name}.sm` })).toBe(true);
    }
  });

  test("preserves analysis rows and emitted JavaScript for every fixture", () => {
    for (const fixture of fixtures) {
      if (fixture.compiles !== true) continue;
      const fileName = "fixture.sm";
      const formatted = formatSmithersSource(fixture.source, { fileName });
      expect(formatted.ok).toBe(true);
      const before = semanticSnapshot(fixture.source, fileName);
      const after = semanticSnapshot(formatted.code, fileName);
      expect({ name: fixture.name, ...after }).toEqual({ name: fixture.name, ...before });
    }
  });

  test("preserves every token and comment, and every line-break boundary", () => {
    for (const fixture of fixtures) {
      const formatted = formatSmithersSource(fixture.source, { fileName: `${fixture.name}.sm` });
      expect(formatted.ok).toBe(true);
      // The formatter's own round-trip gate rejects a result whose token or
      // comment stream diverges, so `ok` already proves this; assert the
      // observable consequence independently.
      expect(emittedTokens(formatted.code).map((token) => token.text))
        .toEqual(emittedTokens(fixture.source).map((token) => token.text));
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Behaviour                                                                   */
/* -------------------------------------------------------------------------- */

describe("smithers format output", () => {
  test("indents and spaces ordinary TypeScript deterministically", () => {
    const result = formatSmithersSource(`export function safe(value:number):Result<number,Error>{\nif(value<0)throw new Error("x")\n   return value\n}\n`);
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
    const result = formatSmithersSource(`   ${source}`);
    expect(result.ok).toBe(true);
    expect(result.code).toContain(`"two    spaces"`);
    expect(result.code).toContain("`line\n    indented   tail`");
    expect(result.code).toContain("/a  b/g");
  });

  test("keeps leading, inline, and trailing comments", () => {
    const result = formatSmithersSource(
      `// leading\nexport function f():void{\n// own line\n   /* inline */ const x=1 // trailing\n}\n`,
    );
    expect(result.ok).toBe(true);
    expect(result.code).toContain("// leading\n");
    expect(result.code).toContain("// own line");
    expect(result.code).toContain("/* inline */ const x = 1 // trailing");
    expect(formatSmithersSource(`export function f():void{\n// own line\nconst x=1\n}\n`).code)
      .toBe(`export function f(): void {\n  // own line\n  const x = 1\n}\n`);
  });

  test("trims trailing whitespace and ends the module with one newline", () => {
    const result = formatSmithersSource(`const a = 1   \nconst b = 2\t\n\n\n`);
    expect(result.ok).toBe(true);
    expect(result.code).toBe(`const a = 1\nconst b = 2\n`);
  });

  test("reports an already-formatted module as unchanged", () => {
    const formatted = formatSmithersSource(example("conditional-declarations.sm"));
    expect(formatted.ok).toBe(true);
    expect(formatted.changed).toBe(false);
    expect(formatted.code).toBe(example("conditional-declarations.sm"));
  });

  test("the repository's language examples are already formatted", () => {
    for (const name of ["conditional-declarations.sm"]) {
      expect({ name, formatted: isFormattedSmithersSource(example(name), { fileName: name }) })
        .toEqual({ name, formatted: true });
    }
  });

  test("joins a brace or else onto its header when the parse does not change", () => {
    expect(formatSmithersSource(`function f()\n{\n  return 1\n}\n`).code)
      .toBe(`function f() {\n  return 1\n}\n`);
    expect(formatSmithersSource(`if (a)\n{\n1\n}\nelse\n{\n2\n}\n`).code)
      .toBe(`if (a) {\n  1\n}\nelse {\n  2\n}\n`);
  });

  test("keeps every automatic-semicolon boundary exactly where it was", () => {
    const source = `function f() {\n  return\n  1\n}\n`;
    const result = formatSmithersSource(source);
    expect(result.ok).toBe(true);
    expect(result.code).toBe(source);

    const postfix = `function g(a: number) {\n  a\n  ++a\n  return a\n}\n`;
    expect(formatSmithersSource(postfix).code).toBe(postfix);
  });

  test("preserves the module's own newline convention", () => {
    const result = formatSmithersSource(`export function f():void{\r\nconst x=1\r\n}\r\n`);
    expect(result.ok).toBe(true);
    expect(result.code).toBe(`export function f(): void {\r\n  const x = 1\r\n}\r\n`);
  });
});

/* -------------------------------------------------------------------------- */
/* Fail-closed behaviour                                                       */
/* -------------------------------------------------------------------------- */

describe("smithers format fail-closed", () => {
  test("never rewrites a module whose masked source does not parse", () => {
    const source = `export function broken(): number {\n  const x = (1 +\n  return x\n`;
    const result = formatSmithersSource(source, { fileName: "broken.sm" });
    expect(result.ok).toBe(false);
    expect(result.changed).toBe(false);
    expect(result.code).toBe(source);
    expect(result.diagnostics.map((entry) => entry.code)).toEqual(["SMITHERS1901"]);
    expect(result.diagnostics[0]!.line).toBeGreaterThan(0);
    expect(result.diagnostics[0]!.column).toBeGreaterThan(0);
  });

  test("never rewrites retired Smithers syntax it cannot mask", () => {
    const source = `export function legacy(value: number): number {\n  return value orelse 0\n}\n`;
    const result = formatSmithersSource(source, { fileName: "legacy.sm" });
    expect(result.ok).toBe(false);
    expect(result.code).toBe(source);
    expect(result.diagnostics.map((entry) => entry.code)).toEqual(["SMITHERS1901"]);
  });

  test("refuses a module larger than the formatter budget", () => {
    const source = `const a = 1\n`.repeat(400_000);
    const result = formatSmithersSource(source);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((entry) => entry.code)).toEqual(["SMITHERS1900"]);
    expect(result.code).toBe(source);
  });

  test("rejects an out-of-range indent size", () => {
    expect(() => formatSmithersSource("const a = 1\n", { indentSize: 0 })).toThrow(TypeError);
    expect(() => formatSmithersSource("const a = 1\n", { indentSize: 9 })).toThrow(TypeError);
  });

  test("formats an empty module to an empty module", () => {
    const result = formatSmithersSource("");
    expect(result.ok).toBe(true);
    expect(result.code).toBe("");
  });
});
