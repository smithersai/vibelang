import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileAndCheckVibeLang } from "./validate.ts";

const workspace = mkdtempSync(join(tmpdir(), "vibelang-result-delimiters-"));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));
let sequence = 0;

async function run(source: string): Promise<unknown> {
  const outputFileName = join(workspace, `case-${sequence++}.ts`);
  const checked = compileAndCheckVibeLang(source, {
    fileName: outputFileName.replace(/\.ts$/, ".vibe"),
    outputFileName,
    runtimeImport: join(import.meta.dir, "../runtime/index.ts"),
    sourceMap: false,
  });
  expect(checked.result.analysis.diagnostics).toEqual([]);
  expect(checked.emitDiagnostics.map(d => d.message)).toEqual([]);
  writeFileSync(outputFileName, checked.result.code);
  const module = await import(outputFileName) as { main(): unknown };
  return await module.main();
}

for (const [name, caller, invocation] of [
  ["async function", "async function call(): Promise<number> { read(); return seen.length }", "await call()"],
  ["method", "class Box { call(): number { read(); return seen.length } }", "new Box().call()"],
  ["async method", "class Box { async call(): Promise<number> { read(); return seen.length } }", "await new Box().call()"],
  ["accessor", "class Box { get value(): number { read(); return seen.length } }", "new Box().value"],
  ["ordinary callback", "function call(): number { [1].forEach(() => { read() }); return seen.length }", "call()"],
  ["awaited argument", "async function call(): Promise<number> { read(await Promise.resolve(2)); return seen.length }", "await call()"],
] as const) test(`a discarded effectful call still executes inside an ${name}`, async () => {
  expect(await run(`
    import { Context } from "vibelang/context"
    import { Layer } from "vibelang/provider"
    abstract class Value extends Context { abstract n(): number }
    const seen: number[] = []
    function read(n = 1): number { seen.push(Value.context().n() * n); return 9 }
    ${caller}
    export async function main(): Promise<number[]> {
      const count = await Layer.provide(Layer.succeed(Value, { n: () => 7 }), async () => ${invocation})
      return [count, ...seen]
    }
  `)).toEqual([1, name === "awaited argument" ? 14 : 7]);
});

test("propagation preserves short-circuiting, loop frequency, and prior side effects", async () => {
  expect(await run(`
    class Missing extends Error {}
    const seen: number[] = []
    function read(n: number): Result<number, Missing> {
      seen.push(n)
      if (n < 0) throw new Missing("missing")
      return n
    }
    function work(): Result<number, Missing> {
      let n = 0
      const skip = true || read(-1)! > 0
      const maybe: number | undefined = 8
      const skip2 = maybe ?? read(-2)!
      while (read(n)! < 3) n++
      const total = seen.push(100) + read(4)!
      return skip ? total + skip2 : 0
    }
    export function main(): string[] { return [String(work().unwrapOr(0)), seen.join(",")] }
  `)).toEqual(["17", "0,1,2,3,100,4"]);
});

test("an async propagation exits after awaited finally without evaluating the rest", async () => {
  expect(await run(`
    class Missing extends Error {}
    const seen: string[] = []
    async function read(n: number): Promise<Result<number, Missing>> {
      if (n < 0) throw new Missing("missing")
      return n
    }
    async function work(): Promise<Result<number, Missing>> {
      try {
        const answer = false ? 0 : (await read(-1))!
        seen.push("unreachable")
        return answer
      } finally {
        await Promise.resolve()
        seen.push("finally")
      }
    }
    export async function main(): Promise<string[]> {
      const result = await work()
      return [result.match({ok: () => "wrong", error: e => e.message}), ...seen]
    }
  `)).toEqual(["missing", "finally"]);
});

test("empty failure rows extract at the expression site without a resumable convention", async () => {
  const source = `
    const seen: number[] = []
    function read(n: number): Result<number, never> { seen.push(n); return n }
    function work(): Result<number, never> {
      let n = 0
      while (read(n)! < 3) n++
      return true ? seen.push(9) + read(n)! : read(99)!
    }
    export function main(): string[] { return [String(work().unwrapOr(-1)), seen.join(",")] }
  `;
  expect(await run(source)).toEqual(["8", "0,1,2,3,9,3"]);
  const checked = compileAndCheckVibeLang(source, {
    fileName: join(workspace, "empty.vibe"), outputFileName: join(workspace, "empty.ts"),
    runtimeImport: join(import.meta.dir, "../runtime/index.ts"),
  });
  expect(checked.result.code).not.toContain("function*");
  expect(checked.result.code).not.toContain("__vsRunResult");
});

