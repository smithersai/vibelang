import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { getNativeCompiler } from "./native.ts";
import {
  decodeNativeGeneratedProject, decodeNativeLanguageAnalysis, NATIVE_API_VERSION,
  type NativeDependencyTrace,
} from "./protocol.ts";
import { analyzeProject } from "../language/analyze.ts";
import { compileProject } from "../language/project-compile.ts";
import { checkEmittedProject } from "../language/generated-check.ts";

const root = mkdtempSync(join(tmpdir(), "vibelang-dependency-trace-"));
const nativePath = (name: string) => resolve(root, name).replaceAll("\\", "/");
afterAll(() => rmSync(root, { recursive: true, force: true }));
const revision = "a".repeat(40);
const languageRequest = { files: [], traceDependencies: true, resolutionRoot: root } as const;
const generatedRequest = { files: [], traceDependencies: true, currentDirectory: root, diskDependencies: true } as const;
const wire = (result: unknown) => JSON.stringify({ apiVersion: NATIVE_API_VERSION, compilerRevision: revision, result });

for (const mode of ["analysis", "generated"] as const) {
  const decode = (dependencies: unknown) => mode === "analysis"
    ? decodeNativeLanguageAnalysis(wire({ checked: true, diagnostics: [], files: [], dependencies }), revision, languageRequest)
    : decodeNativeGeneratedProject(wire({ diagnostics: [], dependencies }), revision, generatedRequest);
  test(`${mode} trace accepts an exact bounded inventory`, () => {
    const dependencies = { files: [nativePath("a.ts"), nativePath("z.ts")], directories: [nativePath(".")] };
    expect(decode(dependencies).dependencies).toEqual(dependencies);
  });
  for (const [name, dependencies] of [
    ["absent", undefined], ["null", null], ["not a record", []],
    ["missing files", { directories: [] }], ["missing directories", { files: [] }],
    ["null files", { files: null, directories: [] }],
    ["extra authority", { files: [], directories: [], trusted: true }],
    ["relative path", { files: ["a.ts"], directories: [] }],
    ["parent segment", { files: [nativePath(".") + "/a/../b.ts"], directories: [] }],
    ["dot segment", { files: [nativePath(".") + "/./b.ts"], directories: [] }],
    ["nul", { files: [nativePath("a\0.ts")], directories: [] }],
    ["backslash", { files: [nativePath(".") + "/a\\b.ts"], directories: [] }],
    ["duplicate", { files: [nativePath("a.ts"), nativePath("a.ts")], directories: [] }],
    ["unsorted", { files: [nativePath("z.ts"), nativePath("a.ts")], directories: [] }],
    ["oversized path", { files: [nativePath("x".repeat(16 * 1024))], directories: [] }],
    ["oversized UTF8 path", { files: [nativePath("é".repeat(9000))], directories: [] }],
    ["too many paths", { files: Array.from({ length: 8193 }, (_, i) => nativePath(String(i).padStart(5, "0"))), directories: [] }],
    ["too many bytes", { files: Array.from({ length: 3000 }, (_, i) => nativePath(`${String(i).padStart(5, "0")}-${"x".repeat(900)}`)), directories: [] }],
  ] as const) test(`${mode} trace refuses ${name}`, () => expect(() => decode(dependencies)).toThrow());
}

test("analysis trace cannot extend its request's resolution authority", () => {
  expect(() => decodeNativeLanguageAnalysis(wire({ checked: true, diagnostics: [], files: [],
    dependencies: { files: [nativePath("../escaped.ts")], directories: [] } }), revision, languageRequest)).toThrow("escaped");
});

test("both native protocol decoders refuse unsolicited inventories", () => {
  const dependencies = { files: [], directories: [] };
  expect(() => decodeNativeLanguageAnalysis(wire({ checked: true, diagnostics: [], files: [], dependencies }), revision, { files: [] })).toThrow();
  expect(() => decodeNativeGeneratedProject(wire({ diagnostics: [], dependencies }), revision,
    { ...generatedRequest, traceDependencies: false })).toThrow();
});

