import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { nativeTestJavaScript } from "../../test/native-transpile.ts";
import { compileAndCheckProject, compileProject, emitProjectDeclarations } from "./index.ts";

const runtime = resolve(import.meta.dir, "../runtime/index.ts");

async function publish(root: string, source: string, name = "library") {
  const library = compileProject([{ fileName: `${name}.vibe`, source }], {
    rootDir: root, outDir: root, outputExtension: ".mjs", sourceMap: false, runtimeImport: runtime,
  });
  expect(library.diagnostics).toEqual([]);
  const files = Object.values(library.files);
  const declarations = emitProjectDeclarations(files.map(file => ({
    fileName: file.outputFileName, code: file.code, effects: file.analysis.rows, runtimeModule: runtime,
  })));
  expect(declarations.diagnostics.map(issue => issue.message)).toEqual([]);
  expect(declarations.ok).toBe(true);
  for (const file of declarations.outputs) await writeFile(file.fileName, file.code);
  for (const file of files) await writeFile(file.outputFileName, nativeTestJavaScript(file.code));
  // No implementation .vibe/.ts file is written. A fresh consumer sees only the
  // actual published declaration, as it would across a package boundary.
  return declarations.outputs.map(file => file.code).join("\n");
}

const library = `import { Context } from "vibelang/context"
export abstract class C extends Context { abstract value(): number }
export class Missing extends Error {}
export function read(): number { return C.context().value() }
export function fallible(): Result<number, Missing> { return C.context().value() }
export async function readAsync(): Promise<number> { return C.context().value() }
`;

