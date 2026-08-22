import { describe, expect, test } from "bun:test";
import { analyzeProject } from "../language/index.ts";
import { analyzeCompatibility, analyzeCompatibilityProject } from "./index.ts";

/** Row of the same name from the reference frontend, for agreement checks. */
function frontendRequirements(source: string, fn: string): readonly string[] {
  const analysis = analyzeProject([{ fileName: "main.vibe", source }], { rootDir: "/vibe-agreement" });
  return analysis.files["main.vibe"]!.rows[fn]!.requirements;
}

describe("TypeScript/native portability requirements", () => {
  test("type-only imports erase while runtime boundaries propagate", () => {
    const result = analyzeCompatibility(`
      import type { User } from "./legacy-types";
      import { readFileSync } from "node:fs";
      function boundary(): any { return readFileSync("x") as any }
      function middle() { return boundary() }
      /** @native */
      function pinned() { return middle() }
    `);
    expect(result.functions.boundary.requirements).toEqual(['Module<"node:fs">', "TypeScript"]);
    expect(result.functions.middle.requirementPaths.TypeScript).toEqual(["middle", "boundary"]);
    expect(result.functions.pinned.requirementPaths.TypeScript).toEqual(["pinned", "middle", "boundary"]);
    expect(result.diagnostics.find((diagnostic) => diagnostic.code === "VIBE3001")?.message)
      .toContain("pinned -> middle -> boundary");
  });

  test("eval is allowed but visible and open dynamic features warn", () => {
    const result = analyzeCompatibility(`
      function dynamic(source: string) { const proxy = new Proxy({}, {}); return eval(source) }
    `);
    expect(result.functions.dynamic.requirements).toContain("TypeScript");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "VIBE3002")).toBe(true);
  });

  test("any in a public shape is visible even without an assertion in the body", () => {
    const result = analyzeCompatibility("function unsafe(input: any): string { return String(input) }");
    expect(result.functions.unsafe.requirements).toContain("TypeScript");
  });

  test("classifies constructor-style Function and side-effect runtime imports", () => {
    const dynamic = analyzeCompatibility(`
      /** @native */
      function pinned() { return new Function("return 1")() }
    `);
    expect(dynamic.functions.pinned.requirements).toContain("TypeScript");
    expect(dynamic.diagnostics.some((diagnostic) => diagnostic.code === "VIBE3001")).toBe(true);

    const sideEffect = analyzeCompatibility(`
      import "./legacy-runtime";
      /** @native */
      function pinned() { return 1 }
    `);
    expect(sideEffect.functions.pinned.requirements).toContain("TypeScript");
    expect(sideEffect.diagnostics.some((diagnostic) => diagnostic.code === "VIBE3001")).toBe(true);
  });

  test("does not classify shadowed bindings or property names as ambient requirements", () => {
    const result = analyzeCompatibility(`
      import { read } from "node:fs";
      function safe(read: number, value: { process: string; Proxy: string }) {
        const window = "local";
        return read + value.process.length + value.Proxy.length + window.length;
      }
      function boundary() { return read("x") }
    `);
    expect(result.functions.safe.requirements).toEqual([]);
    expect(result.functions.boundary.requirements).toEqual(['Module<"node:fs">']);
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "VIBE3002")).toBe(false);
  });

  test("uses checker symbols for lexical shadows and does not execute nested callable bodies", () => {
    const result = analyzeCompatibility(`
      function outer() {
        process.pid
        { const process = { pid: 1 }; void process.pid }
        const deferred = () => window.location
        return deferred
      }
    `);
    expect(result.functions.outer.requirements).toContain('Host<"process">');
    expect(result.functions.outer.requirements).not.toContain('Host<"window">');
  });

  test("records ambient Clock and Random authority and propagates it through calls", () => {
    const result = analyzeCompatibility(`
      function clock() { return Date.now() + performance.now() + new Date().getTime() }
      function random() { return Math.random() + crypto.randomUUID().length }
      function caller() { return clock() + random() }
      function deterministic() { return new Date(0).getTime() + Math.max(1, 2) }
      function shadowed(Date: { now(): number }, Math: { random(): number }) {
        return Date.now() + Math.random()
      }
    `);
    expect(result.functions.clock.requirements).toEqual(["Clock"]);
    expect(result.functions.random.requirements).toEqual(["Random"]);
    expect(result.functions.caller.requirements).toEqual(["Clock", "Random"]);
    expect(result.functions.caller.requirementPaths.Clock).toEqual(["caller", "clock"]);
    expect(result.functions.caller.requirementPaths.Random).toEqual(["caller", "random"]);
    expect(result.functions.deterministic.requirements).toEqual([]);
    expect(result.functions.shadowed.requirements).toEqual([]);
  });

  test("fails closed when ambient authority roots escape through aliases or destructuring", () => {
    const result = analyzeCompatibility(`
      function aliasedDate() { const DateAlias = Date; return DateAlias.now() }
      function destructuredMath() { const { random } = Math; return random() }
      function dynamicDate(member: string) { return Date[member]() }
      function cryptoHost() { return crypto.subtle }
      function deterministic() { return Date.parse("2020-01-01") + Date.UTC(2020, 0) + Math.abs(-1) }
    `);
    expect(result.functions.aliasedDate.requirements).toEqual(["Clock"]);
    expect(result.functions.destructuredMath.requirements).toEqual(["Random"]);
    expect(result.functions.dynamicDate.requirements).toEqual(["Clock"]);
    expect(result.functions.cryptoHost.requirements).toEqual(['Host<"crypto">']);
    expect(result.functions.deterministic.requirements).toEqual([]);
  });

  test("aligns alias, destructuring, computed, deterministic, and shadowed ambient authority", () => {
    const result = analyzeCompatibility(`
      function dateAlias() { const alias = Date; return alias }
      function mathAlias() { const alias = Math; return alias }
      function performanceAlias() { const alias = performance; return alias }
      function cryptoAlias() { const alias = crypto; return alias }
      function objectEscape() { return { Date, Math, performance, crypto } }
      function destructuredSensitive() {
        const { now } = Date
        const { random } = Math
        const { timeOrigin } = performance
        const { randomUUID, subtle } = crypto
        return [now, random, timeOrigin, randomUUID, subtle]
      }
      function computedSensitive(member: string) {
        return [Date[member], Math[member], performance[member], crypto[member]]
      }
      function deterministic() {
        const { parse, UTC } = Date
        const { abs, max, PI } = Math
        return parse("2020-01-01") + UTC(2020, 0) + new Date(0).getTime() +
          new Date("2020-01-01").getTime() + abs(-1) + max(1, 2) + PI
      }
      function shadowed(
        Date: { now(): number },
        Math: { random(): number },
        performance: { now(): number },
        crypto: { randomUUID(): string },
      ) {
        const alias = Date
        const { random } = Math
        return [alias.now(), random(), performance.now(), crypto.randomUUID()]
      }
    `);
    expect(result.functions.dateAlias.requirements).toEqual(["Clock"]);
    expect(result.functions.mathAlias.requirements).toEqual(["Random"]);
    expect(result.functions.performanceAlias.requirements).toEqual(["Clock"]);
    expect(result.functions.cryptoAlias.requirements).toEqual(['Host<"crypto">']);
    expect(result.functions.objectEscape.requirements)
      .toEqual(["Clock", 'Host<"crypto">', "Random"]);
    expect(result.functions.destructuredSensitive.requirements)
      .toEqual(["Clock", 'Host<"crypto">', "Random"]);
    expect(result.functions.computedSensitive.requirements)
      .toEqual(["Clock", 'Host<"crypto">', "Random"]);
    expect(result.functions.deterministic.requirements).toEqual([]);
    expect(result.functions.shadowed.requirements).toEqual([]);
  });

  test("propagates requirements through checked cross-module symbols", () => {
    const result = analyzeCompatibilityProject({
      "boundary.ts": `
        import { readFileSync } from "node:fs"
        export function boundary() { return readFileSync("value.txt", "utf8") }
      `,
      "main.ts": `
        import { boundary as load } from "./boundary.js"
        export function middle() { return load() }
        /** @native */
        export function pinned() { return middle() }
      `,
    });
    expect(result.functions["main.ts#middle"].requirements).toEqual(['Module<"node:fs">']);
    expect(result.functions["main.ts#pinned"].requirementPaths['Module<"node:fs">'])
      .toEqual(["main.ts#pinned", "main.ts#middle", "boundary.ts#boundary"]);
    expect(result.diagnostics.find((diagnostic) => diagnostic.code === "VIBE3001")?.message)
      .toContain("boundary.ts#boundary");
    expect(result.diagnostics.find((diagnostic) => diagnostic.code === "VIBE3001")?.file)
      .toBe("main.ts");
  });

  test("accepts authored .vibe module identities without losing checker edges", () => {
    const result = analyzeCompatibilityProject({
      "boundary.vibe": `
        export function boundary() { return process.pid }
      `,
      "main.vibe": `
        import { boundary } from "./boundary.vibe"
        /** @native */
        export function pinned() { return boundary() }
      `,
    });
    expect(result.functions["main.vibe#pinned"].requirementPaths['Host<"process">'])
      .toEqual(["main.vibe#pinned", "boundary.vibe#boundary"]);
    expect(result.diagnostics.find((diagnostic) => diagnostic.code === "VIBE3001"))
      .toMatchObject({ file: "main.vibe", severity: "error" });
  });
});

