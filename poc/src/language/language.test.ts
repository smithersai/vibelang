import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as ts from "typescript-js";
import { analyzeSource } from "./analyze.ts";
import { compileVibe } from "./compile.ts";
import { internalParseDiagnostics, parseDiagnosticsFailure } from "./semantic.ts";
import { checkEmittedTypeScript, compileAndCheckVibe } from "./validate.ts";
import { __vsInspectOptional, __vsInspectResult } from "../runtime/index.ts";

const examples = `${import.meta.dir}/../../examples/language`;

function compileCase(source: string, name = "case") {
  return compileVibe(source, {
    fileName: `${examples}/${name}.vibe`,
    outputFileName: `${examples}/${name}.generated.ts`,
    sourceName: `examples/language/${name}.vibe`,
    runtimeImport: "../../src/runtime/index.ts",
  });
}

function emittedErrors(code: string, name = "case") {
  return checkEmittedTypeScript(code, `${examples}/${name}.generated.ts`)
    .filter((diagnostic) => diagnostic.category === 1);
}

async function executeCase(source: string, name: string) {
  const result = compileVibe(source, {
    fileName: `${examples}/${name}.vibe`,
    outputFileName: `${examples}/${name}.generated.ts`,
    sourceName: `examples/language/${name}.vibe`,
    runtimeImport: "../../src/runtime/index.ts",
  });
  const executable = compileVibe(source, {
    fileName: `${examples}/${name}.vibe`,
    outputFileName: `${examples}/${name}.generated.ts`,
    sourceName: `examples/language/${name}.vibe`,
    runtimeImport: pathToFileURL(`${import.meta.dir}/../runtime/index.ts`).href,
  });
  const javascript = new Bun.Transpiler({ loader: "ts", target: "bun" })
    .transformSync(executable.code);
  const directory = await mkdtemp(join(tmpdir(), "vibe-defer-"));
  const modulePath = join(directory, `${name}.mjs`);
  try {
    await writeFile(modulePath, javascript);
    const module = await import(pathToFileURL(modulePath).href) as Record<string, any>;
    return { result, module };
  } finally {
    await rm(directory, { recursive: true });
  }
}