test("closed project requests cannot claim filesystem reads in either protocol", () => {
  const dependencies = { files: [nativePath("unread.ts")], directories: [] };
  expect(() => decodeNativeLanguageAnalysis(wire({ checked: true, diagnostics: [], files: [], dependencies }), revision,
    { files: [], traceDependencies: true })).toThrow("closed language project");
  expect(() => decodeNativeGeneratedProject(wire({ diagnostics: [], dependencies }), revision,
    { ...generatedRequest, diskDependencies: false })).toThrow("closed generated project");
});

function write(name: string, source: string) {
  const file = join(root, name);
  mkdirSync(resolve(file, ".."), { recursive: true });
  writeFileSync(file, source);
}

test("public analysis and lowering expose package and foreign-file dependencies without changing code", () => {
  write("node_modules/watched/package.json", '{"name":"watched","types":"index.d.ts"}');
  write("node_modules/watched/index.d.ts", '/** @module @throws {never} */\nexport declare const value: 42;');
  write("local.ts", '/** @module @throws {never} */\nexport const local = 1;');
  const sources = [{ fileName: "main.vibe", source: 'import {value} from "watched";import {local} from "./local.js";export const answer = value + local;' }];
  const options = { rootDir: root, outDir: join(root, "out"), traceDependencies: true };
  const analysis = analyzeProject(sources, options);
  const compiled = compileProject(sources, options);
  expect(analysis.diagnostics).toEqual([]);
  expect(compiled.diagnostics).toEqual([]);
  for (const result of [analysis, compiled]) {
    for (const name of ["node_modules/watched/package.json", "node_modules/watched/index.d.ts", "local.ts"])
      expect(result.dependencies!.files).toContain(nativePath(name));
    expect(result.dependencies!.files).not.toContain(nativePath("main.vibe"));
    expect(result.dependencies!.directories).not.toContain(nativePath("."));
    expect(result.dependencies!.directories).not.toContain(nativePath("node_modules/watched"));
  }
  const ordinary = compileProject(sources, { ...options, traceDependencies: false });
  expect(ordinary.dependencies).toBeUndefined();
  expect(ordinary.files).toEqual(compiled.files);
  expect(ordinary.diagnostics).toEqual(compiled.diagnostics);
});

test("generated checking reports dependencies even when a dependency makes the output invalid", () => {
  write("changed.ts", 'export const value = "wrong";');
  let trace: NativeDependencyTrace | undefined;
  const diagnostics = checkEmittedProject([{ fileName: nativePath("generated.ts"), code:
    'import {value} from "./changed.js";export const answer:number = value;' }], { onDependencies(value) { trace = value; } });
  expect(diagnostics.some(diagnostic => diagnostic.code === "TS2322")).toBe(true);
  expect(trace!.files).toContain(nativePath("changed.ts"));
});

test("a negative native probe remains watchable after a refused project", () => {
  const result = analyzeProject([{ fileName: "missing.vibe", source:
    'import {value} from "./not-created.js";export const answer = value;' }], { rootDir: root, traceDependencies: true });
  expect(result.diagnostics.some(diagnostic => diagnostic.severity === "error")).toBe(true);
  expect(result.dependencies!.files).toContain(nativePath("not-created.ts"));
});

test("missing directory probes remain watchable without watching every existing ancestor", () => {
  const result = analyzeProject([{ fileName: "missing-directory.vibe", source:
    'import {value} from "./not-a-directory/value.js";export const answer=value;' }], { rootDir: root, traceDependencies: true });
  expect(result.diagnostics.some(diagnostic => diagnostic.severity === "error")).toBe(true);
  expect(result.dependencies!.directories).toContain(nativePath("not-a-directory"));
  expect(result.dependencies!.directories).not.toContain(nativePath("."));
});

test("explicit foreign source bytes are not reported as mutable disk reads", () => {
  write("overlaid.ts", 'export const value = "wrong";');
  const result = getNativeCompiler().analyzeLanguage({ traceDependencies: true, resolutionRoot: root,
    files: [{ path: "overlay.vibe", kind: "vibelang", text: 'import {value} from "./overlaid.ts";export const answer:number=value;' },
      { path: "overlaid.ts", kind: "typescript", text: '/** @module @throws {never} */\nexport const value = 42;' }] });
  expect(result.checked).toBe(true);
  expect(result.dependencies!.files).not.toContain(nativePath("overlaid.ts"));
});