test("published calls keep their eager convention and rows with implementation sources unavailable", async () => {
  const root = await mkdtemp(join(tmpdir(), "vibelang-declaration-abi-"));
  try {
    const declaration = await publish(root, library);
    expect(declaration).toContain("function read(): number");
    const compiled = compileAndCheckProject([{ fileName: "consumer.vibe", source: `
import { C, read, fallible, readAsync } from "./library.mjs"
import { Layer } from "vibelang/provider"
export async function main(): Promise<number[]> {
  return await Layer.provide(Layer.succeed(C, { value: () => 7 }), async () => {
    const first = read()
    const second = fallible().unwrapOr(0)
    return [first, second, await readAsync()]
  })
}` }], { rootDir: root, outDir: root, outputExtension: ".mjs", sourceMap: false, runtimeImport: runtime });
    expect(compiled.result.diagnostics).toEqual([]);
    expect(compiled.emitDiagnostics.map(issue => issue.message)).toEqual([]);
    expect(compiled.ok).toBe(true);
    const file = compiled.result.files["consumer.vibe"]!;
    await writeFile(file.outputFileName, nativeTestJavaScript(file.code));
    const consumer = await import(pathToFileURL(file.outputFileName).href);
    expect(await consumer.main()).toEqual([7, 7, 7]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("adding an exported alias cannot change a published function's calling convention", async () => {
  const root = await mkdtemp(join(tmpdir(), "vibelang-declaration-alias-"));
  try {
    const before = await publish(root, library);
    const after = await publish(root, library + "\nexport const alias = read\n");
    const signature = (code: string) => code.split("\n").find(line => line.includes("function read("));
    expect(signature(before)).toBe(signature(after));
    expect(signature(after)).toContain("function read(): number");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("published function values, members and returned closures retain their own requirements", async () => {
  const root = await mkdtemp(join(tmpdir(), "vibelang-declaration-values-"));
  try {
    await publish(root, library.replace('export class Missing extends Error {}', '').replace('export function fallible(): Result<number, Missing> { return C.context().value() }', '') + `
function hidden(): number { return C.context().value() }
export const alias = hidden
export const arrow = () => C.context().value()
export const api = { read() { return C.context().value() }, arrow: () => C.context().value() }
export class Reader { read() { return C.context().value() } }
export class Overloaded { read(): number; read(n: number): number; read(n = 0) { return C.context().value() + n } }
export function factory() { return () => C.context().value() }
export function nested() { return { inner: { read: () => C.context().value() } } }
`);
    const expressions = ["read()", "alias()", "arrow()", "api.read()", "api.arrow()", "new Reader().read()", "new Overloaded().read()", "new Overloaded().read(1)", "factory()()", "nested().inner.read()"];
    for (const expression of expressions) {
      const consumer = compileProject([{ fileName: "consumer.vibe", source: `
import { read, alias, arrow, api, Reader, Overloaded, factory, nested } from "./library.mjs"
export function main(): number { return ${expression} }
` }], { rootDir: root, outDir: root, outputExtension: ".mjs", sourceMap: false, runtimeImport: runtime });
      expect([expression, consumer.files["consumer.vibe"]!.analysis.rows.main?.requirements]).toEqual([expression, ["C"]]);
      expect(consumer.diagnostics).toEqual([]);
    }
    const executed = compileAndCheckProject([{ fileName: "executed.vibe", source: `
import { C, read, alias, arrow, api, Reader, Overloaded, factory, nested } from "./library.mjs"
import { Layer } from "vibelang/provider"
export function main(): number[] {
  return Layer.provide(Layer.succeed(C, { value: () => 7 }), () => [${expressions.join(",")}])
}
` }], { rootDir: root, outDir: root, outputExtension: ".mjs", sourceMap: false, runtimeImport: runtime });
    expect(executed.result.diagnostics).toEqual([]);
    expect(executed.emitDiagnostics.map(issue => issue.message)).toEqual([]);
    const file = executed.result.files["executed.vibe"]!;
    await writeFile(file.outputFileName, nativeTestJavaScript(file.code));
    expect((await import(pathToFileURL(file.outputFileName).href)).main()).toEqual([7, 7, 7, 7, 7, 7, 7, 8, 7, 7]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a package forwarding a call retains a nominal requirement without importing its constructor", async () => {
  const root = await mkdtemp(join(tmpdir(), "vibelang-declaration-forward-"));
  try {
    await publish(root, library);
    await publish(root, 'import { read } from "./library.mjs"; export function forwarded() { return read() }', "forward");
    const consumer = compileProject([{ fileName: "consumer.vibe", source: 'import { forwarded } from "./forward.mjs"; export function main() { return forwarded() }' }],
      { rootDir: root, outDir: root, outputExtension: ".mjs", sourceMap: false, runtimeImport: runtime });
    expect(consumer.diagnostics).toEqual([]);
    expect(consumer.files["consumer.vibe"]!.analysis.rows.main?.requirements).toEqual(["C"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a private module capability remains reachable from its published requirement table", async () => {
  const root = await mkdtemp(join(tmpdir(), "vibelang-declaration-private-"));
  try {
    const declaration = await publish(root, library.replace("export abstract class C", "abstract class C"));
    expect(declaration).toContain('readonly "C": typeof C');
    const consumer = compileProject([{ fileName: "consumer.vibe", source: 'import { read } from "./library.mjs"; export function main() { return read() }' }],
      { rootDir: root, outDir: root, outputExtension: ".mjs", sourceMap: false, runtimeImport: runtime });
    expect(consumer.diagnostics).toEqual([]);
    expect(consumer.files["consumer.vibe"]!.analysis.rows.main?.requirements).toEqual(["C"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("published conditional closures preserve both alternatives after declaration serialization", async () => {
  const root = await mkdtemp(join(tmpdir(), "vibelang-declaration-alternatives-"));
  try {
    await publish(root, library + `
export abstract class D extends Context { abstract value(): number }
export function choose(flag: boolean) { return flag ? () => C.context().value() : () => D.context().value() }
`);
    const consumer = compileProject([{ fileName: "consumer.vibe", source: 'import { choose } from "./library.mjs"; export function main(flag: boolean) { return choose(flag)() }' }],
      { rootDir: root, outDir: root, outputExtension: ".mjs", sourceMap: false, runtimeImport: runtime });
    expect(consumer.diagnostics).toEqual([]);
    expect(consumer.files["consumer.vibe"]!.analysis.rows.main?.requirements).toEqual(["C", "D"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("an anonymous default factory preserves the effect row of its returned closure", async () => {
  const root = await mkdtemp(join(tmpdir(), "vibelang-declaration-default-"));
  try {
    await publish(root, library + 'export default function () { return () => C.context().value() }');
    const consumer = compileProject([{ fileName: "consumer.vibe", source: 'import factory from "./library.mjs"; export function main() { return factory()() }' }],
      { rootDir: root, outDir: root, outputExtension: ".mjs", sourceMap: false, runtimeImport: runtime });
    expect(consumer.diagnostics).toEqual([]);
    expect(consumer.files["consumer.vibe"]!.analysis.rows.main?.requirements).toEqual(["C"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a same-spelled local capability cannot satisfy a package's nominal requirement", async () => {
  const root = await mkdtemp(join(tmpdir(), "vibelang-declaration-nominal-"));
  try {
    await publish(root, library);
    const compiled = compileProject([{ fileName: "consumer.vibe", source: `
import { read } from "./library.mjs"
import { Context } from "vibelang/context"
import { Layer } from "vibelang/provider"
abstract class C extends Context { abstract value(): number }
export const answer = Layer.provide(Layer.succeed(C, { value: () => 99 }), () => read())
` }], { rootDir: root, outDir: root, outputExtension: ".mjs", sourceMap: false, runtimeImport: runtime });
    expect(compiled.diagnostics.map(issue => issue.code)).toContain("VIBE2101");
  } finally { await rm(root, { recursive: true, force: true }); }
});
