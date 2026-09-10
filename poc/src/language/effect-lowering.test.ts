/**
 * Public SDK calls are eager; resumable frames are a private lowering detail.
 * Keep capability inference, publication and real execution as the contracts.
 * In particular, a native caller (map/accessor/method/async callback) must never
 * receive a dormant generator where the source promises an ordinary value.
 * Private durable request lowering has its own artifact/executor tests.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileAndCheckProject } from "./validate.ts";

const RUNTIME = join(import.meta.dir, "../runtime/index.ts");
const workspace = mkdtempSync(join(tmpdir(), "vibelang-effect-lowering-"));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));

function compile(source: string) {
  const checked = compileAndCheckProject([{fileName:"effect-lowering.vibe",source}], {
    rootDir: "/virtual/effect-lowering",
    outDir: "/virtual/effect-lowering",
    runtimeImport: RUNTIME,
    outputExtension: ".ts",
    sourceMap: false,
  });
  expect(checked.result.diagnostics).toEqual([]);
  expect(checked.emitDiagnostics).toEqual([]);
  expect(checked.ok).toBe(true);
  const file = checked.result.files["effect-lowering.vibe"]!;
  expect(file.code.length).toBeGreaterThan(0);
  return file;
}

async function execute<T>(code: string): Promise<T> {
  const directory = mkdtempSync(join(workspace, "run-"));
  writeFileSync(join(directory, "main.ts"), code);
  const module = await import(join(directory, "main.ts")) as {main(): T};
  return module.main();
}

const HEAD = `import { Context } from "vibelang/context"
import { Layer } from "vibelang/provider"
abstract class Directory extends Context {
  abstract lookup(key: string): string
}
const live: Directory = { lookup: (key) => (key === "ada" ? "Ada" : "none") }
`;

const DI = `${HEAD}
function entry(key: string): string {
  return Directory.context().lookup(key)
}
function shout(key: string): string {
  return entry(key).toUpperCase()
}
export function main(): string[] {
  return Layer.provide(Layer.succeed(Directory, live), () => [shout("ada"), shout("zoe")])
}
`;

describe("capability rows do not change the public calling convention", () => {
  const file = compile(DI);
  test("requirements-only declarations remain eager with ordinary return types", () => {
    expect(file.code).toContain("function entry(key: string): string");
    expect(file.code).toContain("function shout(key: string): string");
    expect(file.code).not.toContain("function*");
    expect(file.code).not.toContain("__vsResumable");
  });
  test("the capability read remains attached to its native runtime handler", () => {
    expect(file.code).toContain("Directory.context().lookup(key)");
    expect(file.code).toContain("Layer.provide(Layer.succeed(Directory, live)");
    expect(file.code).not.toContain("yield* __vsGet");
  });
  test("calls are eager even when the result is used as a receiver", () => {
    expect(file.code).toContain("return entry(key).toUpperCase()");
    expect(file.code).not.toContain("yield* entry");
  });
  test("the dependency is inferred and providing it empties the entry row", () => {
    expect(file.analysis.rows["entry"]?.requirements).toEqual(["Directory"]);
    expect(file.analysis.rows["shout"]?.requirements).toEqual(["Directory"]);
    expect(file.analysis.rows["main"]?.requirements).toEqual([]);
    expect(file.code).toContain("export function main(): string[]");
  });
  test("non-empty rows survive publication without exposing a generator ABI", () => {
    expect(file.code).toContain("@vibelangEffects");
    expect(file.code).toContain("@vibelangRequirements");
    expect(file.code).toContain('"requirements":["Directory"]');
    expect(file.code).not.toContain("__vsResumable");
  });
  test("the complete dependency/call/provide chain executes", async () => {
    expect(await execute<string[]>(file.code)).toEqual(["ADA", "NONE"]);
  });
});

describe("host-invoked and fallible bodies preserve their completion", () => {
  test("an annotated fallible body with no suspension can elide its frame", async () => {
    const file = compile(`${HEAD}
export class Missing extends Error {}
function entry(key: string): Result<string, Missing> {
  const found = Directory.context().lookup(key)
  if (found === "none") throw new Missing()
  return found
}
export function main(): string[] {
  return Layer.provide(Layer.succeed(Directory, live), () => [
    entry("ada").match({ ok: (value) => value, error: () => "missing" }),
    entry("zoe").match({ ok: (value) => value, error: () => "missing" }),
  ])
}
`);
    expect(file.code).toContain("function entry(key: string): ");
    expect(file.code).toContain("__vsCompleteResult");
    expect(file.code).not.toContain("function*");
    expect(await execute<string[]>(file.code)).toEqual(["Ada", "missing"]);
  });
  test("a declaration held in a property executes as an ordinary function", async () => {
    const file = compile(`${HEAD}
function reads(): string { return Directory.context().lookup("ada") }
const held = { reads }
export function main(): string[] {
  return Layer.provide(Layer.succeed(Directory, live), () => [held.reads()])
}
`);
    expect(file.code).not.toContain("function* reads");
    expect(await execute<string[]>(file.code)).toEqual(["Ada"]);
  });
  test("a native map consumer invokes the callback and observes its values", async () => {
    const file = compile(`${HEAD}
function readAll(keys: readonly string[]): string[] {
  return keys.map((key) => Directory.context().lookup(key))
}
export function main(): string[] {
  return Layer.provide(Layer.succeed(Directory, live), () => readAll(["ada", "zoe"]))
}
`);
    expect(file.code).toContain("function readAll(");
    expect(file.code).not.toContain("function*");
    expect(await execute<string[]>(file.code)).toEqual(["Ada", "none"]);
  });
  test("discarded calls still run inside methods, accessors and callbacks", async () => {
    const file = compile(`${HEAD}
let calls = 0
function read(): void { Directory.context(); calls++ }
const obj = {
  run(): void { read() },
  get value(): number { read(); return calls },
}
export function main(): number {
  return Layer.provide(Layer.succeed(Directory, live), () => {
    obj.run()
    const value = obj.value;
    [0, 1].forEach(() => { read() })
    return calls + value
  })
}
`);
    expect(await execute<number>(file.code)).toBe(6);
  });
  test("discarded calls remain eager across an awaited async body", async () => {
    const file = compile(`${HEAD}
let calls = 0
function read(): void { Directory.context(); calls++ }
async function body(): Promise<number> {
  read()
  await Promise.resolve()
  read()
  return calls
}
export async function main(): Promise<number> {
  return await Layer.provide(Layer.succeed(Directory, live), async () => await body())
}
`);
    expect(await execute<number>(file.code)).toBe(2);
  });
});

describe("function-typed parameters retain their ordinary calling contract", () => {
  const source = `${HEAD}
function through(run: (key: string) => string, key: string): string {
  const directory = Directory.context()
  return run(directory.lookup(key))
}
export function main(): string[] {
  return Layer.provide(Layer.succeed(Directory, live), () => [
    through((value) => value.toUpperCase(), "ada"),
  ])
}
`;
  test("a known empty-row parameter is callable in a dependency-bearing body", () => {
    const file = compile(source);
    expect(file.code).toContain("function through(");
    expect(file.code).toContain("return run(directory.lookup(key))");
    expect(file.code).not.toContain("yield* run(");
    expect(file.analysis.rows["through"]?.requirements).toEqual(["Directory"]);
  });
  test("the higher-order program executes the supplied function", async () => {
    expect(await execute<string[]>(compile(source).code)).toEqual(["ADA"]);
  });
  test("service methods keep their eager invocation", () => {
    const file = compile(source);
    expect(file.code).not.toContain("yield* directory.lookup");
  });
});
