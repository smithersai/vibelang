import { afterAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as ts from "typescript-js";
import { checkEmittedProject, checkEmittedTypeScript } from "../language/validate.ts";
import {
  COMPTIME_MODULE_SPECIFIER,
  COMPTIME_RUNTIME_ERROR,
  COMPTIME_RUNTIME_GUARD_SOURCE,
  ComptimeCompiler,
  ComptimeIntrinsicDiagnosticCode,
  compileComptimeIntrinsics,
  digest,
  SCHEMA_MODULE_SPECIFIER,
} from "./index.ts";

const roots: string[] = [];
afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

async function compiler(): Promise<{ root: string; cache: string; compiler: ComptimeCompiler }> {
  const root = await mkdtemp(join(tmpdir(), "smithers-comptime-intrinsic-"));
  roots.push(root);
  const cache = join(root, ".cache");
  return { root, cache, compiler: new ComptimeCompiler({ root, cacheDirectory: cache, target: "node" }) };
}

function dataModule(source: string): string {
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}

function executableJavaScript(code: string): string {
  return ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext },
  }).outputText;
}

interface DecodedMapping {
  readonly generatedLine: number;
  readonly generatedColumn: number;
  readonly source: number;
  readonly originalLine: number;
  readonly originalColumn: number;
}

const SOURCE_MAP_BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const SOURCE_MAP_VALUES = new Map([...SOURCE_MAP_BASE64].map((character, index) => [character, index]));

function decodeVlq(segment: string, start: number): readonly [number, number] {
  let value = 0;
  let shift = 0;
  let index = start;
  for (;;) {
    const digit = SOURCE_MAP_VALUES.get(segment[index++]);
    if (digit === undefined || shift > 48) throw new Error("invalid test source-map VLQ");
    value += (digit & 31) * 2 ** shift;
    if ((digit & 32) === 0) break;
    shift += 5;
  }
  const magnitude = Math.floor(value / 2);
  return [(value & 1) === 1 ? -magnitude : magnitude, index];
}

function decodeMappings(sourceMap: string): {
  readonly map: { readonly version: number; readonly sources: readonly string[]; readonly sourcesContent: readonly string[] };
  readonly mappings: readonly DecodedMapping[];
} {
  const map = JSON.parse(sourceMap) as {
    readonly version: number;
    readonly sources: readonly string[];
    readonly sourcesContent: readonly string[];
    readonly mappings: string;
  };
  const mappings: DecodedMapping[] = [];
  let previousSource = 0;
  let previousOriginalLine = 0;
  let previousOriginalColumn = 0;
  for (const [generatedLine, line] of map.mappings.split(";").entries()) {
    let previousGeneratedColumn = 0;
    for (const segment of line === "" ? [] : line.split(",")) {
      const values: number[] = [];
      for (let offset = 0; offset < segment.length;) {
        const [value, next] = decodeVlq(segment, offset);
        values.push(value);
        offset = next;
      }
      expect(values).toHaveLength(4);
      previousGeneratedColumn += values[0]!;
      previousSource += values[1]!;
      previousOriginalLine += values[2]!;
      previousOriginalColumn += values[3]!;
      mappings.push({
        generatedLine,
        generatedColumn: previousGeneratedColumn,
        source: previousSource,
        originalLine: previousOriginalLine,
        originalColumn: previousOriginalColumn,
      });
    }
  }
  return { map, mappings };
}

function lineColumnAt(text: string, offset: number): { readonly line: number; readonly column: number } {
  const prefix = text.slice(0, offset);
  const lines = prefix.split("\n");
  return { line: lines.length - 1, column: lines.at(-1)!.length };
}

function mappedPosition(sourceMap: string, generatedCode: string, generatedOffset: number): {
  readonly source: string;
  readonly line: number;
  readonly column: number;
} {
  const decoded = decodeMappings(sourceMap);
  const generated = lineColumnAt(generatedCode, generatedOffset);
  const selected = decoded.mappings.filter((mapping) =>
    mapping.generatedLine === generated.line && mapping.generatedColumn <= generated.column).at(-1);
  if (!selected) throw new Error("generated position is unmapped");
  return {
    source: decoded.map.sources[selected.source]!,
    line: selected.originalLine,
    column: selected.originalColumn + generated.column - selected.generatedColumn,
  };
}

