import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as ts from "typescript-js";
import { analyzeSource } from "./analyze.ts";
import { compileSmithers } from "./compile.ts";
import { internalParseDiagnostics, parseDiagnosticsFailure } from "./semantic.ts";
import { checkEmittedTypeScript, compileAndCheckSmithers } from "./validate.ts";
import { __vsInspectResult } from "../runtime/index.ts";

const examples = `${import.meta.dir}/../../examples/language`;

function compileCase(source: string, name = "case") {
  return compileSmithers(source, {
    fileName: `${examples}/${name}.sm`,
    outputFileName: `${examples}/${name}.generated.ts`,
    sourceName: `examples/language/${name}.sm`,
    runtimeImport: "../../src/runtime/index.ts",
  });
}

function emittedErrors(code: string, name = "case") {
  return checkEmittedTypeScript(code, `${examples}/${name}.generated.ts`)
    .filter((diagnostic) => diagnostic.category === 1);
}

async function executeCase(source: string, name: string) {
  const result = compileSmithers(source, {
    fileName: `${examples}/${name}.sm`,
    outputFileName: `${examples}/${name}.generated.ts`,
    sourceName: `examples/language/${name}.sm`,
    runtimeImport: "../../src/runtime/index.ts",
  });
  const executable = compileSmithers(source, {
    fileName: `${examples}/${name}.sm`,
    outputFileName: `${examples}/${name}.generated.ts`,
    sourceName: `examples/language/${name}.sm`,
    runtimeImport: pathToFileURL(`${import.meta.dir}/../runtime/index.ts`).href,
  });
  const javascript = new Bun.Transpiler({ loader: "ts", target: "bun" })
    .transformSync(executable.code);
  const directory = await mkdtemp(join(tmpdir(), "smithers-language-"));
  const modulePath = join(directory, `${name}.mjs`);
  try {
    await writeFile(modulePath, javascript);
    const module = await import(pathToFileURL(modulePath).href) as Record<string, any>;
    return { result, module };
  } finally {
    await rm(directory, { recursive: true });
  }
}