test("fallible method bodies and provided arrows keep lexical this", async () => {
  expect(await run(`
    import { Context } from "vibelang/context"
    import { Layer } from "vibelang/provider"
    abstract class Clock extends Context { abstract now(): number }
    class Missing extends Error {}
    function read(n: number): Result<number, Missing> { if (n < 0) throw new Missing(); return n }
    class Counter {
      value = 7
      read(): Result<number, Missing> { return this.value + read(1)! }
      provided(): number {
        return Layer.provide(Layer.succeed(Clock, {now: () => 2}), () => this.value + Clock.context().now())
      }
    }
    export function main(): number[] { const counter = new Counter(); return [counter.read().unwrapOr(0), counter.provided()] }
  `)).toEqual([8, 9]);
});

test("failure cleanup can still read its live capability scope", async () => {
  expect(await run(`
    import { Context } from "vibelang/context"
    import { Layer } from "vibelang/provider"
    abstract class Clock extends Context { abstract now(): number }
    class Missing extends Error {}
    const seen: number[] = []
    function fail(): Result<number, Missing> { throw new Missing() }
    function work(): Result<number, Missing> {
      try { return fail()! }
      finally { seen.push(Clock.context().now()) }
    }
    export function main(): number[] {
      return Layer.provide(Layer.succeed(Clock, { now: () => 42 }), () => [work().unwrapOr(-1), ...seen])
    }
  `)).toEqual([-1, 42]);
});

test("super reads, calls, updates and computed keys retain their home object", async () => {
  expect(await run(`
    class Missing extends Error {}
    function read(n: number): Result<number, Missing> { return n }
    class Base {
      value = 3
      get count(): number { return this.value }
      set count(value: number) { this.value = value }
      add(n: number): number { return this.value + n }
    }
    class Derived extends Base {
      run(key: "count"): Result<number, Missing> {
        super.count += read(2)!
        const selected = true ? super.add(read(1)!) : 0
        super[key] += read(1)!
        return selected + super[key]
      }
    }
    export function main(): number[] { return [new Derived().run("count").unwrapOr(-1)] }
  `)).toEqual([12]);
});

test("moved bodies preserve arguments shorthand and nested class receiver scopes", async () => {
  expect(await run(`
    class Missing extends Error {}
    function read(): Result<number, Missing> { return 1 }
    class Outer {
      value = 3
      run(n: number): Result<number, Missing> {
        const passed = { arguments }
        class Inner { value = 20; read(): number { return this.value } }
        return this.value + new Inner().read() + passed.arguments.length + read()! + n
      }
    }
    export function main(): number[] { return [new Outer().run(2).unwrapOr(-1)] }
  `)).toEqual([27]);
});

test("expect is expression-local and evaluates its message before checked panic completion", async () => {
  expect(await run(`
    class Missing extends Error {}
    const seen: string[] = []
    function read(n: number): Result<number, Missing> { seen.push(String(n)); if (n < 0) throw new Missing(); return n }
    function message(): string { seen.push("message"); return "stopped" }
    function work(fail: boolean): Result<number, Panic> {
      let n = 0
      while (read(n).expect("limit") < 2) n++
      return fail ? read(-1).expect(message()) : n
    }
    export function main(): string[] {
      const success = work(false).unwrapOr(0)
      const failure = work(true).match({ ok: () => "wrong", error: e => e.message })
      return [String(success), failure, seen.join(",")]
    }
  `)).toEqual(["2", "VibeLang panic: stopped", "0,1,2,0,1,2,-1,message"]);
});

test("failure propagation in finally cannot erase an in-flight panic", async () => {
  await expect(run(`
    import { panic } from "vibelang:exceptions"
    class Missing extends Error {}
    function fail(): Result<number, Missing> { throw new Missing("cleanup failed") }
    function work(): Result<number, Missing> {
      try { panic("original panic") }
      finally { const ignored = fail()!; void ignored }
    }
    export function main(): number { return work().unwrapOr(-1) }
  `)).rejects.toThrow("original panic");
});

test("an async finalizer cannot erase a panic after it suspends", async () => {
  await expect(run(`
    import { panic } from "vibelang:exceptions"
    class Missing extends Error {}
    async function fail(): Promise<Result<number, Missing>> { throw new Missing("cleanup failed") }
    async function work(): Promise<Result<number, Missing>> {
      try { panic("original async panic") }
      finally { const ignored = (await fail())!; void ignored }
    }
    export async function main(): Promise<number> { return (await work()).unwrapOr(-1) }
  `)).rejects.toThrow("original async panic");
});
