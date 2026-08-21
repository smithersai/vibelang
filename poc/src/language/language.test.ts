import { describe, expect, test } from "bun:test";
import { analyzeSource } from "./analyze";
import { compileVibe } from "./compile";
import { checkEmittedTypeScript } from "./cli";
import { Layer, catchFailure, isVibeFailure, useCapability, VibeFailure } from "../runtime/index";

describe("language row spike", () => {
  test("infers transitive failure and requirement rows", () => {
    const result = analyzeSource(`
      error Missing { id: string }
      abstract class Db { abstract get(id: string): string }
      function leaf(id: string): !string uses db: Db {
        if (id === "none") throw Missing({ id })
        return db.get(id)
      }
      function root(id: string): !string { return try leaf(id) }
      const Empty = Layer.merge()
      Layer.provide(Empty, () => root("one"))
    `);

    expect(result.rows.root).toEqual({ failures: ["Missing"], requirements: ["Db"] });
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("VIBE2001");
  });

  test("checks exhaustive typed catches and strips recovered failures", () => {
    const result = analyzeSource(`
      error Missing { id: string }
      error Busy { wait: number }
      function load(id: string): !string {
        if (id === "missing") throw Missing({ id })
        if (id === "busy") throw Busy({ wait: 1 })
        return id
      }
      function recover(): !string {
        return load("missing") catch |e| switch (e) {
          Missing => "fallback",
          Busy => throw e,
        }
      }
    `);

    expect(result.rows.recover?.failures).toEqual(["Busy"]);
    expect(result.diagnostics).toHaveLength(0);
  });

  test("lowers current named uses, errors, optionals, and expression catch", () => {
    const result = compileVibe(`
      import { Layer } from "vibelang:provider"
      error Missing { id: string }
      abstract class Db { abstract get(id: string): ?string }
      function load(id: string): !string uses db: Db {
        return db.get(id) orelse throw Missing({ id })
      }
      const value = load("x") catch |e| switch (e) { Missing => "fallback" }
    `);

    expect(result.analysis.diagnostics).toHaveLength(0);
    expect(result.code).toContain("const db: Db = __vsUse(Db)");
    expect(result.code).toContain("__vsThrow(new Missing({ id }))");
    expect(result.code).toContain("?? __vsThrow(new Missing");
    expect(result.code).toContain("case \"Missing\"");
  });

  test("erases async and Promise failure rows without wrapping runtime values", () => {
    const result = compileVibe(`
      error Missing {}
      abstract class Api { abstract get(): Promise<string, Missing> }
      async function maybe(): !?string { return null }
    `);
    expect(result.analysis.diagnostics).toHaveLength(0);
    expect(result.code).toContain("abstract get(): Promise<string>");
    expect(result.code).toContain("async function maybe(): Promise<string | null>");
  });

  test("rejects intentionally unsupported high-risk control surfaces", () => {
    const result = analyzeSource(`
      function cleanup(): void {
        defer release()
      }
    `);
    expect(result.diagnostics[0]?.code).toBe("VIBE3003");
  });

  test("classifies TypeScript-only escape hatches and rejects ambient hosts", () => {
    const result = analyzeSource(`
      function dynamic(value: any): unknown { return eval("value") }
      function host(): string { return process.env.HOME ?? "" }
    `);
    expect(result.rows.dynamic?.requirements).toEqual(["TypeScript"]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain("VIBE4001");
  });

  test("leaves ordinary TypeScript property names and exports valid", () => {
    const source = `
      export function identity(value: number): number { return value }
      const api = { try(): number { return 1 }, orelse: 2 }
      const orelse = api.orelse
      export const result = api.try() + orelse
    `;
    const result = compileVibe(source);
    expect(result.analysis.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toHaveLength(0);
    expect(result.code).toBe(source);
  });

  test("finds real bodies after object return types and nested failing calls", () => {
    const result = analyzeSource(`
      error Boom {}
      function fail(): !number { throw Boom() }
      function pass(value: number): number { return value }
      function wrapper(): { value: number } {
        return { value: pass(fail()) }
      }
    `);
    expect(result.rows.wrapper?.failures).toEqual(["Boom"]);
    expect(result.diagnostics.some((diagnostic) =>
      diagnostic.code === "VIBE1001" && diagnostic.message.includes("fail"),
    )).toBe(true);
  });

  test("keeps TypeScript uses/throws aliases contextual and treats throws never as empty", () => {
    const plain = `type uses = string; type throws = number; function a(): uses { return "a" } function b(): throws { return 1 }`;
    expect(compileVibe(plain).code).toBe(plain);
    const pinned = compileVibe(`function stable(): string throws never { return "ok" }`);
    expect(pinned.analysis.rows.stable?.failures).toEqual([]);
    expect(pinned.code).toContain("function stable(): string");
    expect(pinned.code).not.toContain("throws never");
  });

  test("preserves optional-binding JavaScript catch statements byte for byte", () => {
    const source = `function boundary() { try { throw new Error("x") } catch { return "fallback" } }`;
    expect(compileVibe(source).code).toBe(source);
  });

  test("bounds nested catch operands and emits async recovery handlers", () => {
    const nested = compileVibe(`
      error Missing {}
      function load(): !number { throw Missing() }
      function pass(value: number): number { return value }
      const value = pass(load() catch 1)
    `);
    expect(nested.code).toContain("pass(__vsCatch(() => (load())");

    const asynchronous = compileVibe(`
      error Missing {}
      async function load(): !number { throw Missing() }
      async function recover(): Promise<number> { return 1 }
      async function run() { return load() catch |error| switch (error) {
        Missing => await recover(),
      } }
    `);
    expect(asynchronous.code).toContain("async (error: any) =>");
    expect(checkEmittedTypeScript(asynchronous.code, `${import.meta.dir}/async-catch.generated.ts`)
      .filter((diagnostic) => diagnostic.category === 1)).toHaveLength(0);
  });

  test("aliases compiler helpers away from ordinary source bindings", () => {
    const result = compileVibe(`
      const __VSError = "user-error-helper"
      const __vsCatch = "user-catch-helper"
      error Missing {}
      function load(): !number { throw Missing() }
      const value = load() catch 1
      export { __VSError, __vsCatch, value }
    `);
    expect(result.code).toContain("__VSError as __VSError$vibe");
    expect(result.code).toContain("__vsCatch as __vsCatch$vibe");
    expect(result.code).toContain("class Missing extends __VSError$vibe");
    expect(result.code).toContain("__vsCatch$vibe(() => (load())");
    expect(checkEmittedTypeScript(result.code, `${import.meta.dir}/helper-collision.generated.ts`)
      .filter((diagnostic) => diagnostic.category === 1)).toHaveLength(0);
  });

  test("distinguishes local/property names and rejects unlowered expression control", () => {
    const ordinary = analyzeSource(`
      const process = { env: {} }
      function defer(value: unknown): void {}
      function safe(process: { env: string }, value: { process: string }): string {
        defer(process)
        return value.process
      }
    `);
    expect(ordinary.diagnostics).toHaveLength(0);

    const unsupported = analyzeSource(`
      function cleanup(): void { defer release() }
      function loop() { return search: for (const value of []) { break search value } }
      function branch(a: boolean, b: boolean) { return if (a) 1 else if (b) 2 else 3 }
      function precedence(left: number, right: ?number) { return left + right.? }
    `);
    expect(unsupported.diagnostics.map((diagnostic) => diagnostic.code))
      .toEqual(expect.arrayContaining(["VIBE3003", "VIBE3006", "VIBE3007", "VIBE3008"]));
  });
});

describe("runtime semantics", () => {
  test("catch expressions recover failures but never defects", async () => {
    class Missing extends VibeFailure {
      constructor() { super("Missing"); }
    }

    expect(catchFailure(() => { throw new Missing(); }, () => "recovered")).toBe("recovered");
    await expect(
      catchFailure(async () => { throw new Missing(); }, () => "async recovered"),
    ).resolves.toBe("async recovered");
    expect(() => catchFailure(() => { throw new RangeError("defect"); }, () => "bad")).toThrow("defect");
  });

  test("failure payloads cannot forge or overwrite the nominal discriminant", () => {
    expect(() => new VibeFailure("Missing", { _tag: "Other" })).toThrow("reserved");
    const fake = { _tag: "Missing", [Symbol.for("vibelang.failure")]: true };
    expect(isVibeFailure(fake)).toBe(false);
    expect(() => catchFailure(() => { throw fake; }, () => "recovered")).toThrow();
    const forgedError = Object.assign(new Error("forged"), {
      _tag: "Missing",
      [Symbol.for("vibelang.failure")]: true,
    });
    expect(isVibeFailure(forgedError)).toBe(false);
    expect(() => catchFailure(() => { throw forgedError; }, () => "recovered")).toThrow("forged");
  });

  test("Layer scopes survive overlapping async work", async () => {
    abstract class Label { abstract value: string }
    const first = Layer.succeed(Label, { value: "first" });
    const second = Layer.succeed(Label, { value: "second" });
    const readLater = (delay: number) =>
      new Promise<string>((resolve) => setTimeout(() => resolve(useCapability<{ value: string }>(Label).value), delay));

    const values = await Promise.all([
      Layer.provide(first, () => readLater(8)),
      Layer.provide(second, () => readLater(1)),
    ]);
    expect(values).toEqual(["first", "second"]);
  });
});
