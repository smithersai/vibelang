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

export function pick<T extends Row>(rows: readonly T[], id: number): Optional<T> {
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
    name: "defer and errdefer markers",
    compiles: true,
    source: `class CleanupFailure extends Error {}

function cleanup(): void {}
function rollback(): void {}

export function guarded(flag: boolean): Result<number, CleanupFailure> {
  defer   cleanup()
  errdefer     rollback()
  if (flag) throw new CleanupFailure()
  return 1
}
`,
  },
  {
    name: "labeled block values",
    compiles: true,
    source: `export function classify(input: string): string {
  const kind=verdict:{
if(input.length===0)break :verdict "empty"
if(input.length>8)break:verdict  "long"
break :verdict "short"
}
  return kind
}
`,
  },
  {
    name: "loop values with an else completion",
    compiles: true,
    source: `export function firstPassing(scores: number[]): number {
  const found=search:for(const score of scores){
if(score>=60)break :search score
}else -1
  return found
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
    name: "value switch in return position",
    compiles: true,
    source: `type Grade = "pass" | "fail" | "retry"

export function describe(grade: Grade): string {
  return switch(grade){
case "pass":"met the bar"
case "fail":"below the bar"
case "retry":"resit scheduled"
}
}
`,
  },
  {
    name: "value if in a general expression placement",
    compiles: true,
    source: `function combine(base: number, extra: number, scale: number): number {
  return (base + extra) * scale
}

export function weighted(score: number, bonus: boolean): number {
  return combine(score,   if (bonus) {
10
} else {
0
},   1)
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
    name: "nested value construct inside a defer cleanup",
    compiles: false,
    source: `function use(value: number): void {}
export function nested(active: boolean): void {
  defer use(if (active) { 1 } else { 2 })
}
`,
  },
  { name: "example: expression-flow.sm", source: example("expression-flow.sm"), compiles: true },
  {
    name: "example: conditional-declarations.sm",
    source: example("conditional-declarations.sm"),
    compiles: true,
  },
  { name: "example: demo.sm", source: example("demo.sm"), compiles: false },
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

  test("restores Smithers spellings verbatim in their formatted positions", () => {
    const result = formatSmithersSource(
      `export function guarded(flag:boolean):Result<number,Error>{\n` +
      `defer   cleanup()\n` +
      `errdefer    rollback()\n` +
      `const kind=verdict:{\n` +
      `break:verdict   "short"\n` +
      `}\n` +
      `const found=search:for(const s of [1]){\n` +
      `break :search s\n` +
      `}else -1\n` +
      `if(const v=read();v!==null){ return v }\n` +
      `return switch(kind){\ncase "short":found\n}\n` +
      `}\n`,
    );
    expect(result.ok).toBe(true);
    expect(result.code).toBe(
      `export function guarded(flag: boolean): Result<number, Error> {\n` +
      `  defer cleanup()\n` +
      `  errdefer rollback()\n` +
      `  const kind = verdict: {\n` +
      `    break :verdict "short"\n` +
      `  }\n` +
      `  const found = search: for (const s of [1]) {\n` +
      `    break :search s\n` +
      `  } else -1\n` +
      `  if (const v = read(); v !== null) { return v }\n` +
      `  return switch (kind) {\n` +
      `    case "short": found\n` +
      `  }\n` +
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
    const formatted = formatSmithersSource(example("expression-flow.sm"));
    expect(formatted.ok).toBe(true);
    expect(formatted.changed).toBe(false);
    expect(formatted.code).toBe(example("expression-flow.sm"));
  });

  test("the repository's language examples are already formatted", () => {
    for (const name of ["expression-flow.sm", "conditional-declarations.sm", "demo.sm"]) {
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

  test("converges: differently indented spellings of one program format alike", () => {
    const canonical = `export function classify(input: string): string {\n` +
      `  const kind = verdict: {\n` +
      `    if (input.length === 0) break :verdict "empty"\n` +
      `    break :verdict "short"\n` +
      `  }\n` +
      `  return kind\n` +
      `}\n`;
    const flattened = canonical.split("\n").map((line) => line.trimStart()).join("\n");
    const overIndented = canonical.split("\n")
      .map((line) => (line === "" ? line : `\t\t${line.trimStart()}`)).join("\n");
    expect(formatSmithersSource(flattened).code).toBe(canonical);
    expect(formatSmithersSource(overIndented).code).toBe(canonical);
    expect(formatSmithersSource(canonical).changed).toBe(false);
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