describe("compiler-facing comptime intrinsic", () => {
  test("checker identity recognizes direct, aliased, and namespace imports in .sm source", async () => {
    const build = await compiler();
    const source = [
      `import { comptime, comptime as compileNow } from ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)};`,
      `import * as Build from ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)};`,
      `const config = { mode: "poc", ports: [80, 443], nested: { enabled: true } } as const;`,
      `export const direct = comptime(config);`,
      `export const alias = compileNow([null, -2, "ok"]);`,
      `export const namespace = Build.comptime({ answer: 42 });`,
    ].join("\n");
    const first = await compileComptimeIntrinsics({ compiler: build.compiler, sources: { "main.sm": source } });
    expect(first.ok).toBe(true);
    expect(first.diagnostics).toEqual([]);
    expect(first.calls.map((call) => call.value)).toEqual([
      { mode: "poc", nested: { enabled: true }, ports: [80, 443] },
      [null, -2, "ok"],
      { answer: 42 },
    ]);
    expect(first.calls.every((call) => call.build.cacheHit === false)).toBe(true);
    expect(first.loweredSources?.["main.sm"]).not.toContain(COMPTIME_MODULE_SPECIFIER);
    expect(first.loweredSources?.["main.sm"]).not.toContain("comptime(config)");

    const second = await compileComptimeIntrinsics({ compiler: build.compiler, sources: { "main.sm": source } });
    expect(second.ok).toBe(true);
    expect(second.calls.every((call) => call.build.cacheHit === true)).toBe(true);
    expect(second.calls.map((call) => call.build.key)).toEqual(first.calls.map((call) => call.build.key));
  });

  test("marks bounded functions without invoking them and evaluates every marked call", async () => {
    const build = await compiler();
    const source = [
      `import { comptime } from ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)};`,
      `function normalize(input) {`,
      `  const lowered = input.trim().toLowerCase();`,
      `  return { lowered };`,
      `}`,
      `const normalizeAtBuild = comptime(normalize);`,
      `export const first = normalizeAtBuild("  Account Settings  ");`,
      `export const second = normalizeAtBuild("  PROFILE  ");`,
    ].join("\n");
    const result = await compileComptimeIntrinsics({ compiler: build.compiler, sources: { "main.js": source } });
    expect(result.ok).toBe(true);
    expect(result.calls.map((call) => call.value)).toEqual([
      { lowered: "account settings" },
      { lowered: "profile" },
    ]);
    expect(result.loweredFiles?.["main.js"]?.provenance.edits.map((edit) => edit.kind)).toEqual([
      "remove-import",
      "function-marker",
      "intrinsic-call",
      "intrinsic-call",
    ]);
    const lowered = result.loweredSources!["main.js"]!;
    expect(lowered).not.toContain("normalizeAtBuild");
    const loaded = await import(dataModule(lowered));
    expect(loaded.first).toEqual({ lowered: "account settings" });
    expect(loaded.second).toEqual({ lowered: "profile" });
  });

  test("strict equality is referential and an iterating callback cannot mutate its receiver", async () => {
    const build = await compiler();
    const source = [
      `import { comptime } from ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)};`,
      `function sameRef(a, b) { return a === b; }`,
      `const sameRefAtBuild = comptime(sameRef);`,
      `export const atComptime = sameRefAtBuild([1], [1]);`,
      `export const atRuntime = sameRef([1], [1]);`,
      `export const shapes = comptime(() => {`,
      `  const one = { x: 1 };`,
      `  const alias = one;`,
      `  const list = [1];`,
      `  return [one === alias, one === { x: 1 }, one !== { x: 1 }, list === list, list === [1], list !== [1]];`,
      `})();`,
    ].join("\n");
    const result = await compileComptimeIntrinsics({ compiler: build.compiler, sources: { "main.js": source } });
    expect(result.ok).toBe(true);
    // Asserted against JavaScript directly rather than against the other backend:
    // both backends canonicalized before comparing, so a cross-backend
    // differential agreed with itself and stayed green over the whole defect.
    expect(result.calls.map((call) => call.value)).toEqual([false, [true, false, true, true, false, true]]);
    const loaded = await import(dataModule(result.loweredSources!["main.js"]!));
    // One emitted module, one retained function, one pair of arguments: the
    // folded constant and the runtime call must not disagree.
    expect(loaded.atComptime).toBe(loaded.atRuntime);

    for (const body of [
      `[1, 2].map((value, index, all) => { if (index === 0) { all[1] = 99; } return value; })`,
      `[1, 2].filter((value, index, all) => { if (index === 0) { all[1] = 99; } return value > 50; })`,
      `[1, 2].reduce((total, value, index, all) => { if (index === 0) { all[1] = 99; } return total + value; }, 0)`,
    ]) {
      const scratch = await compiler();
      const refused = await compileComptimeIntrinsics({
        compiler: scratch.compiler,
        sources: {
          "case.ts": `import { comptime } from ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)};\ncomptime(() => ${body})();`,
        },
      });
      expect(refused.ok).toBe(false);
      expect(refused.diagnostics).toEqual([expect.objectContaining({
        code: ComptimeIntrinsicDiagnosticCode.UnsupportedExpression,
        file: "case.ts",
        line: 2,
      })]);
    }
  });

  test("eliminates target branches and tracks embedded text through the static cache", async () => {
    const build = await compiler();
    const source = [
      `import { comptime, embed } from ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)};`,
      `export const selected = comptime(() => {`,
      `  if (comptime.target === "node") {`,
      `    const config = JSON.parse(embed("./config.json"));`,
      `    return { target: comptime.target, config };`,
      `  }`,
      `  return JSON.parse(embed("./missing-unselected.json"));`,
      `})();`,
    ].join("\n");
    await writeFile(join(build.root, "main.sm"), source);
    await writeFile(join(build.root, "config.json"), JSON.stringify({ answer: 42 }));

    const first = await compileComptimeIntrinsics({ compiler: build.compiler, sources: { "main.sm": source } });
    expect(first.ok).toBe(true);
    expect(first.calls[0]?.value).toEqual({ target: "node", config: { answer: 42 } });
    expect(first.calls[0]?.build.dependencies).toEqual([
      expect.objectContaining({ path: "config.json", kind: "file", access: "text" }),
    ]);
    expect(first.calls[0]?.build.cacheHit).toBe(false);
    expect(first.loweredSources?.["main.sm"]).not.toContain("missing-unselected");
    expect(first.loweredSources?.["main.sm"]).toContain("as const");

    const warm = await compileComptimeIntrinsics({ compiler: build.compiler, sources: { "main.sm": source } });
    expect(warm.calls[0]?.build.cacheHit).toBe(true);
    await writeFile(join(build.root, "config.json"), JSON.stringify({ answer: 43 }));
    const changed = await compileComptimeIntrinsics({ compiler: build.compiler, sources: { "main.sm": source } });
    expect(changed.calls[0]?.build.cacheHit).toBe(false);
    expect(changed.calls[0]?.value).toEqual({ target: "node", config: { answer: 43 } });
  });

  test("compile-time function values cannot escape their checked call sites", async () => {
    const build = await compiler();
    const result = await compileComptimeIntrinsics({
      compiler: build.compiler,
      sources: {
        "escape.ts": [
          `import { comptime } from ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)};`,
          `const atBuild = comptime((value: string) => value.trim());`,
          `export const escaped = atBuild;`,
        ].join("\n"),
      },
    });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      ComptimeIntrinsicDiagnosticCode.UnsupportedUse,
    );
    expect(result.loweredSources).toBeUndefined();
  });

  test("runtime-retained functions cannot retain direct or transitive phase-only inputs", async () => {
    const build = await compiler();
    const source = [
      `import { comptime, embed } from ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)};`,
      `function input() { return embed("./config.json"); }`,
      `function wrapper() { return input(); }`,
      `const atBuild = comptime(wrapper);`,
      `export const value = atBuild();`,
    ].join("\n");
    await writeFile(join(build.root, "retained.sm"), source);
    await writeFile(join(build.root, "config.json"), "{}");
    const result = await compileComptimeIntrinsics({ compiler: build.compiler, sources: { "retained.sm": source } });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining([
      ComptimeIntrinsicDiagnosticCode.UnsupportedExpression,
      ComptimeIntrinsicDiagnosticCode.UnsupportedUse,
    ]));
    expect(existsSync(build.cache)).toBe(false);
  });

  test("generated values retain deep literal types for downstream checking", async () => {
    const build = await compiler();
    const source = [
      `import { comptime } from ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)};`,
      `export const generated = comptime({ kind: "node", ports: [80, 443] });`,
      `const exactKind: "node" = generated.kind;`,
      `const exactPorts: readonly [80, 443] = generated.ports;`,
    ].join("\n");
    const result = await compileComptimeIntrinsics({ compiler: build.compiler, sources: { "types.sm": source } });
    expect(result.ok).toBe(true);
    const lowered = result.loweredSources!["types.sm"]!;
    expect(lowered).toContain("as const");
    expect(checkEmittedTypeScript(lowered, join(build.root, "types.ts"))
      .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)).toEqual([]);
  });

  test("emits deterministic maps and zero-width provenance across erased imports and multiline calls", async () => {
    const build = await compiler();
    const source = [
      `import { comptime } from ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)};`,
      `const untouched = 1;`,
      `export const value = comptime(`,
      `  {`,
      `    mode: "mapped",`,
      `    nested: [1, 2],`,
      `  }`,
      `);`,
      `export const after = untouched;`,
    ].join("\n");
    const first = await compileComptimeIntrinsics({ compiler: build.compiler, sources: { "main.sm": source } });
    expect(first.ok).toBe(true);
    const lowered = first.loweredFiles?.["main.sm"];
    expect(lowered).toBeDefined();
    expect(first.loweredSources?.["main.sm"]).toBe(lowered!.code);

    const decoded = decodeMappings(lowered!.sourceMap);
    expect(decoded.map.version).toBe(3);
    expect(decoded.map.sources).toEqual(["main.sm"]);
    expect(decoded.map.sourcesContent).toEqual([source]);
    expect(lowered!.provenance).toEqual(JSON.parse(lowered!.sourceMap).x_smithers_comptime);
    expect(lowered!.provenance.edits.map((edit) => edit.kind)).toEqual(["remove-import", "intrinsic-call"]);
    const removed = lowered!.provenance.edits[0]!;
    expect(removed.generated.start).toBe(removed.generated.end);
    expect(removed.authored.end).toBeGreaterThan(removed.authored.start);
    expect(mappedPosition(lowered!.sourceMap, lowered!.code, removed.generated.start)).toEqual({
      source: "main.sm",
      ...lineColumnAt(source, removed.authored.end),
    });

    const generatedLiteral = lowered!.code.indexOf("({");
    const authoredObject = source.indexOf("{\n", source.indexOf("comptime("));
    expect(mappedPosition(lowered!.sourceMap, lowered!.code, generatedLiteral)).toEqual({
      source: "main.sm",
      ...lineColumnAt(source, authoredObject),
    });
    const generatedAfter = lowered!.code.indexOf("export const after");
    const authoredAfter = source.indexOf("export const after");
    expect(mappedPosition(lowered!.sourceMap, lowered!.code, generatedAfter)).toEqual({
      source: "main.sm",
      ...lineColumnAt(source, authoredAfter),
    });

    const second = await compileComptimeIntrinsics({ compiler: build.compiler, sources: { "main.sm": source } });
    expect(second.loweredFiles?.["main.sm"]).toEqual(lowered);
    expect(second.loweredFiles?.["main.sm"]?.identity).toBe(lowered!.identity);
    expect(second.calls[0]?.build.key).toBe(first.calls[0]?.build.key);
    expect(first.calls[0]?.build.cacheHit).toBe(false);
    expect(second.calls[0]?.build.cacheHit).toBe(true);
  });

  test("lowered JavaScript is executable data and preserves an own __proto__ key", async () => {
    const build = await compiler();
    const source = [
      `import { comptime as now } from ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)};`,
      `export const value = now({ "__proto__": { safe: true }, ordinary: 1 });`,
    ].join("\n");
    const result = await compileComptimeIntrinsics({ compiler: build.compiler, sources: { "main.js": source } });
    expect(result.ok).toBe(true);
    const loaded = await import(dataModule(result.loweredSources!["main.js"]!));
    expect(Object.hasOwn(loaded.value, "__proto__")).toBe(true);
    expect(loaded.value.__proto__).toEqual({ safe: true });
    expect(Object.getPrototypeOf(loaded.value)).toBe(Object.prototype);
  });

  test("cross-file .sm const data is decoded without evaluating either author module", async () => {
    const build = await compiler();
    const marker = "__smithers_cross_file_was_executed__";
    delete (globalThis as Record<string, unknown>)[marker];
    const result = await compileComptimeIntrinsics({
      compiler: build.compiler,
      sources: {
        "config.sm": `globalThis.${marker} = true\nexport const config = { source: "syntax", enabled: true } as const`,
        "main.sm": [
          `import { comptime } from ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)}`,
          `import { config } from "./config.sm"`,
          `export const value = comptime(config)`,
        ].join("\n"),
      },
    });
    expect(result.ok).toBe(true);
    expect(result.calls[0]?.value).toEqual({ source: "syntax", enabled: true });
    expect((globalThis as Record<string, unknown>)[marker]).toBeUndefined();
  });

  test("maps cross-file const replacements to their initializer and unchanged files identically", async () => {
    const build = await compiler();
    const marker = "__smithers_mapped_const_was_executed__";
    delete (globalThis as Record<string, unknown>)[marker];
    const config = [
      `globalThis.${marker} = true;`,
      `export const config = { source: "config", enabled: true } as const;`,
    ].join("\n");
    const main = [
      `import { comptime } from ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)};`,
      `import { config } from "./config.sm";`,
      `export const value = comptime(config);`,
    ].join("\n");
    const result = await compileComptimeIntrinsics({
      compiler: build.compiler,
      sources: { "main.sm": main, "config.sm": config },
    });
    expect(result.ok).toBe(true);
    expect((globalThis as Record<string, unknown>)[marker]).toBeUndefined();

    const loweredMain = result.loweredFiles!["main.sm"]!;
    const decodedMain = decodeMappings(loweredMain.sourceMap);
    expect(decodedMain.map.sources).toEqual(["main.sm", "config.sm"]);
    expect(decodedMain.map.sourcesContent).toEqual([main, config]);
    const literalOffset = loweredMain.code.indexOf("({");
    const initializerOffset = config.indexOf("{ source");
    expect(mappedPosition(loweredMain.sourceMap, loweredMain.code, literalOffset)).toEqual({
      source: "config.sm",
      ...lineColumnAt(config, initializerOffset),
    });
    expect(loweredMain.provenance.edits[1]?.mappedOrigin.file).toBe("config.sm");
    expect(loweredMain.provenance.edits[1]?.origins.map((origin) => origin.file)).toEqual([
      "config.sm",
      "main.sm",
    ]);

    const unchanged = result.loweredFiles!["config.sm"]!;
    expect(unchanged.code).toBe(config);
    expect(unchanged.provenance.edits).toEqual([]);
    expect(decodeMappings(unchanged.sourceMap).map.sourcesContent).toEqual([config]);
    const unchangedOffset = config.indexOf("export const config");
    expect(mappedPosition(unchanged.sourceMap, unchanged.code, unchangedOffset)).toEqual({
      source: "config.sm",
      ...lineColumnAt(config, unchangedOffset),
    });
  });

  test("spelling alone never grants intrinsic authority", async () => {
    const build = await compiler();
    // Spelling grants nothing: the local `comptime` is never evaluated at
    // compile time and no call is recorded. It is also not *refused* — see the
    // class test below — because the specification requires an unrelated
    // function named comptime to remain an ordinary function.
    const local = await compileComptimeIntrinsics({
      compiler: build.compiler,
      sources: { "local.ts": "function comptime(value: unknown) { return value; }\ncomptime(1);" },
    });
    expect(local.calls).toEqual([]);
    expect(local.loweredSources!["local.ts"])
      .toBe("function comptime(value: unknown) { return value; }\ncomptime(1);");

    // The one genuinely unbound spelling still reports, because a call to a
    // name that resolves to nothing is not a valid program under any reading.
    const missing = await compileComptimeIntrinsics({
      compiler: build.compiler,
      sources: { "missing.ts": "\ncomptime(1);" },
    });
    expect(missing.ok).toBe(false);
    expect(missing.diagnostics).toEqual([expect.objectContaining({
      code: ComptimeIntrinsicDiagnosticCode.MissingIdentity,
      file: "missing.ts",
      line: 2,
      column: 1,
    })]);
  });

  test("every binding form of an unrelated comptime stays an ordinary function", async () => {
    const build = await compiler();
    // specification/comptime.mdx: "The compiler MUST recognize the resolved
    // imported binding, not the local identifier text ... an unrelated function
    // named `comptime` MUST remain an ordinary function." Each source below is
    // one binding form of that rule; none may be rewritten or refused.
    const sources: Record<string, string> = {
      "helper.ts": "export function comptime(value: unknown) { return value; }",
      "reexport.ts": `export { comptime } from "./helper.js";`,
      // local declaration forms
      "declaration.ts": "function comptime(value: unknown) { return value; }\nexport const a = comptime(1);",
      "generic.ts": "function comptime<T>(value: T): T { return value; }\nexport const b = comptime({ ok: true });",
      "arrow.ts": "const comptime = (value: unknown) => value;\nexport const c = comptime(1);",
      "shadow.ts": "export function run() { function comptime(v: unknown) { return v; } return comptime(1); }",
      "parameter.ts": "export function run(comptime: (v: unknown) => unknown) { return comptime(1); }",
      // member forms
      "member.ts": "const tools = { comptime(v: unknown) { return v; } };\nexport const d = tools.comptime(1);",
      "method.ts": "class T { comptime(v: unknown) { return v; } }\nexport const e = new T().comptime(1);",
      // import forms from an ordinary module that happens to export `comptime`
      "named.ts": `import { comptime } from "./helper.js";\nexport const f = comptime(1);`,
      "alias.ts": `import { comptime as now } from "./helper.js";\nexport const g = now(1);`,
      "namespace.ts": `import * as other from "./helper.js";\nexport const h = other.comptime(1);`,
      "chained.ts": `import { comptime } from "./reexport.js";\nexport const i = comptime(1);`,
    };
    const result = await compileComptimeIntrinsics({ compiler: build.compiler, sources });
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.calls).toEqual([]);
    // Nothing was rewritten: every authored byte survives lowering.
    expect(result.loweredSources).toEqual(sources);
  });

  test("resolved intrinsic identity still wins over every unrelated binding in the same project", async () => {
    const build = await compiler();
    // The negative direction of the class test: an unrelated `comptime` in one
    // file must not stop the real intrinsic from lowering in another, and the
    // real intrinsic must still lower when it is itself aliased or shadowed
    // nowhere near its import.
    const result = await compileComptimeIntrinsics({
      compiler: build.compiler,
      sources: {
        "helper.ts": "export function comptime(value: unknown) { return value; }",
        "ordinary.ts": `import { comptime } from "./helper.js";\nexport const a = comptime(1);`,
        "direct.ts": `import { comptime } from ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)};\nexport const b = comptime({ real: 1 });`,
        "aliased.ts": `import { comptime as ct } from ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)};\nexport const c = ct({ real: 2 });`,
        "namespaced.ts":
          `import * as ct from ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)};\nexport const d = ct.comptime({ real: 3 });`,
      },
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.calls.map((call) => call.file).sort()).toEqual(["aliased.ts", "direct.ts", "namespaced.ts"]);
    expect(result.loweredSources!["ordinary.ts"])
      .toBe(`import { comptime } from "./helper.js";\nexport const a = comptime(1);`);
    expect(result.loweredSources!["direct.ts"]).toContain(`{["real"]:1}`);
    expect(result.loweredSources!["aliased.ts"]).toContain(`{["real"]:2}`);
    expect(result.loweredSources!["namespaced.ts"]).toContain(`{["real"]:3}`);
  });

  test("dynamic syntax is never executed and any frontend error prevents cache writes", async () => {
    const build = await compiler();
    const marker = "__smithers_comptime_argument_ran__";
    (globalThis as Record<string, unknown>)[marker] = 0;
    const source = [
      `import { comptime } from ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)};`,
      `comptime({ valid: true });`,
      `comptime((globalThis.${marker} = 1, { invalid: true }));`,
    ].join("\n");
    const result = await compileComptimeIntrinsics({ compiler: build.compiler, sources: { "unsafe.ts": source } });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((item) => item.code)).toContain(ComptimeIntrinsicDiagnosticCode.UnsupportedExpression);
    expect((globalThis as Record<string, unknown>)[marker]).toBe(0);
    expect(existsSync(build.cache)).toBe(false);
    delete (globalThis as Record<string, unknown>)[marker];
  });

  test("fails closed before cache activity when a correct bounded map cannot be emitted", async () => {
    const build = await compiler();
    const source = `//${"x".repeat(1_000_001)}`;
    const result = await compileComptimeIntrinsics({ compiler: build.compiler, sources: { "oversized.ts": source } });
    expect(result.ok).toBe(false);
    expect(result.loweredSources).toBeUndefined();
    expect(result.loweredFiles).toBeUndefined();
    expect(result.diagnostics).toEqual([expect.objectContaining({
      code: ComptimeIntrinsicDiagnosticCode.SourceMapFailure,
      file: "oversized.ts",
      line: 1,
      column: 1,
    })]);
    expect(existsSync(build.cache)).toBe(false);
  });

  test("noncanonical and unsupported forms fail with stable source diagnostics", async () => {
    const cases = [
      ["undefined", ComptimeIntrinsicDiagnosticCode.NoncanonicalResult],
      ["1n", ComptimeIntrinsicDiagnosticCode.NoncanonicalResult],
      ["-0", ComptimeIntrinsicDiagnosticCode.NoncanonicalResult],
      ["[, 1]", ComptimeIntrinsicDiagnosticCode.NoncanonicalResult],
      ["{ value: 1, value: 2 }", ComptimeIntrinsicDiagnosticCode.NoncanonicalResult],
      ["{ ...{ value: 1 } }", ComptimeIntrinsicDiagnosticCode.UnsupportedExpression],
      ["Math.random()", ComptimeIntrinsicDiagnosticCode.UnsupportedExpression],
    ] as const;
    for (const [expression, code] of cases) {
      const build = await compiler();
      const source = `import { comptime } from ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)};\ncomptime(${expression});`;
      const result = await compileComptimeIntrinsics({ compiler: build.compiler, sources: { "case.ts": source } });
      expect(result.ok).toBe(false);
      expect(result.diagnostics).toEqual([expect.objectContaining({ code, file: "case.ts", line: 2 })]);
    }
  });

  test("unsupported value-like uses and arity never receive runtime fallback", async () => {
    const build = await compiler();
    const valueUse = await compileComptimeIntrinsics({
      compiler: build.compiler,
      sources: {
        "value.ts": `import { comptime } from ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)};\nexport const escaped = comptime;`,
      },
    });
    expect(valueUse.diagnostics.map((item) => item.code)).toEqual([ComptimeIntrinsicDiagnosticCode.UnsupportedUse]);

    const arity = await compileComptimeIntrinsics({
      compiler: build.compiler,
      sources: {
        "arity.ts": `import { comptime } from ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)};\ncomptime();`,
      },
    });
    expect(arity.diagnostics.map((item) => item.code)).toEqual([ComptimeIntrinsicDiagnosticCode.Arity]);
  });

  test("compiler-only imports are erased and invalid import shapes fail closed", async () => {
    const build = await compiler();
    const sideEffect = await compileComptimeIntrinsics({
      compiler: build.compiler,
      sources: { "side-effect.js": `import ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)};\nexport const value = 1;` },
    });
    expect(sideEffect.ok).toBe(true);
    expect(sideEffect.loweredSources?.["side-effect.js"]).not.toContain(COMPTIME_MODULE_SPECIFIER);

    const invalid = await compileComptimeIntrinsics({
      compiler: build.compiler,
      sources: { "invalid.ts": `import defaultComptime, { other } from ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)};` },
    });
    expect(invalid.ok).toBe(false);
    expect(invalid.diagnostics.map((item) => item.code)).toEqual([
      ComptimeIntrinsicDiagnosticCode.UnsupportedUse,
      ComptimeIntrinsicDiagnosticCode.UnsupportedUse,
    ]);
    expect(invalid.loweredSources).toBeUndefined();
  });

  test("the ordinary runtime guard rejects before importer body or arguments execute", async () => {
    const bodyMarker = "__smithers_comptime_body_ran__";
    const argumentMarker = "__smithers_comptime_runtime_argument_ran__";
    delete (globalThis as Record<string, unknown>)[bodyMarker];
    delete (globalThis as Record<string, unknown>)[argumentMarker];
    const guard = dataModule(COMPTIME_RUNTIME_GUARD_SOURCE);
    const dependent = [
      `import { comptime } from ${JSON.stringify(guard)};`,
      `globalThis.${bodyMarker} = true;`,
      `comptime((globalThis.${argumentMarker} = true, 1));`,
    ].join("\n");
    await expect(import(dataModule(dependent))).rejects.toThrow(COMPTIME_RUNTIME_ERROR);
    expect((globalThis as Record<string, unknown>)[bodyMarker]).toBeUndefined();
    expect((globalThis as Record<string, unknown>)[argumentMarker]).toBeUndefined();
  });

  test("static cache entry validation rejects exotic values without invoking accessors", async () => {
    const build = await compiler();
    let getterCalls = 0;
    const hostile = Object.defineProperty({}, "value", {
      enumerable: true,
      get() {
        getterCalls++;
        return 1;
      },
    });
    await expect(build.compiler.evaluateStatic(hostile, { identity: "hostile" }))
      .rejects.toThrow("accessor");
    expect(getterCalls).toBe(0);
    await expect(build.compiler.evaluateStatic(new Date(0), { identity: "date" }))
      .rejects.toThrow("durable JSON");
  });

  test("static dependency snapshots reject path escape and digest forgery", async () => {
    const build = await compiler();
    await writeFile(join(build.root, "input.txt"), "trusted");
    await expect(build.compiler.evaluateStatic({ ok: true }, {
      identity: "escape",
      dependencies: [{ path: "../outside.txt", digest: "0".repeat(64), kind: "file", access: "text" }],
    })).rejects.toThrow(/relative|escaped|ENOENT/);
    await expect(build.compiler.evaluateStatic({ ok: true }, {
      identity: "forged",
      dependencies: [{ path: "input.txt", digest: "0".repeat(64), kind: "file", access: "text" }],
    })).rejects.toThrow("changed after it was read");
    expect(existsSync(build.cache)).toBe(false);
  });

  test("interprets let, loops, mutation, and callbacks deterministically through the shared cache", async () => {
    const build = await compiler();
    const source = [
      `import { comptime } from ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)};`,
      `export const report = comptime(() => {`,
      `  let total = 0;`,
      `  const squares = [];`,
      `  for (let i = 1; i <= 5; i++) {`,
      `    if (i === 4) continue;`,
      `    squares.push(i * i);`,
      `    total += i;`,
      `  }`,
      `  while (squares.length > 3) squares.pop();`,
      `  const doubled = squares.map((value) => value * 2);`,
      `  const kept = doubled.filter((value) => value > 2);`,
      `  const sum = kept.reduce((accumulator, value) => accumulator + value, 0);`,
      `  let vowels = 0;`,
      `  for (const letter of "audio") {`,
      `    if ("aeiou".includes(letter)) vowels++;`,
      `  }`,
      `  const record = { total };`,
      `  record.sum = sum;`,
      `  record["vowels"] = vowels;`,
      `  return { record, kept, joined: kept.join("-") };`,
      `})();`,
    ].join("\n");
    const first = await compileComptimeIntrinsics({ compiler: build.compiler, sources: { "loops.sm": source } });
    expect(first.diagnostics).toEqual([]);
    expect(first.ok).toBe(true);
    expect(first.calls[0]?.value).toEqual({
      record: { total: 11, sum: 26, vowels: 4 },
      kept: [8, 18],
      joined: "8-18",
    });
    expect(first.calls[0]?.build.cacheHit).toBe(false);

    const second = await compileComptimeIntrinsics({ compiler: build.compiler, sources: { "loops.sm": source } });
    expect(second.ok).toBe(true);
    expect(second.calls[0]?.build.cacheHit).toBe(true);
    expect(second.calls[0]?.build.key).toBe(first.calls[0]!.build.key);
    expect(second.loweredFiles?.["loops.sm"]).toEqual(first.loweredFiles?.["loops.sm"]);
    expect(second.loweredSources?.["loops.sm"]).toBe(first.loweredSources?.["loops.sm"]!);
  });

  test("interprets classic for with break, do-while, splice, slice, concat, and string pieces", async () => {
    const build = await compiler();
    const source = [
      `import { comptime } from ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)};`,
      `export const value = comptime(() => {`,
      `  const list = ["alpha", "beta", "gamma", "delta"];`,
      `  list.splice(1, 2, "mid");`,
      `  let found = -1;`,
      `  for (let i = 0; i < list.length; i++) {`,
      `    if (list[i] === "delta") {`,
      `      found = i;`,
      `      break;`,
      `    }`,
      `  }`,
      `  const copy = list.slice(0, 2).concat(["end"]);`,
      `  let count = 0;`,
      `  do {`,
      `    count++;`,
      `  } while (count < 3);`,
      `  return {`,
      `    found,`,
      `    copy,`,
      `    count,`,
      `    index: list.indexOf("mid"),`,
      `    contains: list.includes("alpha"),`,
      `    parts: "a,b,c".split(","),`,
      `    padded: "7".padStart(3, "0"),`,
      `    repeated: "ab".repeat(2),`,
      `    trimmed: "  x  ".trimStart().trimEnd(),`,
      `    first: "hello".indexOf("l"),`,
      `    last: "hello".lastIndexOf("l"),`,
      `  };`,
      `})();`,
    ].join("\n");
    const result = await compileComptimeIntrinsics({ compiler: build.compiler, sources: { "control.ts": source } });
    expect(result.diagnostics).toEqual([]);
    expect(result.calls[0]?.value).toEqual({
      found: 2,
      copy: ["alpha", "mid", "end"],
      count: 3,
      index: 1,
      contains: true,
      parts: ["a", "b", "c"],
      padded: "007",
      repeated: "abab",
      trimmed: "x",
      first: 2,
      last: 3,
    });
  });

  test("interprets Object.keys, values, entries, and fromEntries", async () => {
    const build = await compiler();
    const source = [
      `import { comptime } from ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)};`,
      `export const value = comptime(() => {`,
      `  const source = { b: 2, a: 1 };`,
      `  const flipped = Object.fromEntries(Object.entries(source).map((pair) => [pair[0], pair[1] * 10]));`,
      `  return { keys: Object.keys(source), values: Object.values(source), flipped };`,
      `})();`,
    ].join("\n");
    const result = await compileComptimeIntrinsics({ compiler: build.compiler, sources: { "objects.ts": source } });
    expect(result.diagnostics).toEqual([]);
    expect(result.calls[0]?.value).toEqual({
      keys: ["b", "a"],
      values: [2, 1],
      flipped: { b: 20, a: 10 },
    });
  });

  test("embedded text drives loops and stays a tracked cache dependency", async () => {
    const build = await compiler();
    const source = [
      `import { comptime, embed } from ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)};`,
      `export const rows = comptime(() => {`,
      `  const lines = embed("./data.txt").split("\\n");`,
      `  const rows = [];`,
      `  for (const line of lines) {`,
      `    if (line === "") continue;`,
      `    rows.push(line.toUpperCase());`,
      `  }`,
      `  return rows;`,
      `})();`,
    ].join("\n");
    await writeFile(join(build.root, "embed-loop.sm"), source);
    await writeFile(join(build.root, "data.txt"), "north\nsouth\n");
    const first = await compileComptimeIntrinsics({ compiler: build.compiler, sources: { "embed-loop.sm": source } });
    expect(first.diagnostics).toEqual([]);
    expect(first.calls[0]?.value).toEqual(["NORTH", "SOUTH"]);
    expect(first.calls[0]?.build.dependencies).toEqual([
      expect.objectContaining({ path: "data.txt", kind: "file", access: "text" }),
    ]);
    const warm = await compileComptimeIntrinsics({ compiler: build.compiler, sources: { "embed-loop.sm": source } });
    expect(warm.calls[0]?.build.cacheHit).toBe(true);
    await writeFile(join(build.root, "data.txt"), "east\n");
    const changed = await compileComptimeIntrinsics({ compiler: build.compiler, sources: { "embed-loop.sm": source } });
    expect(changed.calls[0]?.build.cacheHit).toBe(false);
    expect(changed.calls[0]?.value).toEqual(["EAST"]);
  });

  test("every evaluation budget fails closed as deterministic VCT1012", async () => {
    const bodies = [
      "let n = 0; while (true) n++; return n;",
      "const out = []; for (let i = 0; i < 500000; i++) out.push(i); return out.length;",
      'let s = "x"; while (true) s += s; return s.length;',
      'return "y".repeat(9007199254740991).length;',
    ];
    for (const body of bodies) {
      const build = await compiler();
      const source = [
        `import { comptime } from ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)};`,
        `export const value = comptime(() => { ${body} })();`,
      ].join("\n");
      const result = await compileComptimeIntrinsics({ compiler: build.compiler, sources: { "budget.ts": source } });
      expect(result.ok).toBe(false);
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
        ComptimeIntrinsicDiagnosticCode.Budget,
      ]);
      expect(existsSync(build.cache)).toBe(false);
    }

    const recursion = await compiler();
    const source = [
      `import { comptime } from ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)};`,
      `function down(n) { return down(n + 1); }`,
      `export const value = comptime(() => down(0))();`,
    ].join("\n");
    const result = await compileComptimeIntrinsics({ compiler: recursion.compiler, sources: { "deep.js": source } });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      ComptimeIntrinsicDiagnosticCode.Budget,
    ]);
  });

  test("an exhausted step budget names the innermost loop, not the node the counter landed on", async () => {
    // The step counter's landing site is deterministic but arbitrary: it is a
    // function of an internal total rather than of program structure, and it
    // squiggles an expression that is not itself defective. The construct the
    // author must repair is the loop that did not terminate.
    const nested = await compiler();
    const nestedSource = [
      `import { comptime } from ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)};`,
      `export const spun = comptime(() => {`,
      `  let n = 0;`,
      `  for (let outer = 0; outer < 2; outer++) {`,
      `    while (true) {`,
      `      n = n + 1;`,
      `    }`,
      `  }`,
      `  return n;`,
      `})();`,
    ].join("\n");
    const nestedResult = await compileComptimeIntrinsics({
      compiler: nested.compiler,
      sources: { "nested.ts": nestedSource },
    });
    expect(nestedResult.ok).toBe(false);
    expect(nestedResult.diagnostics).toHaveLength(1);
    const nestedDiagnostic = nestedResult.diagnostics[0]!;
    expect(nestedDiagnostic.code).toBe(ComptimeIntrinsicDiagnosticCode.Budget);
    // Line 5, column 5 is the `while` keyword of the innermost loop.
    expect({ line: nestedDiagnostic.line, column: nestedDiagnostic.column }).toEqual({ line: 5, column: 5 });
    expect(nestedSource.split("\n")[nestedDiagnostic.line - 1]!.slice(nestedDiagnostic.column - 1, nestedDiagnostic.column + 4))
      .toBe("while");

    // A loop whose header never becomes false is still that loop's defect: the
    // loop is entered before its condition is evaluated.
    const header = await compiler();
    const headerSource = [
      `import { comptime } from ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)};`,
      `export const stuck = comptime(() => {`,
      `  let i = 0;`,
      `  for (let n = 0; n < 10; n = n) { i = i + 1; }`,
      `  return i;`,
      `})();`,
    ].join("\n");
    const headerResult = await compileComptimeIntrinsics({
      compiler: header.compiler,
      sources: { "header.ts": headerSource },
    });
    expect(headerResult.ok).toBe(false);
    expect(headerResult.diagnostics).toHaveLength(1);
    const headerDiagnostic = headerResult.diagnostics[0]!;
    expect(headerDiagnostic.code).toBe(ComptimeIntrinsicDiagnosticCode.Budget);
    expect({ line: headerDiagnostic.line, column: headerDiagnostic.column }).toEqual({ line: 4, column: 3 });
    expect(headerSource.split("\n")[headerDiagnostic.line - 1]!.slice(headerDiagnostic.column - 1, headerDiagnostic.column + 2))
      .toBe("for");

    // The same principle already governed the call-depth budget, which names
    // the runaway function rather than the sub-expression the interpreter was
    // evaluating when the frame limit was reached. Unbounded recursion carries
    // no executing loop, so it stays on that path.
    const recursive = await compiler();
    const recursiveSource = [
      `import { comptime } from ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)};`,
      `function grow(n) { return grow(n + 1); }`,
      `export const value = comptime(() => grow(0))();`,
    ].join("\n");
    const recursiveResult = await compileComptimeIntrinsics({
      compiler: recursive.compiler,
      sources: { "recursive.js": recursiveSource },
    });
    expect(recursiveResult.ok).toBe(false);
    expect(recursiveResult.diagnostics).toHaveLength(1);
    expect(recursiveResult.diagnostics[0]!.code).toBe(ComptimeIntrinsicDiagnosticCode.Budget);
    expect({ line: recursiveResult.diagnostics[0]!.line, column: recursiveResult.diagnostics[0]!.column })
      .toEqual({ line: 2, column: 1 });
  });

  test("ambient state stays unreachable inside loops", async () => {
    const expressions = ["Date.now()", "Math.random()", "process.env.PATH"];
    for (const expression of expressions) {
      const build = await compiler();
      const source = [
        `import { comptime } from ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)};`,
        `export const value = comptime(() => {`,
        `  let total = 0;`,
        `  for (let i = 0; i < 3; i++) total += ${expression};`,
        `  return total;`,
        `})();`,
      ].join("\n");
      const result = await compileComptimeIntrinsics({ compiler: build.compiler, sources: { "ambient.ts": source } });
      expect(result.ok).toBe(false);
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
        ComptimeIntrinsicDiagnosticCode.UnsupportedExpression,
      ]);
      expect(existsSync(build.cache)).toBe(false);
    }
  });

  test("shared module data stays immutable and evaluation-owned cycles fail closed", async () => {
    const build = await compiler();
    const mutation = await compileComptimeIntrinsics({
      compiler: build.compiler,
      sources: {
        "shared.ts": [
          `import { comptime } from ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)};`,
          `const shared = [1];`,
          `export const value = comptime(() => {`,
          `  shared.push(2);`,
          `  return shared;`,
          `})();`,
        ].join("\n"),
      },
    });
    expect(mutation.ok).toBe(false);
    expect(mutation.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      ComptimeIntrinsicDiagnosticCode.UnsupportedExpression,
    ]);

    const cyclic = await compileComptimeIntrinsics({
      compiler: build.compiler,
      sources: {
        "cyclic.ts": [
          `import { comptime } from ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)};`,
          `export const value = comptime(() => {`,
          `  const loop = [];`,
          `  loop.push(loop);`,
          `  return loop;`,
          `})();`,
        ].join("\n"),
      },
    });
    expect(cyclic.ok).toBe(false);
    expect(cyclic.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      ComptimeIntrinsicDiagnosticCode.NoncanonicalResult,
    ]);
    expect(existsSync(build.cache)).toBe(false);
  });

  test("uninitialized reads, var locals, and labeled loops fail closed", async () => {
    const cases = [
      "let x; if (0) x = 1; return x + 1;",
      "var x = 1; return x;",
      "outer: for (let i = 0; i < 3; i++) { break outer; } return 1;",
    ];
    for (const body of cases) {
      const build = await compiler();
      const source = [
        `import { comptime } from ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)};`,
        `export const value = comptime(() => { ${body} })();`,
      ].join("\n");
      const result = await compileComptimeIntrinsics({ compiler: build.compiler, sources: { "closed.ts": source } });
      expect(result.ok).toBe(false);
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
        ComptimeIntrinsicDiagnosticCode.UnsupportedExpression,
      ]);
    }
  });

  test("compile-time functions call each other and share one budget per call tree", async () => {
    const build = await compiler();
    const source = [
      `import { comptime } from ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)};`,
      `const double = comptime((value: number) => value * 2);`,
      `const sumDoubled = comptime((limit: number) => {`,
      `  let total = 0;`,
      `  for (let i = 0; i < limit; i++) total += double(i);`,
      `  return total;`,
      `});`,
      `export const value = sumDoubled(4);`,
    ].join("\n");
    const result = await compileComptimeIntrinsics({ compiler: build.compiler, sources: { "compose.ts": source } });
    expect(result.diagnostics).toEqual([]);
    expect(result.calls[0]?.value).toBe(12);
    const lowered = result.loweredSources!["compose.ts"]!;
    expect(lowered).not.toContain("double");
    expect(lowered).toContain("12");

    const shared = await compiler();
    const burnSource = [
      `import { comptime } from ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)};`,
      `const burn = comptime(() => {`,
      `  let n = 0;`,
      `  while (n < 60000) n++;`,
      `  return n;`,
      `});`,
      `export const alone = burn();`,
    ].join("\n");
    const alone = await compileComptimeIntrinsics({ compiler: shared.compiler, sources: { "alone.ts": burnSource } });
    expect(alone.ok).toBe(true);
    expect(alone.calls[0]?.value).toBe(60000);

    const treeSource = [
      `import { comptime } from ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)};`,
      `const burn = comptime(() => {`,
      `  let n = 0;`,
      `  while (n < 60000) n++;`,
      `  return n;`,
      `});`,
      `const tree = comptime(() => {`,
      `  let total = 0;`,
      `  for (let round = 0; round < 12; round++) total += burn();`,
      `  return total;`,
      `});`,
      `export const value = tree();`,
    ].join("\n");
    const tree = await compileComptimeIntrinsics({ compiler: shared.compiler, sources: { "tree.ts": treeSource } });
    expect(tree.ok).toBe(false);
    expect(tree.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      ComptimeIntrinsicDiagnosticCode.Budget,
    ]);
  });

  test("marked calls inside retained runtime functions lower at their call sites", async () => {
    const build = await compiler();
    const source = [
      `import { comptime } from ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)};`,
      `export function wrapper() { return helperAtBuild(); }`,
      `const helperAtBuild = comptime(() => 1);`,
      `const wrapperAtBuild = comptime(wrapper);`,
      `export const value = wrapperAtBuild();`,
    ].join("\n");
    const result = await compileComptimeIntrinsics({ compiler: build.compiler, sources: { "retained-call.js": source } });
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.calls.map((call) => call.value)).toEqual([1, 1]);
    const lowered = result.loweredSources!["retained-call.js"]!;
    expect(lowered).not.toContain("helperAtBuild");
    expect(lowered).not.toContain("wrapperAtBuild");
    expect(lowered).toContain("return 1");
    const loaded = await import(dataModule(lowered));
    expect(loaded.value).toBe(1);
    expect(loaded.wrapper()).toBe(1);
  });

  test("static cache objects remain bound to their content key after coherent tampering", async () => {
    const build = await compiler();
    const first = await build.compiler.evaluateStatic({ answer: 42 }, { identity: { call: "one" } });
    const objectPath = join(build.cache, "comptime-objects", `${first.key}.json`);
    const envelope = JSON.parse(await readFile(objectPath, "utf8"));
    envelope.build.value = { answer: 9001 };
    envelope.outputDigest = digest(envelope.build);
    await writeFile(objectPath, JSON.stringify(envelope));

    const rebuilt = await build.compiler.evaluateStatic({ answer: 42 }, { identity: { call: "one" } });
    expect(rebuilt.cacheHit).toBe(false);
    expect(rebuilt.value).toEqual({ answer: 42 });
    expect(rebuilt.key).toBe(first.key);
  });
});