const CAPABILITY_MODULE = `
  import { Context } from "vibelang/context"
  export abstract class Config extends Context {
    abstract readonly retries: number
  }
`;

describe("nominal Context requirements", () => {
  test("records a nominal capability read that used to be reported as no requirement at all", () => {
    // Regression guard for the under-reporting gap: before the classifier had a
    // compiler-owned declaration for `vibelang/context`, `Config` resolved to
    // nothing and this row came back empty.
    const result = analyzeCompatibility(`
      import { Context } from "vibelang/context"
      abstract class Config extends Context {
        abstract readonly retries: number
      }
      export function readRetries(): number { return Config.context().retries }
    `);
    expect(result.functions.readRetries.requirements).toEqual(["Config"]);
    expect(result.functions.readRetries.requirementPaths.Config).toEqual(["readRetries"]);
    expect(result.diagnostics).toEqual([]);
  });

  test("accepts every canonical compiler-owned spelling without inventing a TypeScript edge", () => {
    const slash = analyzeCompatibility(`
      import { Context } from "vibelang/context"
      abstract class Config extends Context { abstract readonly retries: number }
      export function slashForm(): number { return Config.context().retries }
    `);
    expect(slash.functions.slashForm.requirements).toEqual(["Config"]);

    // `vibelang`, `vibelang/...` and `vibelang:...` are the only compiler-owned
    // forms; a package that merely starts with those letters is foreign code.
    const colon = analyzeCompatibility(`
      import { panic } from "vibelang:exceptions"
      import "vibelang"
      export function intrinsic(): never { return panic("x") }
    `);
    expect(colon.functions.intrinsic.requirements).toEqual([]);

    const lookalikePackage = analyzeCompatibility(`
      import { Context } from "vibelanguage/context"
      export function foreign(): unknown { return Context }
    `);
    expect(lookalikePackage.functions.foreign.requirements).toEqual(["TypeScript"]);
  });

  test("only the compiler-owned Context root confers capability authority", () => {
    const local = analyzeCompatibility(`
      abstract class Context {
        static context<C>(this: C): C { return this }
      }
      abstract class Config extends Context { abstract readonly retries: number }
      export function impostor(): unknown { return Config.context() }
    `);
    expect(local.functions.impostor.requirements).toEqual([]);

    // A lookalike from another package is foreign code: it never confers a
    // nominal capability row.
    const foreign = analyzeCompatibility(`
      import { Context } from "other-package/context"
      abstract class Config extends Context { abstract readonly retries: number }
      export function impostor(): unknown { return Config.context() }
      export function usesRoot(): unknown { return Context }
    `);
    expect(foreign.functions.impostor.requirements).toEqual([]);
    // Known, pre-existing and unrelated to capability authority: an import used
    // only by a top-level heritage clause belongs to no function body, so the
    // foreign edge is charged where a function actually reads the value.
    expect(foreign.functions.usesRoot.requirements).toEqual(["TypeScript"]);

    // A local class named `Context` shadowing the real import wins lexically,
    // and shadowing must lose the authority rather than inherit it.
    const shadowed = analyzeCompatibility(`
      import { Context as Root } from "vibelang/context"
      abstract class Context { static context(): Context { return new (class extends Context {})() } }
      abstract class Config extends Context { abstract readonly retries: number }
      abstract class Real extends Root { abstract readonly retries: number }
      export function impostor(): unknown { return Config.context() }
      export function genuine(): unknown { return Real.context() }
    `);
    expect(shadowed.functions.impostor.requirements).toEqual([]);
    expect(shadowed.functions.genuine.requirements).toEqual(["Real"]);
  });

  test("propagates nominal capabilities transitively with a retained dependency path", () => {
    const result = analyzeCompatibilityProject({
      "capabilities.vibe": CAPABILITY_MODULE,
      "leaf.vibe": `
        import { Config } from "./capabilities.vibe"
        export function leaf(): number { return Config.context().retries }
      `,
      "main.vibe": `
        import { leaf } from "./leaf.vibe"
        export function middle(): number { return leaf() }
        export function top(): number { return middle() + Date.now() }
      `,
    });
    expect(result.functions["leaf.vibe#leaf"].requirements).toEqual(["Config"]);
    expect(result.functions["main.vibe#middle"].requirements).toEqual(["Config"]);
    expect(result.functions["main.vibe#middle"].requirementPaths.Config)
      .toEqual(["main.vibe#middle", "leaf.vibe#leaf"]);
    expect(result.functions["main.vibe#top"].requirements).toEqual(["Clock", "Config"]);
    expect(result.functions["main.vibe#top"].requirementPaths.Config)
      .toEqual(["main.vibe#top", "main.vibe#middle", "leaf.vibe#leaf"]);
  });

  test("distinguishes colliding capability names by module, exactly as the frontend does", () => {
    const sources = {
      "left.vibe": `
        import { Context } from "vibelang/context"
        export abstract class Config extends Context { abstract readonly retries: number }
        export function left(): number { return Config.context().retries }
      `,
      "right.vibe": `
        import { Context } from "vibelang/context"
        export abstract class Config extends Context { abstract readonly timeout: number }
        export function right(): number { return Config.context().timeout }
      `,
    };
    const classifier = analyzeCompatibilityProject(sources);
    const frontend = analyzeProject(
      Object.entries(sources).map(([fileName, source]) => ({ fileName, source })),
      { rootDir: "/vibe-agreement" },
    );
    expect(classifier.functions["left.vibe#left"].requirements).toEqual(["Config@left"]);
    expect(classifier.functions["right.vibe#right"].requirements).toEqual(["Config@right"]);
    expect(classifier.functions["left.vibe#left"].requirements)
      .toEqual([...frontend.files["left.vibe"]!.rows.left!.requirements]);
    expect(classifier.functions["right.vibe#right"].requirements)
      .toEqual([...frontend.files["right.vibe"]!.rows.right!.requirements]);
  });

  test("a native pin rejects transitive TypeScript but reports a Context requirement", () => {
    // The spec makes `TypeScript` the requirement a native pin must reject. A
    // nominal capability is target-agnostic: it is satisfied by whichever layer
    // the native target provides, so it is reported, never rejected.
    const capabilityOnly = analyzeCompatibilityProject({
      "capabilities.vibe": CAPABILITY_MODULE,
      "main.vibe": `
        import { Config } from "./capabilities.vibe"
        export function reads(): number { return Config.context().retries }
        /** @native */
        export function pinned(): number { return reads() }
      `,
    });
    expect(capabilityOnly.functions["main.vibe#pinned"].nativePinned).toBe(true);
    expect(capabilityOnly.functions["main.vibe#pinned"].requirements).toEqual(["Config"]);
    expect(capabilityOnly.functions["main.vibe#pinned"].requirementPaths.Config)
      .toEqual(["main.vibe#pinned", "main.vibe#reads"]);
    expect(capabilityOnly.diagnostics.filter((diagnostic) => diagnostic.code === "VIBE3001"))
      .toEqual([]);

    const alsoTypeScript = analyzeCompatibilityProject({
      "capabilities.vibe": CAPABILITY_MODULE,
      "main.vibe": `
        import { Config } from "./capabilities.vibe"
        import { readFileSync } from "node:fs"
        export function reads(): number { return Config.context().retries }
        export function host(): unknown { return readFileSync("x") as any }
        /** @native */
        export function pinned(): number { host(); return reads() }
      `,
    });
    const pinDiagnostics = alsoTypeScript.diagnostics
      .filter((diagnostic) => diagnostic.code === "VIBE3001");
    expect(alsoTypeScript.functions["main.vibe#pinned"].requirements)
      .toEqual(['Module<"node:fs">', "Config", "TypeScript"].sort());
    // Every blocking requirement is reported, each with its dependency path,
    // and the reported set never includes the nominal capability.
    expect(pinDiagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      'native pin failed: Module<"node:fs"> is required through main.vibe#pinned -> main.vibe#host',
      "native pin failed: TypeScript is required through main.vibe#pinned -> main.vibe#host",
    ]);
    expect(pinDiagnostics.every((diagnostic) => !diagnostic.message.includes("Config"))).toBe(true);
  });

  test("agrees with the language frontend row for single-module capability shapes", () => {
    const direct = `
      import { Context } from "vibelang/context"
      abstract class Config extends Context { abstract readonly retries: number }
      export function readRetries(): number { return Config.context().retries }
      export function caller(): number { return readRetries() + 1 }
    `;
    expect(analyzeCompatibility(direct).functions.readRetries.requirements)
      .toEqual([...frontendRequirements(direct, "readRetries")]);
    expect(analyzeCompatibility(direct).functions.caller.requirements)
      .toEqual([...frontendRequirements(direct, "caller")]);

    const renamedRoot = `
      import { Context as Root } from "vibelang/context"
      abstract class Config extends Root { abstract readonly retries: number }
      export function readRetries(): number { return Config.context().retries }
    `;
    expect(analyzeCompatibility(renamedRoot).functions.readRetries.requirements)
      .toEqual([...frontendRequirements(renamedRoot, "readRetries")]);
    expect(analyzeCompatibility(renamedRoot).functions.readRetries.requirements).toEqual(["Config"]);

    const inherited = `
      import { Context } from "vibelang/context"
      abstract class Base extends Context { abstract readonly base: number }
      abstract class Derived extends Base { abstract readonly extra: number }
      export function chained(): number { return Derived.context().extra }
    `;
    expect(analyzeCompatibility(inherited).functions.chained.requirements)
      .toEqual([...frontendRequirements(inherited, "chained")]);
    expect(analyzeCompatibility(inherited).functions.chained.requirements).toEqual(["Derived"]);

    const shadowedLocal = `
      import { Context } from "vibelang/context"
      abstract class Config extends Context { abstract readonly retries: number }
      export function shadow(): number {
        const Config = { context(): { retries: number } { return { retries: 0 } } }
        return Config.context().retries
      }
    `;
    expect(analyzeCompatibility(shadowedLocal).functions.shadow.requirements)
      .toEqual([...frontendRequirements(shadowedLocal, "shadow")]);
    expect(analyzeCompatibility(shadowedLocal).functions.shadow.requirements).toEqual([]);
  });

  test("agrees with the language frontend row across module boundaries", () => {
    const sources = {
      "capabilities.vibe": CAPABILITY_MODULE,
      "aliased.vibe": `
        import { Config as Settings } from "./capabilities.vibe"
        export function aliased(): number { return Settings.context().retries }
      `,
      "namespaced.vibe": `
        import * as capabilities from "./capabilities.vibe"
        export function namespaced(): number { return capabilities.Config.context().retries }
      `,
      "transitive.vibe": `
        import { aliased } from "./aliased.vibe"
        import { namespaced } from "./namespaced.vibe"
        export function transitive(): number { return aliased() + namespaced() }
      `,
    };
    const classifier = analyzeCompatibilityProject(sources);
    const frontend = analyzeProject(
      Object.entries(sources).map(([fileName, source]) => ({ fileName, source })),
      { rootDir: "/vibe-agreement" },
    );
    for (const [file, fn] of [
      ["aliased.vibe", "aliased"],
      ["namespaced.vibe", "namespaced"],
      ["transitive.vibe", "transitive"],
    ] as const) {
      expect(classifier.functions[`${file}#${fn}`].requirements)
        .toEqual([...frontend.files[file]!.rows[fn]!.requirements]);
      expect(classifier.functions[`${file}#${fn}`].requirements).toEqual(["Config"]);
    }
  });

  test("documents where the classifier row legitimately diverges from the frontend row", () => {
    // 1. Ambient authority. The frontend REJECTS ambient clock/entropy in
    //    authored `.vibe` (VIBE1602/VIBE1603) and leaves the row empty; the
    //    target classifier is a portability report over already-accepted code,
    //    so it classifies the same use as a `Clock`/`Random` requirement.
    const ambient = `
      export function now(): number { return Date.now() + Math.random() }
    `;
    expect(analyzeCompatibility(ambient).functions.now.requirements).toEqual(["Clock", "Random"]);
    expect(frontendRequirements(ambient, "now")).toEqual([]);
    const ambientDiagnostics = analyzeProject(
      [{ fileName: "main.vibe", source: ambient }],
      { rootDir: "/vibe-agreement" },
    ).diagnostics.map((diagnostic) => diagnostic.code);
    expect(ambientDiagnostics).toContain("VIBE1602");
    expect(ambientDiagnostics).toContain("VIBE1603");

    // 2. Layer satisfaction. The frontend models `Layer.provide` and subtracts
    //    the provided capability; the classifier never descends into a nested
    //    callable, so it reports nothing at the provide site instead. Both
    //    agree that the enclosing function requires nothing, but only the
    //    frontend would have caught an UNSATISFIED requirement there.
    const provided = `
      import { Context } from "vibelang/context"
      import { Layer } from "vibelang/provider"
      abstract class Config extends Context { abstract readonly retries: number }
      export function scoped(): number {
        const layer = Layer.succeed(Config, { retries: 1 })
        return Layer.provide(layer, () => Config.context().retries)
      }
    `;
    expect(analyzeCompatibility(provided).functions.scoped.requirements).toEqual([]);
    expect(frontendRequirements(provided, "scoped")).toEqual([]);
  });

  test("pins the call-graph shapes where the classifier still under-reports", () => {
    // These are NOT legitimate divergences: the classifier's propagation only
    // follows a call whose callee identifier resolves to an analyzed function
    // declaration, so an indirect call through a value binding and a call to an
    // object-literal method both lose the row the frontend keeps. Recorded here
    // so the gap is visible instead of silent.
    const indirect = `
      import { Context } from "vibelang/context"
      abstract class Config extends Context { abstract readonly retries: number }
      export function reads(): number { return Config.context().retries }
      export function indirect(): number { const alias = reads; return alias() }
    `;
    expect(analyzeCompatibility(indirect).functions.reads.requirements).toEqual(["Config"]);
    expect(analyzeCompatibility(indirect).functions.indirect.requirements).toEqual([]);
    expect(frontendRequirements(indirect, "indirect")).toEqual(["Config"]);

    const method = `
      import { Context } from "vibelang/context"
      abstract class Config extends Context { abstract readonly retries: number }
      export const holder = { read(): number { return Config.context().retries } }
      export function callsMethod(): number { return holder.read() }
    `;
    expect(analyzeCompatibility(method).functions.callsMethod.requirements).toEqual([]);
    expect(frontendRequirements(method, "callsMethod")).toEqual(["Config"]);

    // A generic capability receiver is under-reported by BOTH analyzers: the
    // receiver's symbol is a type parameter, not a Context class declaration.
    const generic = `
      import { Context } from "vibelang/context"
      abstract class Config extends Context { abstract readonly retries: number }
      function viaGeneric<C extends typeof Config>(capability: C): number {
        return capability.context().retries
      }
      export function generic(): number { return viaGeneric(Config) }
    `;
    expect(analyzeCompatibility(generic).functions.generic.requirements).toEqual([]);
    expect(frontendRequirements(generic, "generic")).toEqual([]);
  });
});