describe("checked .vibe frontend", () => {
  test("keeps unchanged TypeScript byte-for-byte when no Vibe lowering is needed", () => {
    const source = `export const double = (value: number): number => value * 2\n`;
    const result = compileCase(source);
    expect(result.code).toBe(source);
    expect(result.analysis.diagnostics).toHaveLength(0);
  });

  test("hard-rejects every retired row, error, catch, and optional spelling", () => {
    const result = analyzeSource(`
      error Missing { id: string }
      function old(): !?string throws Missing uses db: Db {
        return try db.read() orelse "none"
      }
      const value = old() catch "fallback"
    `);
    const messages = result.diagnostics
      .filter((diagnostic) => diagnostic.code === "VIBE1001")
      .map((diagnostic) => diagnostic.message)
      .join("\n");
    expect(messages).toContain("historical `error Name {}`");
    expect(messages).toContain("`throws` row grammar was removed");
    expect(messages).toContain("named `uses` grammar was removed");
    expect(messages).toContain("`!T` return marker was removed");
    expect(messages).toContain("`?T` type grammar was removed");
    expect(messages).toContain("`orelse` operator was removed");
    expect(messages).toContain("prefix `try`");
    expect(messages).toContain("postfix catch expression");
  });

  test("infers local Results and emits explicit success, failure, and unwrap branches", () => {
    const result = compileCase(`
      class Missing extends Error {}
      function leaf(id: number) {
        if (id === 0) throw new Missing()
        return id
      }
      function root(id: number): Result<number, Missing> {
        const value = leaf(id).unwrap()
        return value + 1
      }
    `);
    expect(result.analysis.rows.leaf?.failures).toEqual(["Missing"]);
    expect(result.analysis.rows.root?.failures).toEqual(["Missing"]);
    expect(result.analysis.diagnostics).toHaveLength(0);
    expect(result.code).toContain("return __vsResultFailure(new Missing())");
    expect(result.code).toContain("__vsInspectResult(leaf(id))");
    expect(result.code).toContain("ok === false");
    expect(result.code).toContain("return __vsResultSuccess(value + 1)");
    expect(emittedErrors(result.code)).toHaveLength(0);
  });

  test("requires explicit Result contracts only at exported boundaries", () => {
    const local = analyzeSource(`class E extends Error {}; function inferred() { throw new E() }`);
    expect(local.rows.inferred?.failures).toEqual(["E"]);
    expect(local.diagnostics.some((diagnostic) => diagnostic.code === "VIBE1102")).toBe(false);

    const exported = analyzeSource(`class E extends Error {}; export function inferred() { throw new E() }`);
    expect(exported.diagnostics.some((diagnostic) => diagnostic.code === "VIBE1102")).toBe(true);
  });

  test("lifts Optional and Result<Optional> from outside in", () => {
    const result = compileCase(`
      class Invalid extends Error {}
      function cached(hit: boolean): Optional<number> {
        if (hit) return 1
        return undefined
      }
      function parsed(kind: number): Result<Optional<number>, Invalid> {
        if (kind < 0) throw new Invalid()
        if (kind === 0) return null
        return 1
      }
    `);
    expect(result.analysis.diagnostics).toHaveLength(0);
    expect(result.code).toContain("return __vsOptionalSome(1)");
    expect(result.code).toContain("return __vsOptionalNone()");
    expect(result.code).toContain("__vsResultSuccess(__vsOptionalNone())");
    expect(result.code).toContain("__vsResultSuccess(__vsOptionalSome(1))");
    expect(emittedErrors(result.code)).toHaveLength(0);
  });

  test("lowers the checked panic channel to an Error Result value", () => {
    const result = compileCase(`
      import { Panic, panic } from "vibelang:exceptions"
      function checked(fail: boolean): Result<string, Panic> {
        if (fail) panic("bad boundary")
        return "ok"
      }
    `);
    expect(result.analysis.rows.checked?.failures).toEqual(["Panic"]);
    expect(result.code).toContain("return __vsResultFailure(__vsPanicValue(\"bad boundary\"))");
    expect(emittedErrors(result.code)).toHaveLength(0);
  });

  test("uses checker-resolved foreign JSDoc and keeps contract-violation Panic visible", () => {
    const result = compileCase(`
      import { ForeignFailure, trustedLength, declaredFailure, untrustedAsync } from "./foreign.ts"
      function trusted(): number { return trustedLength("x") }
      function declared(): Result<string, ForeignFailure | Panic> {
        return declaredFailure(true).unwrap()
      }
      async function unknown(): Promise<Result<string, Panic>> {
        return (await untrustedAsync("x")).unwrap()
      }
    `, "foreign-boundary");
    expect(result.analysis.rows.trusted).toEqual({ failures: [], requirements: ["TypeScript"] });
    expect(result.analysis.rows.declared).toEqual({ failures: ["ForeignFailure", "Panic"], requirements: ["TypeScript"] });
    expect(result.analysis.rows.unknown).toEqual({ failures: ["Panic"], requirements: ["TypeScript"] });
    expect(result.code).toContain("Result.try(() => declaredFailure(true)");
    expect(result.code).toContain("__vsValidateForeignError(cause, ForeignFailure)");
    expect(result.code).toContain("Result.tryPromise(() => untrustedAsync(\"x\"))");
    expect(result.code).not.toContain("Result.try(() => trustedLength");
    expect(emittedErrors(result.code, "foreign-boundary")).toHaveLength(0);

    const omitted = analyzeSource(`
      import { ForeignFailure, declaredFailure } from "./foreign.ts"
      function wrong(): Result<string, ForeignFailure> { return declaredFailure(true).unwrap() }
    `, { fileName: `${examples}/foreign-omitted.vibe` });
    expect(omitted.diagnostics.some((diagnostic) =>
      diagnostic.code === "VIBE1104" && diagnostic.message.includes("Panic"),
    )).toBe(true);

    const constructor = analyzeSource(`
      import { ForeignFailure } from "./foreign.ts"
      function unsupported(): ForeignFailure { return new ForeignFailure() }
    `, { fileName: `${examples}/foreign-constructor.vibe` });
    expect(constructor.diagnostics.some((diagnostic) => diagnostic.code === "VIBE1504")).toBe(true);
  });

  test("fails closed on untrusted foreign module initialization while preserving type-only and dynamic adapters", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vibe-module-init-"));
    try {
      await writeFile(join(directory, "trusted.ts"), `
        /** @module @throws {never} */
        export type Label = "trusted"
        export const value = "trusted"
      `);
      await writeFile(join(directory, "untrusted.ts"), `
        export type Label = "untrusted"
        export const value = "untrusted"
      `);
      await writeFile(join(directory, "late-marker.ts"), `
        export const first = 1
        /** @throws {never} */
        export function trustedCall(): number { return first }
      `);
      await writeFile(join(directory, "ordinary-marker.ts"), `
        // @throws {never}
        /* @throws {never} */
        export const value = 1
      `);
      await writeFile(join(directory, "ambiguous-marker.ts"), `
        /** @throws {never} */
        export const value = 1
      `);
      await writeFile(join(directory, "adapter.ts"), `
        /** @module @throws {never} */
        export async function load(): Promise<unknown> {
          return import("./untrusted.ts")
        }
      `);

      const rejected = analyzeSource(`
        import { value } from "./untrusted.ts"
        export const copied = value
      `, { fileName: join(directory, "rejected.vibe") });
      expect(rejected.diagnostics.filter((diagnostic) => diagnostic.code === "VIBE1510")).toHaveLength(1);

      const late = analyzeSource(`
        import { trustedCall } from "./late-marker.ts"
        function call(): Result<number, Panic> { return trustedCall().unwrap() }
      `, { fileName: join(directory, "late.vibe") });
      expect(late.diagnostics.filter((diagnostic) => diagnostic.code === "VIBE1510")).toHaveLength(1);

      const ordinary = analyzeSource(`
        import { value } from "./ordinary-marker.ts"
        export const copied = value
      `, { fileName: join(directory, "ordinary.vibe") });
      expect(ordinary.diagnostics.filter((diagnostic) => diagnostic.code === "VIBE1510")).toHaveLength(1);

      const ambiguous = analyzeSource(`
        import { value } from "./ambiguous-marker.ts"
        export const copied = value
      `, { fileName: join(directory, "ambiguous.vibe") });
      expect(ambiguous.diagnostics.filter((diagnostic) => diagnostic.code === "VIBE1510")).toHaveLength(1);

      const accepted = analyzeSource(`
        import type { Label as UntrustedLabel } from "./untrusted.ts"
        import { type Label, value } from "./trusted.ts"
        import { load } from "./adapter.ts"
        import { panic } from "vibelang:exceptions"
        const label: Label | UntrustedLabel = value
        async function deferred(): Promise<Result<unknown, Panic>> {
          return (await load()).unwrap()
        }
      `, { fileName: join(directory, "accepted.vibe") });
      expect(accepted.diagnostics.filter((diagnostic) => diagnostic.code === "VIBE1510")).toHaveLength(0);
      expect(accepted.rows.deferred?.failures).toEqual(["Panic"]);
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  test("applies the same checked JSDoc boundary policy to JavaScript modules", () => {
    const result = compileCase(`
      import {
        JavaScriptFailure,
        declaredJavaScriptFailure,
        trustedJavaScriptLength,
        untrustedJavaScriptAsync,
      } from "./foreign-js.js"
      function trustedJs(): number { return trustedJavaScriptLength("x") }
      function declaredJs(): Result<string, JavaScriptFailure | Panic> {
        return declaredJavaScriptFailure(true).unwrap()
      }
      async function unknownJs(): Promise<Result<string, Panic>> {
        return (await untrustedJavaScriptAsync("x")).unwrap()
      }
    `, "foreign-javascript-boundary");

    expect(result.analysis.rows.trustedJs).toEqual({ failures: [], requirements: ["TypeScript"] });
    expect(result.analysis.rows.declaredJs).toEqual({
      failures: ["JavaScriptFailure", "Panic"],
      requirements: ["TypeScript"],
    });
    expect(result.analysis.rows.unknownJs).toEqual({ failures: ["Panic"], requirements: ["TypeScript"] });
    expect(result.code).not.toContain("Result.try(() => trustedJavaScriptLength");
    expect(result.code).toContain("Result.try(() => declaredJavaScriptFailure(true)");
    expect(result.code).toContain("__vsValidateForeignError(cause, JavaScriptFailure)");
    expect(result.code).toContain("Result.tryPromise(() => untrustedJavaScriptAsync(\"x\"))");
    expect(emittedErrors(result.code, "foreign-javascript-boundary")).toHaveLength(0);
  });

  test("tracks foreign methods, namespace aliases, stored callables, and factory results", () => {
    const result = compileCase(`
      import * as foreign from "./foreign.ts"
      import { AccessFailure as AF, ForeignFailure as FF, foreignAny, foreignClient, makeAsyncCallable, makeCallable } from "./foreign.ts"
      const clientAlias = foreign.foreignClient
      const stored = { invoke: foreign.declaredFailure }

      function trustedMethod(): string { return foreignClient.trustedMethod("x") }
      function trustedGetter(): string { return foreignClient.safeValue }
      function realForeignUnwrapMethod(): Result<void, Panic> { foreignAny.unwrap().unwrap() }
      function method(): Result<string, Panic> {
        return clientAlias.untrustedMethod("X").unwrap()
      }
      function declaredMethod(): Result<string, AF | Panic> {
        return foreignClient.declaredMethod(false).unwrap()
      }
      function storedCallable(): Result<string, FF | Panic> {
        return stored.invoke(false).unwrap()
      }
      function generatedCallable(): Result<string, Panic> {
        const callable: (value: string) => string = makeCallable().unwrap()
        return callable("x").unwrap()
      }
      async function generatedAsyncCallable(): Promise<Result<string, Panic>> {
        const callable: (value: string) => Promise<string> = (await makeAsyncCallable()).unwrap()
        return (await callable("x")).unwrap()
      }
    `, "foreign-provenance");

    expect(result.analysis.diagnostics).toHaveLength(0);
    expect(result.analysis.rows.trustedMethod).toEqual({ failures: [], requirements: ["TypeScript"] });
    expect(result.analysis.rows.trustedGetter).toEqual({ failures: [], requirements: ["TypeScript"] });
    expect(result.analysis.rows.realForeignUnwrapMethod).toEqual({ failures: ["Panic"], requirements: ["TypeScript"] });
    expect(result.analysis.rows.method).toEqual({ failures: ["Panic"], requirements: ["TypeScript"] });
    expect(result.analysis.rows.declaredMethod).toEqual({
      failures: ["AccessFailure", "Panic"],
      requirements: ["TypeScript"],
    });
    expect(result.analysis.rows.storedCallable).toEqual({
      failures: ["ForeignFailure", "Panic"],
      requirements: ["TypeScript"],
    });
    expect(result.analysis.rows.generatedCallable).toEqual({ failures: ["Panic"], requirements: ["TypeScript"] });
    expect(result.analysis.rows.generatedAsyncCallable).toEqual({ failures: ["Panic"], requirements: ["TypeScript"] });
    expect(result.code).toContain("Result.try(() => clientAlias.untrustedMethod(\"X\"))");
    expect(result.code).toContain("Result.try(() => foreignAny.unwrap())");
    expect(result.code).toContain("Result.try(() => stored.invoke(false)");
    expect(result.code).toContain("cause, foreign.AccessFailure");
    expect(result.code).toContain("cause, foreign.ForeignFailure");
    expect(result.code).toContain("Result.try(() => makeCallable())");
    expect(result.code).toContain("Result.try(() => callable(\"x\"))");
    expect(result.code).toContain("Result.tryPromise(() => makeAsyncCallable())");
    expect(result.code).toContain("Result.tryPromise(() => callable(\"x\"))");
    expect(result.code).not.toContain("Result.try(() => foreignClient.trustedMethod");
    expect(emittedErrors(result.code, "foreign-provenance")).toHaveLength(0);
  });

  test("fails closed for foreign accessors, raw method extraction, factories, constructors, and callback escapes", () => {
    const analysis = analyzeSource(`
      import {
        AccessFailure,
        DeclaredConstructed,
        TrustedConstructed,
        UntrustedConstructed,
        foreignClient,
        makeCallable,
        receiveCallback,
        receiveCallbackOptions,
        trustedCallbackHost,
        trustedLength,
      } from "./foreign.ts"

      function getter(): Result<string, AccessFailure | Panic> { return foreignClient.dangerousValue }
      function extraction(): Result<string, Panic> {
        const extracted = foreignClient.untrustedMethod
        return "unused"
      }
      function nestedFactory(): Result<string, Panic> { return makeCallable()("x").unwrap() }
      function uncheckedFactoryAlias(): Result<string, Panic> {
        const callable: (value: string) => string = makeCallable()
        return callable("x").unwrap()
      }
      function callbacks(): Result<void, Panic> {
        receiveCallback(() => {}).unwrap()
        receiveCallbackOptions({ onValue: () => {} }).unwrap()
        trustedCallbackHost(() => {})
      }
      function localHost(callback: (value: string) => number): number { return callback("x") }
      function localEscape(): Result<number, Panic> { return localHost(trustedLength) }
      function localObjectHost(client: { untrustedMethod(value: string): string }): string {
        return client.untrustedMethod("x")
      }
      function localObjectEscape(): Result<string, Panic> { return localObjectHost(foreignClient) }
      function mutableEscape(): Result<void, Panic> {
        let callback = (value: string): number => value.length
        callback = trustedLength
      }
      function trustedConstructor(): void { new TrustedConstructed("safe") }
      function untrustedConstructor(): Result<void, Panic> { new UntrustedConstructed("unsafe") }
      function declaredConstructor(): Result<void, AccessFailure | Panic> { new DeclaredConstructed("unsafe") }

      const localClient = {
        trustedMethod(value: string): string { return value },
        untrustedMethod(value: string): string { return value },
        get dangerousValue(): string { return "local" },
      }
      function unrelatedLocalLookalike(): string {
        return localClient.untrustedMethod(localClient.dangerousValue)
      }
    `, { fileName: `${examples}/foreign-adversarial.vibe` });

    expect(analysis.diagnostics.filter((diagnostic) => diagnostic.code === "VIBE1506")).toHaveLength(2);
    expect(analysis.diagnostics.some((diagnostic) => diagnostic.code === "VIBE1507")).toBe(true);
    expect(analysis.diagnostics.filter((diagnostic) => diagnostic.code === "VIBE1509")).toHaveLength(3);
    expect(analysis.diagnostics.some((diagnostic) => diagnostic.code === "VIBE1508")).toBe(true);
    expect(analysis.diagnostics.filter((diagnostic) => diagnostic.code === "VIBE1504")).toHaveLength(2);
    expect(analysis.rows.getter).toEqual({
      failures: ["AccessFailure", "Panic"],
      requirements: ["TypeScript"],
    });
    expect(analysis.rows.trustedConstructor).toEqual({ failures: [], requirements: ["TypeScript"] });
    expect(analysis.rows.declaredConstructor?.failures).toEqual(["AccessFailure", "Panic"]);
    expect(analysis.rows.unrelatedLocalLookalike).toEqual({ failures: [], requirements: [] });
  });

  test("applies nested provenance and accessor fail-closed rules to JavaScript imports", () => {
    const compiled = compileCase(`
      import { javaScriptClient, makeJavaScriptCallable } from "./foreign-js.js"
      function method(): Result<string, Panic> { return javaScriptClient.untrustedMethod("x").unwrap() }
      function generated(): Result<string, Panic> {
        const callable: (value: string) => string = makeJavaScriptCallable().unwrap()
        return callable("x").unwrap()
      }
      function trusted(): string { return javaScriptClient.trustedMethod("x") }
      function safeGetter(): string { return javaScriptClient.safeValue }
    `, "foreign-javascript-provenance");
    expect(compiled.analysis.diagnostics).toHaveLength(0);
    expect(compiled.code).toContain("Result.try(() => javaScriptClient.untrustedMethod(\"x\"))");
    expect(compiled.code).toContain("Result.try(() => makeJavaScriptCallable())");
    expect(emittedErrors(compiled.code, "foreign-javascript-provenance")).toHaveLength(0);

    const rejected = analyzeSource(`
      import {
        JavaScriptAccessFailure,
        javaScriptClient,
        receiveJavaScriptCallback,
        receiveJavaScriptCallbackOptions,
      } from "./foreign-js.js"
      function getter(): Result<string, JavaScriptAccessFailure | Panic> { return javaScriptClient.dangerousValue }
      function callbacks(): Result<void, Panic> {
        receiveJavaScriptCallback(() => {}).unwrap()
        receiveJavaScriptCallbackOptions({ onValue: () => {} }).unwrap()
      }
    `, { fileName: `${examples}/foreign-javascript-adversarial.vibe` });
    expect(rejected.diagnostics.filter((diagnostic) => diagnostic.code === "VIBE1506")).toHaveLength(1);
    expect(rejected.diagnostics.filter((diagnostic) => diagnostic.code === "VIBE1509")).toHaveLength(2);
    expect(rejected.rows.getter?.failures).toEqual(["JavaScriptAccessFailure", "Panic"]);
  });

  test("fails closed when a top-level foreign boundary has no Result channel", () => {
    const analysis = analyzeSource(`
      import {
        JavaScriptFailure,
        declaredJavaScriptFailure,
        trustedJavaScriptLength,
        untrustedJavaScriptAsync,
      } from "./foreign-js.js"
      const trusted = trustedJavaScriptLength("safe")
      const declared = declaredJavaScriptFailure(false)
      const pending = untrustedJavaScriptAsync("unsafe")
      const constructed = new JavaScriptFailure("unsafe")
    `, { fileName: `${examples}/foreign-javascript-top-level.vibe` });

    const boundaryErrors = analysis.diagnostics.filter((diagnostic) => diagnostic.code === "VIBE1505");
    expect(boundaryErrors).toHaveLength(2);
    expect(boundaryErrors.every((diagnostic) => diagnostic.message.includes("top level"))).toBe(true);
    expect(analysis.diagnostics.some((diagnostic) => diagnostic.code === "VIBE1504")).toBe(true);
  });

  test("infers Context requirements transitively and subtracts known Layers", () => {
    const prefix = `
      import { Context } from "vibelang/context"
      import { Layer } from "vibelang/provider"
      abstract class Db extends Context { abstract read(): string }
      abstract class Logger extends Context { abstract info(value: string): void }
      function needsBoth(): string {
        const db = Db.context(); Logger.context().info("read"); return db.read()
      }
      const DbLive = Layer.succeed(Db, { read: () => "value" })
    `;
    const nested = analyzeSource(`${prefix}
      function partiallyProvided(): string { return Layer.provide(DbLive, () => needsBoth()) }
    `);
    expect(nested.rows.needsBoth?.requirements).toEqual(["Db", "Logger"]);
    expect(nested.rows.partiallyProvided?.requirements).toEqual(["Logger"]);
    expect(nested.diagnostics.some((diagnostic) => diagnostic.code === "VIBE2101")).toBe(false);

    const closed = analyzeSource(`${prefix} Layer.provide(DbLive, () => needsBoth())`);
    expect(closed.diagnostics.some((diagnostic) =>
      diagnostic.code === "VIBE2101" && diagnostic.message.includes("Logger"),
    )).toBe(true);
  });

  test("rejects ambient clocks and randomness while preserving lexical shadows", () => {
    const ambient = analyzeSource(`
      function unsafeClock(): number {
        const now = Date.now
        return now() + performance.now() + performance.timeOrigin + new Date().getTime()
      }
      function unsafeRandom(): string {
        const random = Math["random"]
        crypto.getRandomValues(new Uint8Array(4))
        return String(random()) + crypto.randomUUID()
      }
      function callableDate(): string { return Date(0) }
      function deterministicDate(): number { return new Date(0).getTime() }
    `);
    expect(ambient.diagnostics.filter((diagnostic) => diagnostic.code === "VIBE1602")).toHaveLength(5);
    expect(ambient.diagnostics.filter((diagnostic) => diagnostic.code === "VIBE1603")).toHaveLength(3);
    expect(ambient.diagnostics.some((diagnostic) =>
      diagnostic.code === "VIBE1602" && diagnostic.start > ambient.functions.find((fn) => fn.name === "deterministicDate")!.start,
    )).toBe(false);

    const shadowed = analyzeSource(`
      function safe(
        Date: { now(): number },
        Math: { random(): number },
        crypto: { randomUUID(): string; getRandomValues(value: Uint8Array): Uint8Array },
        performance: { now(): number; timeOrigin: number },
      ): string {
        crypto.getRandomValues(new Uint8Array(1))
        return String(Date.now() + Math.random() + performance.now() + performance.timeOrigin) + crypto.randomUUID()
      }
    `);
    expect(shadowed.diagnostics.filter((diagnostic) =>
      diagnostic.code === "VIBE1602" || diagnostic.code === "VIBE1603",
    )).toHaveLength(0);
  });

  test("classifies ambient aliases, destructuring, and computed access once without rejecting deterministic members", () => {
    const escaped = analyzeSource(`
      function aliases(): void {
        const DateAlias = Date
        const MathAlias = Math
        const performanceAlias = performance
        const cryptoAlias = crypto
        void [DateAlias, MathAlias, performanceAlias, cryptoAlias]
      }
      function objectEscape(): object {
        return { Date, Math, performance, crypto }
      }
      function destructured(): void {
        const { now } = Date
        const { parse, UTC } = Date
        const { random } = Math
        const { abs, max } = Math
        const { timeOrigin } = performance
        const { randomUUID, subtle } = crypto
        void [now, parse, UTC, random, abs, max, timeOrigin, randomUUID, subtle]
      }
      function computed(member: string): void {
        void Date["now"]
        void Date["parse"]
        void Date[member]
        void Math["random"]
        void Math["abs"]
        void Math[member]
        void performance["timeOrigin"]
        void performance[member]
        void crypto["randomUUID"]
        void crypto["subtle"]
        void crypto[member]
      }
      function deterministic(): number {
        const { parse, UTC } = Date
        const { abs, max, PI } = Math
        return parse("2020-01-01") + UTC(2020, 0) + new Date(0).getTime() +
          new Date("2020-01-01").getTime() + abs(-1) + max(1, 2) + PI
      }
      function shadowed(
        Date: { now(): number; parse(value: string): number },
        Math: { random(): number; abs(value: number): number },
        performance: { now(): number },
        crypto: { randomUUID(): string; subtle: object },
        member: "now",
      ): void {
        const DateAlias = Date
        const { random } = Math
        void [DateAlias[member](), random(), performance.now(), crypto.randomUUID(), crypto.subtle]
      }
    `);
    const diagnostics = escaped.diagnostics.filter((diagnostic) =>
      ["VIBE1601", "VIBE1602", "VIBE1603"].includes(diagnostic.code));
    expect(new Set(diagnostics.map((diagnostic) => `${diagnostic.code}:${diagnostic.start}`)).size)
      .toBe(diagnostics.length);

    const within = (name: string, code: string) => {
      const fn = escaped.functions.find((candidate) => candidate.name === name)!;
      return diagnostics.filter((diagnostic) => diagnostic.code === code &&
        diagnostic.start >= fn.start && diagnostic.start < fn.end);
    };
    expect(within("aliases", "VIBE1602")).toHaveLength(2);
    expect(within("aliases", "VIBE1603")).toHaveLength(1);
    expect(within("aliases", "VIBE1601")).toHaveLength(1);
    expect(within("objectEscape", "VIBE1602")).toHaveLength(2);
    expect(within("objectEscape", "VIBE1603")).toHaveLength(1);
    expect(within("objectEscape", "VIBE1601")).toHaveLength(1);
    expect(within("destructured", "VIBE1602")).toHaveLength(2);
    expect(within("destructured", "VIBE1603")).toHaveLength(2);
    expect(within("destructured", "VIBE1601")).toHaveLength(1);
    expect(within("computed", "VIBE1602")).toHaveLength(4);
    expect(within("computed", "VIBE1603")).toHaveLength(3);
    expect(within("computed", "VIBE1601")).toHaveLength(2);
    expect(within("deterministic", "VIBE1601")).toHaveLength(0);
    expect(within("deterministic", "VIBE1602")).toHaveLength(0);
    expect(within("deterministic", "VIBE1603")).toHaveLength(0);
    expect(within("shadowed", "VIBE1601")).toHaveLength(0);
    expect(within("shadowed", "VIBE1602")).toHaveLength(0);
    expect(within("shadowed", "VIBE1603")).toHaveLength(0);
  });

  test("enforces must-consume Results and Promises and bans instance chaining", () => {
    const result = analyzeSource(`
      declare function result(): Result<number, Error>
      declare function work(): Promise<number>
      function badResult(): void { result() }
      function badPromise(): void { work() }
      function badChain(): Promise<number> { return work().then((value) => value + 1) }
      async function good(): Promise<void> { await Promise.all([work(), work()]) }
    `);
    const codes = result.diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes).toContain("VIBE1301");
    expect(codes).toContain("VIBE1402");
    expect(codes).toContain("VIBE1401");
    expect(result.diagnostics.some((diagnostic) =>
      diagnostic.start > result.functions.find((fn) => fn.name === "good")!.start &&
      diagnostic.start < result.functions.find((fn) => fn.name === "good")!.end,
    )).toBe(false);
  });

  test("checks and nominally lowers exhaustive Error matches", () => {
    const valid = compileCase(`
      class Missing extends Error { readonly id = 1 }
      class Busy extends Error {}
      function describe(error: Missing | Busy): string {
        return error.match({ Missing: (value) => String(value.id), Busy: () => "busy" })
      }
    `, "error-match");
    expect(valid.analysis.diagnostics).toHaveLength(0);
    expect(valid.code).toContain("error.match(__vsErrorCases([Missing,");
    expect(valid.code).toContain("[Busy,");
    expect(valid.code).toContain("vibe:examples/language/error-match.vibe:Missing");
    expect(emittedErrors(valid.code, "error-match")).toHaveLength(0);

    const missing = analyzeSource(`
      class Missing extends Error {}; class Busy extends Error {}
      function bad(error: Missing | Busy) { return error.match({ Missing: () => "x" }) }
    `);
    expect(missing.diagnostics.some((diagnostic) =>
      diagnostic.code === "VIBE1253" && diagnostic.message.includes("Busy"),
    )).toBe(true);
  });

  test("fails closed on expression control-flow and unsafe unwrap placement", () => {
    const result = analyzeSource(`
      declare function value(): Result<number, Error>
      function assign(flag: boolean) { let x = 0; x = if (flag) { 1 } else { 2 }; return x }
      function complex(): Result<number, Error> { return 1 + value().unwrap() }
      function labeled(flag: boolean) { outer: while (flag) break outer }
    `);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code))
      .toEqual(expect.arrayContaining(["VIBE1702", "VIBE1704", "VIBE1204"]));
    // A labeled loop is an ordinary statement: it must receive only the
    // label diagnostic, never the expression-keyword misclassification.
    const labeledLine = result.diagnostics.filter((diagnostic) => diagnostic.line === 5);
    expect(labeledLine.map((diagnostic) => diagnostic.code)).toEqual(["VIBE1704"]);
  });

  test("executes defer and errdefer lexical tails with provisional LIFO semantics", async () => {
    const { result, module } = await executeCase(`
      export class CleanupFailure extends Error {}
      export const events: string[] = []
      function failed(): Result<number, CleanupFailure> { throw new CleanupFailure() }

      export function success(): Result<number, CleanupFailure> {
        defer events.push("always")
        errdefer events.push("error")
        return 1
      }
      export function failure(kind: "return" | "throw" | "unwrap"): Result<number, CleanupFailure> {
        defer events.push("always:" + kind)
        errdefer events.push("error:" + kind)
        if (kind === "return") return failed()
        if (kind === "throw") throw new CleanupFailure()
        return failed().unwrap()
      }
      export function registrationAfterEarlyReturn(early: boolean): number {
        if (early) return 0
        defer events.push("registered")
        return 1
      }
      export function fallthrough(): void {
        defer events.push("fallthrough")
      }
      export function nested(returnInside: boolean): number {
        defer events.push("outer")
        {
          defer events.push("inner")
          if (returnInside) return 1
        }
        return 2
      }
      export function nestedFunctionOwner(): Result<void, CleanupFailure> {
        errdefer events.push("outer-nested-error")
        const inner = (): Result<number, CleanupFailure> => {
          throw new CleanupFailure()
        }
        inner().isError()
      }
      export function loopExits(): void {
        for (let index = 0; index < 3; index++) {
          defer events.push("loop" + index)
          if (index === 0) continue
          break
        }
      }
      export function caughtJavaScriptThrow(): void {
        try {
          {
            defer events.push("js-finally")
            throw "ordinary JavaScript throw"
          }
        } catch { events.push("js-caught") }
      }
      async function asyncCleanup(value: string): Promise<void> {
        await Promise.resolve()
        events.push(value)
      }
      export async function asyncDefer(): Promise<number> {
        defer await asyncCleanup("async")
        return 3
      }
      export async function asyncErrdefer(): Promise<Result<number, CleanupFailure>> {
        errdefer await asyncCleanup("async-error")
        throw new CleanupFailure()
      }
    `, "defer-execution");

    expect(result.analysis.diagnostics).toHaveLength(0);
    expect(emittedErrors(result.code, "defer-execution")).toHaveLength(0);
    expect(module.events).toEqual([]);

    expect(__vsInspectResult(module.success()).ok).toBe(true);
    expect(module.events.splice(0)).toEqual(["always"]);
    for (const kind of ["return", "throw", "unwrap"] as const) {
      expect(__vsInspectResult(module.failure(kind)).ok).toBe(false);
      expect(module.events.splice(0)).toEqual([`error:${kind}`, `always:${kind}`]);
    }
    expect(module.registrationAfterEarlyReturn(true)).toBe(0);
    expect(module.events.splice(0)).toEqual([]);
    expect(module.registrationAfterEarlyReturn(false)).toBe(1);
    expect(module.events.splice(0)).toEqual(["registered"]);
    module.fallthrough();
    expect(module.events.splice(0)).toEqual(["fallthrough"]);
    expect(module.nested(true)).toBe(1);
    expect(module.events.splice(0)).toEqual(["inner", "outer"]);
    expect(module.nested(false)).toBe(2);
    expect(module.events.splice(0)).toEqual(["inner", "outer"]);
    expect(__vsInspectResult(module.nestedFunctionOwner()).ok).toBe(true);
    expect(module.events.splice(0)).toEqual([]);
    module.loopExits();
    expect(module.events.splice(0)).toEqual(["loop0", "loop1"]);
    module.caughtJavaScriptThrow();
    expect(module.events.splice(0)).toEqual(["js-finally", "js-caught"]);
    expect(await module.asyncDefer()).toBe(3);
    expect(module.events.splice(0)).toEqual(["async"]);
    expect(__vsInspectResult(await module.asyncErrdefer()).ok).toBe(false);
    expect(module.events.splice(0)).toEqual(["async-error"]);
  });

  test("fails closed on ambiguous defer cleanup, placement, and async Result exits", () => {
    const result = analyzeSource(`
      import { panic } from "vibelang:exceptions"
      class CleanupFailure extends Error {}
      function plainCleanup(): void {}
      function resultCleanup(): Result<void, CleanupFailure> { throw new CleanupFailure() }
      async function promiseCleanup(): Promise<void> {}
      async function promisedResult(): Promise<Result<number, CleanupFailure>> { throw new CleanupFailure() }

      function missing(): void { defer; }
      function declarationCleanup(): void { defer const value = 1 }
      function singleStatement(flag: boolean): void { if (flag) defer plainCleanup() }
      function plainErrdefer(): void { errdefer plainCleanup(); return }
      function resultChannel(): Result<number, CleanupFailure> { defer resultCleanup(); return 1 }
      function unwrapCleanup(): Result<number, CleanupFailure> { defer resultCleanup().unwrap(); return 1 }
      function panicCleanup(): Result<number, Panic> { defer panic(); return 1 }
      function promiseChannel(): number { defer promiseCleanup(); return 1 }
      function syncAwait(): number { defer await promiseCleanup(); return 1 }
      async function asyncTail(): Promise<Result<number, CleanupFailure>> {
        errdefer await promiseCleanup()
        return promisedResult()
      }
    `);
    const codes = result.diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes.filter((code) => code === "VIBE1710").length).toBeGreaterThanOrEqual(3);
    expect(codes).toContain("VIBE1711");
    expect(codes.filter((code) => code === "VIBE1712").length).toBeGreaterThanOrEqual(5);
    expect(codes).toContain("VIBE1713");
    expect(result.diagnostics.filter((diagnostic) => diagnostic.code.startsWith("VIBE171"))
      .every((diagnostic) => diagnostic.line > 0 && diagnostic.column > 0)).toBe(true);
  });

  test("preserves JavaScript try/catch while lifting uncaught Error exits", () => {
    const result = compileCase(`
      class Failure extends Error {}
      function caught(): Result<string, Failure> {
        try { throw new Failure() } catch { return "caught" }
      }
      function uncaught(): Result<string, Failure> { throw new Failure() }
    `, "try-catch");
    expect(result.code).toContain("try {");
    expect(result.code).toContain("throw new Failure()");
    expect(result.code).toContain("return __vsResultFailure(new Failure())");
    expect(emittedErrors(result.code, "try-catch")).toHaveLength(0);
  });

  test("recursively lowers loop bodies and fails closed on repeated header exits", () => {
    const result = compileCase(`
      class Failure extends Error {}
      function next(): Result<number, Failure> { return 1 }
      function loop(active: boolean): Result<number, Failure> {
        while (active) {
          const value = next().unwrap()
          if (value > 0) throw new Failure()
          return value
        }
        for (let index = next().unwrap(); index < 2; index++) {
          if (index === 1) return index
        }
        return 0
      }
    `, "loops");
    expect(result.analysis.diagnostics).toHaveLength(0);
    expect(result.code.match(/__vsInspectResult\(next\(\)\)/g)?.length).toBe(2);
    expect(result.code).toContain("return __vsResultFailure(new Failure())");
    expect(result.code).toContain("return __vsResultSuccess(value)");
    expect(result.code).toContain("return __vsResultSuccess(index)");
    expect(emittedErrors(result.code, "loops")).toHaveLength(0);

    const unsupported = analyzeSource(`
      class Failure extends Error {}
      declare function next(): Result<boolean, Failure>
      function bad(): Result<void, Failure> {
        while (next().unwrap()) {}
      }
    `);
    expect(unsupported.diagnostics.some((diagnostic) => diagnostic.code === "VIBE1703")).toBe(true);
  });

  test("does not treat an authored Reflect.panic property as the compiler intrinsic", () => {
    const source = `function call(): string { const Reflect = { panic(): string { return "ordinary" } }; return Reflect.panic() }\n`;
    const result = compileCase(source, "shadowed-reflect");
    expect(result.analysis.rows.call?.failures).toEqual([]);
    expect(result.analysis.diagnostics).toHaveLength(0);
    expect(result.code).toBe(source);
    expect(result.code).not.toContain("__vsPanicValue");
  });

  test("aliases compiler hooks away from authored bindings", () => {
    const result = compileCase(`
      const __vsResultSuccess = "author value"
      class Failure extends Error {}
      function lifted(): Result<number, Failure> { return 1 }
      export { __vsResultSuccess, lifted }
    `, "helper-alias");
    expect(result.code).toContain("__vsResultSuccess as __vsResultSuccess$vibe");
    expect(result.code).toContain("return __vsResultSuccess$vibe(1)");
    expect(emittedErrors(result.code, "helper-alias")).toHaveLength(0);
  });

  test("emits an embedded conservative token map and exposes a no-write checked API", () => {
    const options = {
      fileName: `${examples}/mapped.vibe`,
      outputFileName: `${examples}/mapped.generated.ts`,
      sourceName: "examples/language/mapped.vibe",
      runtimeImport: "../../src/runtime/index.ts",
    } as const;
    const source = `class E extends Error {}\nfunction value(): Result<number, E> { return 1 }\n`;
    const checked = compileAndCheckVibe(source, options);
    expect(checked.ok).toBe(true);
    expect(checked.emitDiagnostics).toHaveLength(0);
    const map = JSON.parse(checked.result.sourceMap!) as { version: number; sources: string[]; sourcesContent: string[] };
    expect(map.version).toBe(3);
    expect(map.sources).toEqual(["examples/language/mapped.vibe"]);
    expect(map.sourcesContent).toEqual([source]);
  });

  test("lowers Optional.unwrap() absence propagation in Optional and Result<Optional> owners", async () => {
    const { result, module } = await executeCase(`
      export function findCached(id: number): Optional<string> {
        if (id === 1) return "ada@example.test"
        return undefined
      }
      export function primaryEmail(id: number): Optional<string> {
        const email = findCached(id).unwrap()
        return email.toUpperCase()
      }
      export class MissingDirectory extends Error {}
      export function guarded(id: number): Result<Optional<string>, MissingDirectory> {
        if (id < 0) throw new MissingDirectory()
        const email = findCached(id).unwrap()
        return email
      }
    `, "optional-unwrap");

    expect(result.analysis.diagnostics).toHaveLength(0);
    expect(result.analysis.rows.primaryEmail).toEqual({ failures: [], requirements: [] });
    expect(result.analysis.rows.guarded?.failures).toEqual(["MissingDirectory"]);
    expect(result.code).toContain("__vsInspectOptional(findCached(id))");
    expect(result.code).toContain("return __vsOptionalNone()");
    expect(result.code).toContain("return __vsResultSuccess(__vsOptionalNone())");
    expect(emittedErrors(result.code, "optional-unwrap")).toHaveLength(0);

    expect(__vsInspectOptional(module.primaryEmail(1))).toEqual({ some: true, value: "ADA@EXAMPLE.TEST" });
    expect(__vsInspectOptional(module.primaryEmail(2))).toEqual({ some: false });
    const present = __vsInspectResult(module.guarded(1));
    expect(present.ok).toBe(true);
    expect(__vsInspectOptional((present as { value: any }).value)).toEqual({ some: true, value: "ada@example.test" });
    const absent = __vsInspectResult(module.guarded(2));
    expect(absent.ok).toBe(true);
    expect(__vsInspectOptional((absent as { value: any }).value)).toEqual({ some: false });
    expect(__vsInspectResult(module.guarded(-1)).ok).toBe(false);
  });

  test("rejects Optional.unwrap() without an Optional-capable owner instead of compiling it verbatim", () => {
    const plain = analyzeSource(`
      declare function findCached(id: number): Optional<string>
      function broken(id: number): string { return findCached(id).unwrap() }
    `);
    expect(plain.diagnostics.filter((diagnostic) => diagnostic.code === "VIBE1206")).toHaveLength(1);

    const resultOwner = analyzeSource(`
      class Missing extends Error {}
      declare function findCached(id: number): Optional<string>
      function alsoBroken(id: number): Result<string, Missing> {
        if (id < 0) throw new Missing()
        return findCached(id).unwrap()
      }
    `);
    expect(resultOwner.diagnostics.filter((diagnostic) => diagnostic.code === "VIBE1206")).toHaveLength(1);

    const topLevel = analyzeSource(`
      declare function findCached(id: number): Optional<string>
      const value = findCached(1).unwrap()
    `);
    expect(topLevel.diagnostics.filter((diagnostic) => diagnostic.code === "VIBE1206")).toHaveLength(1);

    const placements = analyzeSource(`
      declare function next(): Optional<boolean>
      declare function maybeNumber(): Optional<number>
      function loop(): Optional<boolean> {
        while (next().unwrap()) {}
        return false
      }
      function complex(): Optional<number> { return 1 + maybeNumber().unwrap() }
      function cleanup(): Optional<number> { defer maybeNumber().unwrap(); return 1 }
    `);
    const codes = placements.diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes).toContain("VIBE1703");
    expect(codes).toContain("VIBE1204");
    expect(codes).toContain("VIBE1712");
  });

  test("charges the distinguished Panic channel for Result.expect()", () => {
    const analysis = analyzeSource(`
      class Missing extends Error {}
      declare function load(): Result<number, Missing>
      function inferredFallible(flag: boolean) {
        if (flag) throw new Missing()
        return 1
      }
      function checked(): Result<number, Panic> { return load().expect("required") }
      function viaInferred(): Result<number, Panic> { return inferredFallible(true).expect("required") }
      function wrong(): Result<number, Missing> { return load().expect("required") }
      function silent(): number { return load().expect("required") }
    `);
    expect(analysis.rows.checked?.failures).toEqual(["Panic"]);
    expect(analysis.rows.viaInferred?.failures).toEqual(["Panic"]);
    expect(analysis.diagnostics.some((diagnostic) =>
      diagnostic.code === "VIBE1104" && diagnostic.message.includes("Panic"),
    )).toBe(true);
    expect(analysis.diagnostics.some((diagnostic) => diagnostic.code === "VIBE1101")).toBe(true);

    const topLevel = analyzeSource(`
      declare function load(): Result<number, Error>
      const value = load().expect("required")
    `);
    expect(topLevel.diagnostics.some((diagnostic) =>
      diagnostic.code === "VIBE1505" && diagnostic.message.includes("expect"),
    )).toBe(true);
  });

  test("fails closed on top-level throw statements and class static blocks", () => {
    const topThrow = analyzeSource(`
      class Broken extends Error {}
      throw new Broken()
      { throw new Broken() }
    `);
    expect(topThrow.diagnostics.filter((diagnostic) => diagnostic.code === "VIBE1511")).toHaveLength(2);

    const statics = analyzeSource(`
      class Holder {
        static { }
      }
      function build(): void {
        class Local {
          static { }
        }
      }
    `);
    expect(statics.diagnostics.filter((diagnostic) => diagnostic.code === "VIBE1107")).toHaveLength(2);

    const staticThrow = analyzeSource(`
      class Booted {
        static { throw new Error("boot") }
      }
    `);
    expect(staticThrow.diagnostics.filter((diagnostic) => diagnostic.code === "VIBE1107")).toHaveLength(1);
    expect(staticThrow.diagnostics.filter((diagnostic) => diagnostic.code === "VIBE1511")).toHaveLength(0);
  });

  test("fails closed when the internal parser diagnostics field is unavailable", () => {
    const sourceFile = ts.createSourceFile("probe.vibe.ts", "const value = 1\n", ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    expect(internalParseDiagnostics(sourceFile)).toBeDefined();
    expect(parseDiagnosticsFailure(sourceFile)).toBeUndefined();
    delete (sourceFile as unknown as { parseDiagnostics?: unknown }).parseDiagnostics;
    expect(internalParseDiagnostics(sourceFile)).toBeUndefined();
    const failure = parseDiagnosticsFailure(sourceFile);
    expect(failure?.code).toBe("VIBE1002");
    expect(failure?.severity).toBe("error");
    expect(analyzeSource("const ok = 1\n").diagnostics.some((diagnostic) => diagnostic.code === "VIBE1002")).toBe(false);
  });

  test("treats vibelang-prefixed package names as foreign, not compiler intrinsics", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vibe-prefix-"));
    try {
      const packageDirectory = join(directory, "node_modules", "vibelangutils");
      await mkdir(packageDirectory, { recursive: true });
      await writeFile(join(packageDirectory, "package.json"), JSON.stringify({
        name: "vibelangutils",
        version: "1.0.0",
        types: "index.d.ts",
      }));
      await writeFile(join(packageDirectory, "index.d.ts"), [
        "/** @module @throws {never} */",
        "export declare function helper(value: string): number;",
        "",
      ].join("\n"));

      const source = `
        import { helper } from "vibelangutils"
        function use(): Result<number, Panic> { return helper("x").unwrap() }
      `;
      const analysis = analyzeSource(source, { fileName: join(directory, "case.vibe") });
      expect(analysis.diagnostics).toHaveLength(0);
      expect(analysis.rows.use).toEqual({ failures: ["Panic"], requirements: ["TypeScript"] });

      const compiled = compileVibe(source, {
        fileName: join(directory, "case.vibe"),
        outputFileName: join(directory, "case.generated.ts"),
        sourceName: "case.vibe",
        runtimeImport: "../../src/runtime/index.ts",
      });
      expect(compiled.code).toContain("Result.try(() => helper(\"x\"))");
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  test("fails closed on panic and unwrap propagation inside a JavaScript try with a catch clause", () => {
    const analysis = analyzeSource(`
      import { panic } from "vibelang:exceptions"
      class Missing extends Error {}
      declare function load(): Result<number, Missing>
      declare function maybe(): Optional<number>
      function caughtPanic(): Result<void, Panic> {
        try { panic("boom") } catch { return }
      }
      function caughtUnwrap(): Result<number, Missing> {
        try { return load().unwrap() } catch { return 0 }
      }
      function caughtOptional(): Optional<number> {
        try { return maybe().unwrap() } catch { return undefined }
      }
      function finallyOnly(): Result<number, Missing> {
        try { return load().unwrap() } finally { }
      }
      function nestedOwner(): Result<number, Missing> {
        try {
          const inner = (): Result<number, Missing> => load().unwrap()
          return inner()
        } catch { return 0 }
      }
    `);
    const catches = analysis.diagnostics.filter((diagnostic) => diagnostic.code === "VIBE1205");
    expect(catches).toHaveLength(3);
    expect(catches.map((diagnostic) => diagnostic.message.split(" ")[0])).toEqual([
      "panic(...)",
      "Result.unwrap()",
      "Optional.unwrap()",
    ]);
  });

  test("accepts the documented authored Result.try adapter boundary", () => {
    const result = compileCase(`
      import { foreignClient, untrustedAsync } from "./foreign.ts"
      class ConnectFailed extends Error {}
      function connect(value: string): Result<string, ConnectFailed | Panic> {
        return Result.try(
          () => foreignClient.untrustedMethod(value),
          (cause) => new ConnectFailed(),
        )
      }
      async function fetchRemote(value: string): Promise<Result<string, Panic>> {
        return await Result.tryPromise(() => untrustedAsync(value))
      }
    `, "authored-result-try");
    expect(result.analysis.diagnostics).toHaveLength(0);
    expect(result.analysis.rows.connect).toEqual({
      failures: ["ConnectFailed", "Panic"],
      requirements: ["TypeScript"],
    });
    expect(result.analysis.rows.fetchRemote).toEqual({ failures: ["Panic"], requirements: ["TypeScript"] });
    expect(result.code).not.toContain("Result.try(() => Result.try");
    expect(result.code).not.toContain("Result.tryPromise(() => Result.tryPromise");
    expect(emittedErrors(result.code, "authored-result-try")).toHaveLength(0);

    const scannerFixed = analyzeSource(`function safe(): Result<number, Panic> { return Result.try(() => 1) }`);
    expect(scannerFixed.diagnostics).toHaveLength(0);
    expect(scannerFixed.rows.safe?.failures).toEqual(["Panic"]);
  });

  test("checked API rejects TypeScript-invalid lowered output", () => {
    const checked = compileAndCheckVibe(`
      class E extends Error {}
      function wrong(): Result<number, E> { return "not a number" }
    `, {
      fileName: `${examples}/invalid-output.vibe`,
      outputFileName: `${examples}/invalid-output.generated.ts`,
      sourceName: "examples/language/invalid-output.vibe",
      runtimeImport: "../../src/runtime/index.ts",
    });
    expect(checked.ok).toBe(false);
    expect(checked.emitDiagnostics.length).toBeGreaterThan(0);
  });
});