describe("type-producing comptime", () => {
  test("mixed value and type usage lowers to a merged const plus literal type alias", async () => {
    const build = await compiler();
    const source = [
      `import { comptime } from ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)};`,
      `function deriveAccount() {`,
      `  return { id: "string", active: true, limits: [1, 2] };`,
      `}`,
      `const Account = comptime(deriveAccount());`,
      `export function open(account: Account): Account { return account; }`,
      `export const defaults = Account;`,
      `export const opened = open(defaults);`,
    ].join("\n");
    const result = await compileComptimeIntrinsics({ compiler: build.compiler, sources: { "account.ts": source } });
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
    const lowered = result.loweredSources!["account.ts"]!;
    expect(lowered).toContain("const Account = ((");
    expect(lowered).toContain("as const");
    expect(lowered).toContain(
      'type Account = { readonly "active": true; readonly "id": "string"; readonly "limits": readonly [1, 2]; };',
    );
    expect(result.loweredFiles?.["account.ts"]?.provenance.edits.map((edit) => edit.kind)).toEqual([
      "remove-import",
      "intrinsic-call",
      "type-alias",
    ]);
    expect(checkEmittedTypeScript(lowered, join(build.root, "account.ts"))
      .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)).toEqual([]);
    const loaded = await import(dataModule(executableJavaScript(lowered)));
    expect(loaded.defaults).toEqual({ id: "string", active: true, limits: [1, 2] });
    expect(loaded.opened).toEqual(loaded.defaults);
  });

  test("the generated type constrains downstream checking", async () => {
    const build = await compiler();
    const source = [
      `import { comptime } from ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)};`,
      `const Account = comptime({ id: "string" });`,
      `export function open(account: Account): Account { return account; }`,
      `export const bad = open({ id: "number" });`,
    ].join("\n");
    const result = await compileComptimeIntrinsics({ compiler: build.compiler, sources: { "bad.ts": source } });
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
    const lowered = result.loweredSources!["bad.ts"]!;
    expect(lowered).toContain('type Account = { readonly "id": "string"; };');
    const errors = checkEmittedTypeScript(lowered, join(build.root, "bad.ts"))
      .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
    expect(errors.length).toBeGreaterThan(0);
  });

  test("type-only usage erases the runtime const entirely", async () => {
    const build = await compiler();
    const source = [
      `import { comptime } from ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)};`,
      `const Account = comptime({ id: "string", nested: { flag: true } });`,
      `export function open(account: Account): string { return account.id; }`,
    ].join("\n");
    const result = await compileComptimeIntrinsics({ compiler: build.compiler, sources: { "erased.ts": source } });
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
    const lowered = result.loweredSources!["erased.ts"]!;
    expect(lowered).not.toContain("const Account");
    expect(lowered).toContain(
      'type Account = { readonly "id": "string"; readonly "nested": { readonly "flag": true; }; };',
    );
    expect(result.loweredFiles?.["erased.ts"]?.provenance.edits.map((edit) => edit.kind)).toEqual([
      "remove-import",
      "type-alias",
    ]);
    expect(checkEmittedTypeScript(lowered, join(build.root, "erased.ts"))
      .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)).toEqual([]);
    const loaded = await import(dataModule(executableJavaScript(lowered)));
    expect("Account" in loaded).toBe(false);
    expect(loaded.open({ id: "hi", nested: { flag: true } })).toBe("hi");
  });

  test("exported bindings keep the const and export the merged type across files", async () => {
    const build = await compiler();
    const mainSource = [
      `import { comptime } from ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)};`,
      `export const Account = comptime({ id: "string" });`,
    ].join("\n");
    const consumerSource = [
      `import { Account } from "./main.ts";`,
      `export function open(account: Account): Account { return account; }`,
      `export const fallback = Account;`,
    ].join("\n");
    const result = await compileComptimeIntrinsics({
      compiler: build.compiler,
      sources: { "main.ts": mainSource, "consumer.ts": consumerSource },
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
    const loweredMain = result.loweredSources!["main.ts"]!;
    expect(loweredMain).toContain("export const Account = ((");
    expect(loweredMain).toContain('export type Account = { readonly "id": "string"; };');
    expect(result.loweredSources!["consumer.ts"]).toBe(consumerSource);
    expect(checkEmittedProject([
      { fileName: join(build.root, "main.ts"), code: loweredMain },
      { fileName: join(build.root, "consumer.ts"), code: result.loweredSources!["consumer.ts"]! },
    ]).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)).toEqual([]);
  });

  test("schema-derived bindings used in type position fail closed with VCT1013", async () => {
    const build = await compiler();
    const source = [
      `import { comptime } from ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)};`,
      `import { Schema } from ${JSON.stringify(SCHEMA_MODULE_SPECIFIER)};`,
      `const Account = comptime(Schema.derive<{ id: string }>());`,
      `export function open(account: Account): Account { return account; }`,
    ].join("\n");
    const result = await compileComptimeIntrinsics({ compiler: build.compiler, sources: { "schema-type.ts": source } });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      ComptimeIntrinsicDiagnosticCode.TypeProduction,
    ]);
    expect(existsSync(build.cache)).toBe(false);
  });

  test("oversized literal types fail closed with VCT1013", async () => {
    const build = await compiler();
    const source = [
      `import { comptime } from ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)};`,
      `const Big = comptime(() => {`,
      `  const out = [];`,
      `  for (let i = 0; i < 20000; i++) out.push("aaaaaaaa");`,
      `  return out;`,
      `})();`,
      `export function width(value: Big): number { return value.length; }`,
    ].join("\n");
    const result = await compileComptimeIntrinsics({ compiler: build.compiler, sources: { "big.ts": source } });
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      ComptimeIntrinsicDiagnosticCode.TypeProduction,
    ]);
  });

  test("value-only bindings never receive a type alias", async () => {
    const build = await compiler();
    const source = [
      `import { comptime } from ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)};`,
      `const config = comptime({ port: 8080 });`,
      `export const port = config.port;`,
    ].join("\n");
    const result = await compileComptimeIntrinsics({ compiler: build.compiler, sources: { "plain.ts": source } });
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.loweredSources!["plain.ts"]).not.toContain("type config");
    expect(result.loweredFiles?.["plain.ts"]?.provenance.edits.map((edit) => edit.kind)).toEqual([
      "remove-import",
      "intrinsic-call",
    ]);
  });
});