describe("checked .sm frontend", () => {
  test("keeps unchanged TypeScript byte-for-byte when no Smithers lowering is needed", () => {
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
      .filter((diagnostic) => diagnostic.code === "SMITHERS1001")
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

  test("does not classify Promise .catch() as the retired postfix catch expression", () => {
    const result = analyzeSource(`
      async function load(): Promise<string> { return "value" }
      async function run(): Promise<string> {
        return await load().catch(() => "fallback")
      }
    `);
    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === "SMITHERS1001")).toHaveLength(0);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "SMITHERS1401")).toBe(true);
  });

  test("infers local Results and emits explicit success, failure, and postfix propagation branches", () => {
    const result = compileCase(`
      class Missing extends Error {}
      function leaf(id: number) {
        if (id === 0) throw new Missing()
        return id
      }
      function root(id: number): Result<number, Missing> {
        const value = leaf(id)!
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

  test("withdraws Result.unwrap, non-null assertions, and definite assignment", () => {
    const analysis = analyzeSource(`
      class Missing extends Error {}
      class Holder { value!: string }
      declare function lookup(): Result<string, Missing>
      function retired(): Result<string, Missing> { return lookup().unwrap() }
      function nonNull(value: string | undefined): string { return value! }
    `);
    expect(analysis.diagnostics.filter((diagnostic) =>
      ["SMITHERS1001", "SMITHERS1206", "SMITHERS1207"].includes(diagnostic.code),
    ).map((diagnostic) => diagnostic.code).sort()).toEqual([
      "SMITHERS1001",
      "SMITHERS1206",
      "SMITHERS1207",
    ]);
  });

  test("keeps prefix bangs, !==, optional chaining, and nullish coalescing ordinary", () => {
    const result = compileCase(`
      class Missing extends Error {}
      interface Profile { readonly nickname?: string }
      function findUser(id: number): Result<Profile | undefined, Missing> {
        if (id < 0) throw new Missing()
        return id === 0 ? undefined : { nickname: id === 1 ? "Ada" : undefined }
      }
      export function main(flag: boolean): Result<string[], Missing> {
        const name = findUser(1)!?.nickname ?? "anonymous"
        const absent = findUser(0)!?.nickname ?? "anonymous"
        const value: string = ["smithers"].join("")
        return [String(!flag), String(!!value), String(value !== ""), name, absent]
      }
    `, "postfix-and-prefix-bang");
    expect(result.analysis.diagnostics).toHaveLength(0);
    expect(result.code).toContain("!==");
    expect(result.code).toContain("??");
    expect(emittedErrors(result.code, "postfix-and-prefix-bang")).toHaveLength(0);
  });

  test("requires explicit Result contracts only at exported boundaries", () => {
    const local = analyzeSource(`class E extends Error {}; function inferred() { throw new E() }`);
    expect(local.rows.inferred?.failures).toEqual(["E"]);
    expect(local.diagnostics.some((diagnostic) => diagnostic.code === "SMITHERS1102")).toBe(false);

    const exported = analyzeSource(`class E extends Error {}; export function inferred() { throw new E() }`);
    expect(exported.diagnostics.some((diagnostic) => diagnostic.code === "SMITHERS1102")).toBe(true);
  });

  test("lowers the checked panic channel to an Error Result value", () => {
    const result = compileCase(`
      import { Panic, panic } from "smithers:exceptions"
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
        return declaredFailure(true)!
      }
      async function unknown(): Promise<Result<string, Panic>> {
        return (await untrustedAsync("x"))!
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
      function wrong(): Result<string, ForeignFailure> { return declaredFailure(true)! }
    `, { fileName: `${examples}/foreign-omitted.sm` });
    expect(omitted.diagnostics.some((diagnostic) =>
      diagnostic.code === "SMITHERS1104" && diagnostic.message.includes("Panic"),
    )).toBe(true);

    const constructor = analyzeSource(`
      import { ForeignFailure } from "./foreign.ts"
      function unsupported(): ForeignFailure { return new ForeignFailure() }
    `, { fileName: `${examples}/foreign-constructor.sm` });
    expect(constructor.diagnostics.some((diagnostic) => diagnostic.code === "SMITHERS1504")).toBe(true);
  });

  test("fails closed on untrusted foreign module initialization while preserving type-only and dynamic adapters", async () => {
    const directory = await mkdtemp(join(tmpdir(), "smithers-module-init-"));
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
      `, { fileName: join(directory, "rejected.sm") });
      expect(rejected.diagnostics.filter((diagnostic) => diagnostic.code === "SMITHERS1510")).toHaveLength(1);

      const late = analyzeSource(`
        import { trustedCall } from "./late-marker.ts"
        function call(): Result<number, Panic> { return trustedCall()! }
      `, { fileName: join(directory, "late.sm") });
      expect(late.diagnostics.filter((diagnostic) => diagnostic.code === "SMITHERS1510")).toHaveLength(1);

      const ordinary = analyzeSource(`
        import { value } from "./ordinary-marker.ts"
        export const copied = value
      `, { fileName: join(directory, "ordinary.sm") });
      expect(ordinary.diagnostics.filter((diagnostic) => diagnostic.code === "SMITHERS1510")).toHaveLength(1);

      const ambiguous = analyzeSource(`
        import { value } from "./ambiguous-marker.ts"
        export const copied = value
      `, { fileName: join(directory, "ambiguous.sm") });
      expect(ambiguous.diagnostics.filter((diagnostic) => diagnostic.code === "SMITHERS1510")).toHaveLength(1);

      const accepted = analyzeSource(`
        import type { Label as UntrustedLabel } from "./untrusted.ts"
        import { type Label, value } from "./trusted.ts"
        import { load } from "./adapter.ts"
        import { panic } from "smithers:exceptions"
        const label: Label | UntrustedLabel = value
        async function deferred(): Promise<Result<unknown, Panic>> {
          return (await load())!
        }
      `, { fileName: join(directory, "accepted.sm") });
      expect(accepted.diagnostics.filter((diagnostic) => diagnostic.code === "SMITHERS1510")).toHaveLength(0);
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
        return declaredJavaScriptFailure(true)!
      }
      async function unknownJs(): Promise<Result<string, Panic>> {
        return (await untrustedJavaScriptAsync("x"))!
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
      function realForeignUnwrapMethod(): Result<void, Panic> { foreignAny.unwrap()! }
      function method(): Result<string, Panic> {
        return clientAlias.untrustedMethod("X")!
      }
      function declaredMethod(): Result<string, AF | Panic> {
        return foreignClient.declaredMethod(false)!
      }
      function storedCallable(): Result<string, FF | Panic> {
        return stored.invoke(false)!
      }
      function generatedCallable(): Result<string, Panic> {
        const callable: (value: string) => string = makeCallable()!
        return callable("x")!
      }
      async function generatedAsyncCallable(): Promise<Result<string, Panic>> {
        const callable: (value: string) => Promise<string> = (await makeAsyncCallable())!
        return (await callable("x"))!
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
      function nestedFactory(): Result<string, Panic> { return makeCallable()("x")! }
      function uncheckedFactoryAlias(): Result<string, Panic> {
        const callable: (value: string) => string = makeCallable()
        return callable("x")!
      }
      function callbacks(): Result<void, Panic> {
        receiveCallback(() => {})!
        receiveCallbackOptions({ onValue: () => {} })!
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
    `, { fileName: `${examples}/foreign-adversarial.sm` });

    expect(analysis.diagnostics.filter((diagnostic) => diagnostic.code === "SMITHERS1506")).toHaveLength(2);
    expect(analysis.diagnostics.some((diagnostic) => diagnostic.code === "SMITHERS1507")).toBe(true);
    expect(analysis.diagnostics.filter((diagnostic) => diagnostic.code === "SMITHERS1509")).toHaveLength(3);
    expect(analysis.diagnostics.some((diagnostic) => diagnostic.code === "SMITHERS1508")).toBe(true);
    expect(analysis.diagnostics.filter((diagnostic) => diagnostic.code === "SMITHERS1504")).toHaveLength(2);
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
      function method(): Result<string, Panic> { return javaScriptClient.untrustedMethod("x")! }
      function generated(): Result<string, Panic> {
        const callable: (value: string) => string = makeJavaScriptCallable()!
        return callable("x")!
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
        receiveJavaScriptCallback(() => {})!
        receiveJavaScriptCallbackOptions({ onValue: () => {} })!
      }
    `, { fileName: `${examples}/foreign-javascript-adversarial.sm` });
    expect(rejected.diagnostics.filter((diagnostic) => diagnostic.code === "SMITHERS1506")).toHaveLength(1);
    expect(rejected.diagnostics.filter((diagnostic) => diagnostic.code === "SMITHERS1509")).toHaveLength(2);
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
    `, { fileName: `${examples}/foreign-javascript-top-level.sm` });

    const boundaryErrors = analysis.diagnostics.filter((diagnostic) => diagnostic.code === "SMITHERS1505");
    expect(boundaryErrors).toHaveLength(2);
    expect(boundaryErrors.every((diagnostic) => diagnostic.message.includes("top level"))).toBe(true);
    expect(analysis.diagnostics.some((diagnostic) => diagnostic.code === "SMITHERS1504")).toBe(true);
  });

  test("infers Context requirements transitively and subtracts known Layers", () => {
    const prefix = `
      import { Context } from "smthrs/context"
      import { Layer } from "smthrs/provider"
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
    expect(nested.diagnostics.some((diagnostic) => diagnostic.code === "SMITHERS2101")).toBe(false);

    const closed = analyzeSource(`${prefix} Layer.provide(DbLive, () => needsBoth())`);
    expect(closed.diagnostics.some((diagnostic) =>
      diagnostic.code === "SMITHERS2101" && diagnostic.message.includes("Logger"),
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
    expect(ambient.diagnostics.filter((diagnostic) => diagnostic.code === "SMITHERS1602")).toHaveLength(5);
    expect(ambient.diagnostics.filter((diagnostic) => diagnostic.code === "SMITHERS1603")).toHaveLength(3);
    expect(ambient.diagnostics.some((diagnostic) =>
      diagnostic.code === "SMITHERS1602" && diagnostic.start > ambient.functions.find((fn) => fn.name === "deterministicDate")!.start,
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
      diagnostic.code === "SMITHERS1602" || diagnostic.code === "SMITHERS1603",
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
      ["SMITHERS1601", "SMITHERS1602", "SMITHERS1603"].includes(diagnostic.code));
    expect(new Set(diagnostics.map((diagnostic) => `${diagnostic.code}:${diagnostic.start}`)).size)
      .toBe(diagnostics.length);

    const within = (name: string, code: string) => {
      const fn = escaped.functions.find((candidate) => candidate.name === name)!;
      return diagnostics.filter((diagnostic) => diagnostic.code === code &&
        diagnostic.start >= fn.start && diagnostic.start < fn.end);
    };
    expect(within("aliases", "SMITHERS1602")).toHaveLength(2);
    expect(within("aliases", "SMITHERS1603")).toHaveLength(1);
    expect(within("aliases", "SMITHERS1601")).toHaveLength(1);
    expect(within("objectEscape", "SMITHERS1602")).toHaveLength(2);
    expect(within("objectEscape", "SMITHERS1603")).toHaveLength(1);
    expect(within("objectEscape", "SMITHERS1601")).toHaveLength(1);
    expect(within("destructured", "SMITHERS1602")).toHaveLength(2);
    expect(within("destructured", "SMITHERS1603")).toHaveLength(2);
    expect(within("destructured", "SMITHERS1601")).toHaveLength(1);
    expect(within("computed", "SMITHERS1602")).toHaveLength(4);
    expect(within("computed", "SMITHERS1603")).toHaveLength(3);
    expect(within("computed", "SMITHERS1601")).toHaveLength(2);
    expect(within("deterministic", "SMITHERS1601")).toHaveLength(0);
    expect(within("deterministic", "SMITHERS1602")).toHaveLength(0);
    expect(within("deterministic", "SMITHERS1603")).toHaveLength(0);
    expect(within("shadowed", "SMITHERS1601")).toHaveLength(0);
    expect(within("shadowed", "SMITHERS1602")).toHaveLength(0);
    expect(within("shadowed", "SMITHERS1603")).toHaveLength(0);
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
    expect(codes).toContain("SMITHERS1301");
    expect(codes).toContain("SMITHERS1402");
    expect(codes).toContain("SMITHERS1401");
    expect(result.diagnostics.some((diagnostic) =>
      diagnostic.start > result.functions.find((fn) => fn.name === "good")!.start &&
      diagnostic.start < result.functions.find((fn) => fn.name === "good")!.end,
    )).toBe(false);
  });

  test("consumes concise andThen callback returns without hiding discarded Results", () => {
    const analysis = analyzeSource(`
      class Missing extends Error {}
      declare function lookup(value: number): Result<number, Missing>
      function good(): Result<number, Missing> {
        return lookup(1).andThen((value) => lookup(value))
      }
      function bad(): Result<number, Missing> {
        return lookup(1).andThen((value) => {
          lookup(value)
          return lookup(value)
        })
      }
    `);
    const mustConsume = analysis.diagnostics.filter((diagnostic) => diagnostic.code === "SMITHERS1301");
    expect(mustConsume).toHaveLength(1);
    expect(mustConsume[0]!.start).toBeGreaterThan(analysis.functions.find((fn) => fn.name === "bad")!.start);
  });

  test("discharges must-consume only through the compiler-owned Result namespace", () => {
    // A user's own `Result` value shadows the prelude global. It is not the
    // compiler's combinator, so it discharges nothing.
    const shadowedBinding = analyzeSource(`
      declare function mightFail(): Result<number, Error>
      const Result = { all: (values: readonly unknown[]) => values }
      export function leak(): void {
        const r = mightFail()
        Result.all([r])
      }
    `);
    expect(shadowedBinding.diagnostics.map((diagnostic) => diagnostic.code)).toContain("SMITHERS1302");

    const shadowedCall = analyzeSource(`
      declare function mightFail(): Result<number, Error>
      const Result = { all: (values: readonly unknown[]) => values }
      export function leak(): void {
        Result.all([mightFail()])
      }
    `);
    expect(shadowedCall.diagnostics.map((diagnostic) => diagnostic.code)).toContain("SMITHERS1301");

    // A same-spelled member on an unrelated receiver discharges nothing either.
    const impostorReceiver = analyzeSource(`
      declare function mightFail(): Result<number, Error>
      const helpers = { all: (values: readonly unknown[]) => values }
      export function leak(): void {
        const r = mightFail()
        helpers.all([r])
      }
    `);
    expect(impostorReceiver.diagnostics.map((diagnostic) => diagnostic.code)).toContain("SMITHERS1302");

    // The genuine combinator still discharges, through the array literal and
    // through a binding that names the same compiler-owned namespace value.
    const genuine = analyzeSource(`
      declare function mightFail(): Result<number, Error>
      function fine(): Result<unknown, Error> {
        const r = mightFail()
        return Result.all([r])
      }
      function alsoFine(): Result<unknown, Error> {
        return Result.all([mightFail(), mightFail()])
      }
    `);
    expect(genuine.diagnostics.filter((diagnostic) =>
      diagnostic.code === "SMITHERS1301" || diagnostic.code === "SMITHERS1302",
    )).toHaveLength(0);

    // Every recognized receiver consumer still discharges, and each is
    // recognized through the prelude declaration rather than its spelling.
    const receivers = analyzeSource(`
      class Missing extends Error {}
      declare function mightFail(): Result<number, Missing>
      function isOk(): boolean { return mightFail().isOk() }
      function isError(): boolean { return mightFail().isError() }
      function match(): string { return mightFail().match({ ok: () => "ok", error: () => "no" }) }
      function map(): Result<string, Missing> { return mightFail().map(String) }
      function mapError(): Result<number, Missing> { return mightFail().mapError((error) => error) }
      function andThen(): Result<number, Missing> { return mightFail().andThen(() => mightFail()) }
      function recover(): Result<number, never> { return mightFail().recover(() => 0) }
      function tap(): Result<number, Missing> { return mightFail().tap(() => undefined) }
      function tapError(): Result<number, Missing> { return mightFail().tapError(() => undefined) }
      function unwrap(): number { return mightFail()! }
      function unwrapOr(): number { return mightFail().unwrapOr(0) }
      function expect_(): number { return mightFail().expect("required") }
    `);
    expect(receivers.diagnostics.filter((diagnostic) =>
      diagnostic.code === "SMITHERS1301" || diagnostic.code === "SMITHERS1302",
    )).toHaveLength(0);

    // A lifted call still carries its AUTHORED success type, so the checker has
    // no prelude `Result` member to resolve. The obligation must still
    // discharge; this is why the receiver surface keeps a spelling fallback and
    // the namespace does not.
    const lifted = analyzeSource(`
      class Missing extends Error {}
      function fallible(): number { throw new Missing() }
      function use(): number { return fallible()! }
    `);
    expect(lifted.diagnostics.filter((diagnostic) =>
      diagnostic.code === "SMITHERS1301" || diagnostic.code === "SMITHERS1302",
    )).toHaveLength(0);
  });

  test("discharges must-consume only through the ambient Promise combinators", () => {
    // Same defect as the shadowed Result namespace, at the Promise combinator
    // site. The `promisedType` test alone does not close it: a shadowing object
    // whose member is `async` returns a real Promise and satisfied it.
    //
    // Every source here carries an `export`, so it is a MODULE and the local
    // binding really shadows. In a global script a top-level `const Promise`
    // merges with the ambient declaration instead of shadowing it, which is a
    // TypeScript scoping rule rather than a Smithers one; a `.sm` file is
    // always a module.
    const shadowed = analyzeSource(`
      declare function work(): Promise<number>
      const Promise = { async all(values: readonly unknown[]) { return values } }
      export async function leak(): Promise<void> {
        const started = work()
        await Promise.all([started])
      }
    `);
    expect(shadowed.diagnostics.map((diagnostic) => diagnostic.code)).toContain("SMITHERS1403");

    const shadowedCall = analyzeSource(`
      declare function work(): Promise<number>
      const Promise = { async all(values: readonly unknown[]) { return values } }
      export async function leak(): Promise<void> {
        await Promise.all([work()])
      }
    `);
    expect(shadowedCall.diagnostics.map((diagnostic) => diagnostic.code)).toContain("SMITHERS1402");

    // Every ambient combinator this analyzer recognizes still discharges.
    const genuine = analyzeSource(`
      declare function work(): Promise<number>
      export async function all(): Promise<void> { await Promise.all([work(), work()]) }
      export async function allSettled(): Promise<void> { await Promise.allSettled([work()]) }
      export async function race(): Promise<void> { await Promise.race([work(), work()]) }
      export async function any(): Promise<void> { await Promise.any([work(), work()]) }
    `);
    expect(genuine.diagnostics.filter((diagnostic) =>
      diagnostic.code === "SMITHERS1402" || diagnostic.code === "SMITHERS1403",
    )).toHaveLength(0);
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
    expect(valid.code).toContain("smithers:examples/language/error-match.sm:Missing");
    expect(emittedErrors(valid.code, "error-match")).toHaveLength(0);

    const missing = analyzeSource(`
      class Missing extends Error {}; class Busy extends Error {}
      function bad(error: Missing | Busy) { return error.match({ Missing: () => "x" }) }
    `);
    expect(missing.diagnostics.some((diagnostic) =>
      diagnostic.code === "SMITHERS1253" && diagnostic.message.includes("Busy"),
    )).toBe(true);
  });

  test("rejects retired expression control-flow without rejecting ordinary labels", () => {
    const result = analyzeSource(`
      declare function value(): Result<number, Error>
      function assign(flag: boolean) { let x = 0; x = if (flag) { 1 } else { 2 }; return x }
      function complex(): Result<number, Error> { return 1 + value()! }
      function labeled(flag: boolean) { outer: while (flag) break outer }
    `);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code))
      .toEqual(expect.arrayContaining(["SMITHERS1001", "SMITHERS1204"]));
    // A labeled loop is an ordinary TypeScript statement and stays accepted.
    const labeledLine = result.diagnostics.filter((diagnostic) => diagnostic.line === 5);
    expect(labeledLine).toEqual([]);
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
          const value = next()!
          if (value > 0) throw new Failure()
          return value
        }
        for (let index = next()!; index < 2; index++) {
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
        while (next()!) {}
      }
    `);
    expect(unsupported.diagnostics.some((diagnostic) => diagnostic.code === "SMITHERS1703")).toBe(true);
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
    expect(result.code).toContain("__vsResultSuccess as __vsResultSuccess$smithers");
    expect(result.code).toContain("return __vsResultSuccess$smithers(1)");
    expect(emittedErrors(result.code, "helper-alias")).toHaveLength(0);
  });

  test("emits an embedded conservative token map and exposes a no-write checked API", () => {
    const options = {
      fileName: `${examples}/mapped.sm`,
      outputFileName: `${examples}/mapped.generated.ts`,
      sourceName: "examples/language/mapped.sm",
      runtimeImport: "../../src/runtime/index.ts",
    } as const;
    const source = `class E extends Error {}\nfunction value(): Result<number, E> { return 1 }\n`;
    const checked = compileAndCheckSmithers(source, options);
    expect(checked.ok).toBe(true);
    expect(checked.emitDiagnostics).toHaveLength(0);
    const map = JSON.parse(checked.result.sourceMap!) as { version: number; sources: string[]; sourcesContent: string[] };
    expect(map.version).toBe(3);
    expect(map.sources).toEqual(["examples/language/mapped.sm"]);
    expect(map.sourcesContent).toEqual([source]);
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
      diagnostic.code === "SMITHERS1104" && diagnostic.message.includes("Panic"),
    )).toBe(true);
    expect(analysis.diagnostics.some((diagnostic) => diagnostic.code === "SMITHERS1101")).toBe(true);

    const topLevel = analyzeSource(`
      declare function load(): Result<number, Error>
      const value = load().expect("required")
    `);
    expect(topLevel.diagnostics.some((diagnostic) =>
      diagnostic.code === "SMITHERS1505" && diagnostic.message.includes("expect"),
    )).toBe(true);
  });

  test("lowers Result.expect() into the checked Panic failure variant", async () => {
    const { result, module } = await executeCase(`
      class Missing extends Error {}
      function lookup(found: boolean): Result<string, Missing> {
        if (!found) throw new Missing("missing")
        return "value"
      }
      export function force(found: boolean): Result<string, Panic> {
        return lookup(found).expect("entry must exist")
      }
    `, "result-expect");
    expect(result.analysis.diagnostics).toHaveLength(0);
    expect(result.code).toContain("__vsInspectResult");
    expect(result.code).toContain("__vsPanicValue(new Error(__smithers_expect_message_");
    expect(result.code).not.toContain('.expect("entry must exist")');

    expect(__vsInspectResult(module.force(true))).toMatchObject({ ok: true, value: "value" });
    const failed = __vsInspectResult(module.force(false)) as { ok: false; error: Error };
    expect(failed.ok).toBe(false);
    expect(failed.error.name).toBe("Panic");
    expect(failed.error.message).toBe("Smithers panic: entry must exist");
    expect((failed.error.cause as Error).cause).toBeInstanceOf(module.Missing ?? Error);
  });

  test("fails closed on top-level throw statements and class static blocks", () => {
    const topThrow = analyzeSource(`
      class Broken extends Error {}
      throw new Broken()
      { throw new Broken() }
    `);
    expect(topThrow.diagnostics.filter((diagnostic) => diagnostic.code === "SMITHERS1511")).toHaveLength(2);

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
    expect(statics.diagnostics.filter((diagnostic) => diagnostic.code === "SMITHERS1107")).toHaveLength(2);

    const staticThrow = analyzeSource(`
      class Booted {
        static { throw new Error("boot") }
      }
    `);
    expect(staticThrow.diagnostics.filter((diagnostic) => diagnostic.code === "SMITHERS1107")).toHaveLength(1);
    expect(staticThrow.diagnostics.filter((diagnostic) => diagnostic.code === "SMITHERS1511")).toHaveLength(0);
  });

  test("fails closed when the internal parser diagnostics field is unavailable", () => {
    const sourceFile = ts.createSourceFile("probe.sm.ts", "const value = 1\n", ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    expect(internalParseDiagnostics(sourceFile)).toBeDefined();
    expect(parseDiagnosticsFailure(sourceFile)).toBeUndefined();
    delete (sourceFile as unknown as { parseDiagnostics?: unknown }).parseDiagnostics;
    expect(internalParseDiagnostics(sourceFile)).toBeUndefined();
    const failure = parseDiagnosticsFailure(sourceFile);
    expect(failure?.code).toBe("SMITHERS1002");
    expect(failure?.severity).toBe("error");
    expect(analyzeSource("const ok = 1\n").diagnostics.some((diagnostic) => diagnostic.code === "SMITHERS1002")).toBe(false);
  });

  test("treats smithers-prefixed package names as foreign, not compiler intrinsics", async () => {
    const directory = await mkdtemp(join(tmpdir(), "smithers-prefix-"));
    try {
      const packageDirectory = join(directory, "node_modules", "smithersutils");
      await mkdir(packageDirectory, { recursive: true });
      await writeFile(join(packageDirectory, "package.json"), JSON.stringify({
        name: "smithersutils",
        version: "1.0.0",
        types: "index.d.ts",
      }));
      await writeFile(join(packageDirectory, "index.d.ts"), [
        "/** @module @throws {never} */",
        "export declare function helper(value: string): number;",
        "",
      ].join("\n"));

      const source = `
        import { helper } from "smithersutils"
        function use(): Result<number, Panic> { return helper("x")! }
      `;
      const analysis = analyzeSource(source, { fileName: join(directory, "case.sm") });
      expect(analysis.diagnostics).toHaveLength(0);
      expect(analysis.rows.use).toEqual({ failures: ["Panic"], requirements: ["TypeScript"] });

      const compiled = compileSmithers(source, {
        fileName: join(directory, "case.sm"),
        outputFileName: join(directory, "case.generated.ts"),
        sourceName: "case.sm",
        runtimeImport: "../../src/runtime/index.ts",
      });
      expect(compiled.code).toContain("Result.try(() => helper(\"x\"))");

      for (const specifier of ["smthrs", "smthrs/contextual", "smthrs/provider/extra",
        "smithers:exceptions/extra", "smithers:unknown"]) {
        const prefixed = analyzeSource(`import { fake } from ${JSON.stringify(specifier)}\nexport const value = fake\n`, {
          fileName: join(directory, "prefixed.sm"),
        });
        expect(prefixed.diagnostics.some((diagnostic) => diagnostic.code === "SMITHERS1510"), specifier).toBe(true);
      }
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  test("fails closed on panic and Result postfix propagation inside a JavaScript try with a catch clause", () => {
    const analysis = analyzeSource(`
      import { panic } from "smithers:exceptions"
      class Missing extends Error {}
      declare function load(): Result<number, Missing>
      function caughtPanic(): Result<void, Panic> {
        try { panic("boom") } catch { return }
      }
      function caughtUnwrap(): Result<number, Missing> {
        try { return load()! } catch { return 0 }
      }
      function finallyOnly(): Result<number, Missing> {
        try { return load()! } finally { }
      }
      function nestedOwner(): Result<number, Missing> {
        try {
          const inner = (): Result<number, Missing> => load()!
          return inner()
        } catch { return 0 }
      }
    `);
    const catches = analysis.diagnostics.filter((diagnostic) => diagnostic.code === "SMITHERS1205");
    expect(catches).toHaveLength(2);
    expect(catches.map((diagnostic) => diagnostic.message.split(" ")[0])).toEqual([
      "panic(...)",
      "postfix",
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
    const checked = compileAndCheckSmithers(`
      class E extends Error {}
      function wrong(): Result<number, E> { return "not a number" }
    `, {
      fileName: `${examples}/invalid-output.sm`,
      outputFileName: `${examples}/invalid-output.generated.ts`,
      sourceName: "examples/language/invalid-output.sm",
      runtimeImport: "../../src/runtime/index.ts",
    });
    expect(checked.ok).toBe(false);
    expect(checked.emitDiagnostics.length).toBeGreaterThan(0);
  });
});