test("a compiler-owned virtual module is erased, so no other module form may reach it", async () => {
  const build = await compiler();
  // Recognition already followed resolved checker identity, but erasure only
  // covered `import ... from`. These forms therefore survived lowering as a
  // runtime edge to a module that has no runtime existence, and the import
  // assignment additionally kept its intrinsic authority while doing so.
  for (const specifier of [COMPTIME_MODULE_SPECIFIER, SCHEMA_MODULE_SPECIFIER]) {
    const quoted = JSON.stringify(specifier);
    const expected = specifier === SCHEMA_MODULE_SPECIFIER
      ? ComptimeIntrinsicDiagnosticCode.SchemaImportShape
      : ComptimeIntrinsicDiagnosticCode.UnsupportedUse;
    for (const [label, source] of [
      ["star re-export", `export * from ${quoted};`],
      ["namespace re-export", `export * as owned from ${quoted};`],
      ["import assignment", `import owned = require(${quoted});\nexport const y = 1;`],
      ["exported import assignment", `export import owned = require(${quoted});\nexport const y = 1;`],
      ["dynamic import", `export const pending = import(${quoted});`],
    ] as const) {
      const result = await compileComptimeIntrinsics({
        compiler: build.compiler,
        sources: { "misuse.ts": source },
      });
      expect(result.ok, `${specifier} ${label}`).toBe(false);
      expect(result.loweredSources, `${specifier} ${label}`).toBeUndefined();
      expect(result.diagnostics.map((entry) => entry.code), `${specifier} ${label}`).toContain(expected);
    }
  }

  // Both directions: every import form that legitimately reaches the intrinsic
  // still compiles, still evaluates, and still erases its import.
  for (const [label, source, calls] of [
    ["named", `import { comptime } from ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)};\nexport const x = comptime(1 + 1);`, 1],
    ["aliased", `import { comptime as ct } from ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)};\nexport const x = ct(1 + 1);`, 1],
    ["namespace", `import * as owned from ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)};\nexport const x = owned.comptime(1 + 1);`, 1],
    ["side effect", `import ${JSON.stringify(COMPTIME_MODULE_SPECIFIER)};\nexport const y = 1;`, 0],
  ] as const) {
    const result = await compileComptimeIntrinsics({
      compiler: build.compiler,
      sources: { "ok.ts": source },
    });
    expect(result.ok, label).toBe(true);
    expect(result.calls, label).toHaveLength(calls);
    expect(result.loweredSources!["ok.ts"], label).not.toContain(COMPTIME_MODULE_SPECIFIER);
  }
})
