import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AssetCompiler } from "../build/assets.ts";
import { compileSourceAssetModules } from "../build/source-assets.ts";
import { analyzeProject, compileProject } from "../language/index.ts";
import { analyzeCompatibility, analyzeCompatibilityProject } from "./index.ts";

// FAILS OPEN, measured, and RE-MEASURED reproduction by reproduction: a call has
// no visible body AND no value the analyzer can follow to one. The members, each
// with the reason it stays, are in the header of `classify.ts`; in short:
// `[1].map(cb)`, `cbs.forEach(cb => cb())`, a host `Map`/`Set`, and a
// `declare const` with no literal anywhere are the shapes where neither question
// has an answer — the body that would run the callback belongs to a declaration
// file, and giving it one means the host-knowledge table this file refuses. An
// element read by a NON-LITERAL index stays because exactly ONE element runs and
// the analyzer cannot say which, so charging all of them would be a different
// rule rather than a wider one. A SPREAD whose source is not a list stays
// because nothing decides how many values it contributes. A SETTER stays because
// only the get accessor a property READ runs is owned, and an object spread's
// evaluation of the source's GETTERS is not modelled. Closed and asserted below:
// a class instance, a call result, an array element, a rest parameter, a
// destructured parameter, a tagged template, a GETTER through an instance, a
// SPREAD argument, a rest parameter iterated with `for…of`, an OBJECT SPREAD,
// and a factory with more than one return — each in a body and at module level.
test.todo("classifier limitation: a call with no visible body and no value to follow enters nothing", () => {});
// FAILS OPEN, measured and RE-MEASURED twice since: `import "./a.sm"` where
// `a.sm` runs `export const contents = readFileSync("x")` charges nobody, and
// neither does a bare `void process.pid` statement in an evaluated module, an
// unread laundering `const` in the pinned function's own module, nor an unread
// `export const seed = run(() => process.pid)`. A binding that IS read is
// charged — the last of those charges the moment anybody reads `seed`, and that
// is asserted below; the effect of a statement nobody reads needs a purity
// judgement the specification does not make.
test.todo("classifier limitation: module-level statements beyond imports are not analyzed", () => {});
// Measured, RE-MEASURED after classes became followable values, and RE-MEASURED
// again after values became multi-valued: `[]` where the concrete receiver
// reports `["Config"]`. The lost row is a nominal capability, which does not
// block a pin, so this entry does NOT fail open. Its old reason — "a CLASS
// reaching a parameter is neither a callable nor an object literal" — was false
// and is corrected in the header; the corrected one still holds: the row comes
// from reading the RECEIVER'S TYPE rather than from entering anything, and a
// generic receiver's type is the type parameter whatever value flows into it.
test.todo("classifier limitation: generic capability receivers under-report nominal Context requirements", () => {});

/** Row of the same name from the reference frontend, for agreement checks. */
function frontendRequirements(source: string, fn: string): readonly string[] {
  const analysis = analyzeProject([{ fileName: "main.sm", source }], { rootDir: "/smithers-agreement" });
  return analysis.files["main.sm"]!.rows[fn]!.requirements;
}

describe("TypeScript/native portability requirements", () => {
  test("type-only imports erase while runtime boundaries propagate", () => {
    const result = analyzeCompatibility(`
      import type { User } from "./legacy-types";
      import { readFileSync } from "node:fs";
      import { native } from "smithers:native";
      function boundary(): any { return readFileSync("x") as any }
      function middle() { return boundary() }
      function pinned() { return middle() }
      native(pinned);
    `);
    expect(result.functions.boundary.requirements).toEqual(['Module<"node:fs">', "TypeScript"]);
    expect(result.functions.middle.requirementPaths.TypeScript).toEqual(["middle", "boundary"]);
    expect(result.functions.pinned.requirementPaths.TypeScript).toEqual(["pinned", "middle", "boundary"]);
    expect(result.diagnostics.find((diagnostic) => diagnostic.code === "SMITHERS3001")?.message)
      .toContain("pinned -> middle -> boundary");
  });

  test("eval is allowed but visible and open dynamic features warn", () => {
    const result = analyzeCompatibility(`
      function dynamic(source: string) { const proxy = new Proxy({}, {}); return eval(source) }
    `);
    expect(result.functions.dynamic.requirements).toContain("TypeScript");
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "SMITHERS3002")).toBe(true);
  });

  test("any in a public shape is visible even without an assertion in the body", () => {
    const result = analyzeCompatibility("function unsafe(input: any): string { return String(input) }");
    expect(result.functions.unsafe.requirements).toContain("TypeScript");
  });

  test("classifies constructor-style Function and side-effect runtime imports", () => {
    const dynamic = analyzeCompatibility(`
      import { native } from "smithers:native";
      function pinned() { return new Function("return 1")() }
      native(pinned);
    `);
    expect(dynamic.functions.pinned.requirements).toContain("TypeScript");
    expect(dynamic.diagnostics.some((diagnostic) => diagnostic.code === "SMITHERS3001")).toBe(true);

    const sideEffect = analyzeCompatibility(`
      import "./legacy-runtime";
      import { native } from "smithers:native";
      function pinned() { return 1 }
      native(pinned);
    `);
    expect(sideEffect.functions.pinned.requirements).toContain("TypeScript");
    expect(sideEffect.diagnostics.some((diagnostic) => diagnostic.code === "SMITHERS3001")).toBe(true);
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
    expect(result.diagnostics.some((diagnostic) => diagnostic.code === "SMITHERS3002")).toBe(false);
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
        import { native } from "smithers:native"
        export function middle() { return load() }
        export function pinned() { return middle() }
        native(pinned)
      `,
    });
    expect(result.functions["main.ts#middle"].requirements).toEqual(['Module<"node:fs">']);
    expect(result.functions["main.ts#pinned"].requirementPaths['Module<"node:fs">'])
      .toEqual(["main.ts#pinned", "main.ts#middle", "boundary.ts#boundary"]);
    expect(result.diagnostics.find((diagnostic) => diagnostic.code === "SMITHERS3001")?.message)
      .toContain("boundary.ts#boundary");
    expect(result.diagnostics.find((diagnostic) => diagnostic.code === "SMITHERS3001")?.file)
      .toBe("main.ts");
  });

  test("accepts authored .sm module identities without losing checker edges", () => {
    const result = analyzeCompatibilityProject({
      "boundary.sm": `
        export function boundary() { return process.pid }
      `,
      "main.sm": `
        import { boundary } from "./boundary.sm"
        import { native } from "smithers:native"
        export function pinned() { return boundary() }
        native(pinned)
      `,
    });
    expect(result.functions["main.sm#pinned"].requirementPaths['Host<"process">'])
      .toEqual(["main.sm#pinned", "boundary.sm#boundary"]);
    expect(result.diagnostics.find((diagnostic) => diagnostic.code === "SMITHERS3001"))
      .toMatchObject({ file: "main.sm", severity: "error" });
  });
});

/**
 * The pin spelling itself. PROVISIONAL: `docs/DECISIONS.md` still lists "Exact
 * spelling for the native pin is undecided", so these cases pin the proposal —
 * an imported compiler intrinsic recognized by its resolved binding, exactly
 * the shape the locked `comptime` entry already mandates — not a closed
 * decision.
 */
describe("the native pin spelling", () => {
  const PINNED = `
    function checksum(input: string): number { return input.length }
  `;

  test("recognizes the pin through the resolved binding, never through its local spelling", () => {
    const direct = analyzeCompatibility(`
      import { native } from "smithers:native"
      ${PINNED}
      native(checksum)
    `);
    const renamed = analyzeCompatibility(`
      import { native as pin } from "smithers:native"
      ${PINNED}
      pin(checksum)
    `);
    const namespaced = analyzeCompatibility(`
      import * as compiler from "smithers:native"
      ${PINNED}
      compiler.native(checksum)
    `);
    for (const result of [direct, renamed, namespaced]) {
      expect(result.functions.checksum.nativePinned).toBe(true);
      expect(result.diagnostics).toEqual([]);
    }
  });

  test("an unrelated local function named native is never granted compiler authority", () => {
    // The counterpart of the locked comptime rule: authority comes from the
    // symbol, so the name alone confers nothing and the local call is ordinary.
    const local = analyzeCompatibility(`
      function native<F>(pinned: F): F { return pinned }
      function host(): unknown { return process.pid }
      ${PINNED}
      native(checksum)
      native(host)
    `);
    expect(local.functions.checksum.nativePinned).toBe(false);
    expect(local.functions.host.nativePinned).toBe(false);
    expect(local.diagnostics.filter((diagnostic) => diagnostic.code === "SMITHERS3001")).toEqual([]);
    expect(local.diagnostics.filter((diagnostic) => diagnostic.code === "SMITHERS3005")).toEqual([]);

    // Same spelling, same shape, imported from an ordinary package: a foreign
    // `native` is foreign code, not the compiler.
    const foreign = analyzeCompatibility(`
      import { native } from "native-pin-lookalike"
      ${PINNED}
      native(checksum)
    `);
    expect(foreign.functions.checksum.nativePinned).toBe(false);
  });

  test("a clean graph pins without a diagnostic and the pin is reported on the row", () => {
    const result = analyzeCompatibility(`
      import { native } from "smithers:native"
      function digest(input: string): number { return input.length * 31 }
      function checksum(input: string): number { return digest(input) + 1 }
      native(checksum)
    `);
    expect(result.functions.checksum.nativePinned).toBe(true);
    expect(result.functions.checksum.requirements).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  test("a pin the analyzer cannot attribute is rejected rather than silently accepted", () => {
    const anonymous = analyzeCompatibility(`
      import { native } from "smithers:native"
      native(function () { return process.pid })
    `);
    expect(anonymous.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["SMITHERS3005"]);

    const imported = analyzeCompatibility(`
      import { native } from "smithers:native"
      import { readFileSync } from "node:fs"
      native(readFileSync)
    `);
    expect(imported.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["SMITHERS3005"]);
  });

  test("the retired POC marker no longer pins and says so", () => {
    const result = analyzeCompatibility(`
      /** @native */
      function pinned() { return process.pid }
    `);
    expect(result.functions.pinned.nativePinned).toBe(false);
    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === "SMITHERS3001")).toEqual([]);
    const migration = result.diagnostics.find((diagnostic) => diagnostic.code === "SMITHERS3006");
    expect(migration).toMatchObject({ severity: "warning", line: 2 });
    expect(migration?.message).toContain(`import { native } from "smithers:native"`);
  });

  test("the pin diagnostic is reported at the assertion, with every hop of the path", () => {
    // The specification asks the diagnostic to show the dependency path. The
    // interesting case is a blocking requirement several calls away: the path
    // must name each hop, not just the endpoints.
    const result = analyzeCompatibilityProject({
      "leaf.sm": `
        import { readFileSync } from "node:fs"
        export function leaf(): string { return readFileSync("x", "utf8") }
      `,
      "middle.sm": `
        import { leaf } from "./leaf.sm"
        export function middle(): string { return leaf() }
      `,
      "main.sm": `
        import { middle } from "./middle.sm"
        import { native } from "smithers:native"
        export function inner(): string { return middle() }
        export function pinned(): string { return inner() }
        native(pinned)
      `,
    });
    const failure = result.diagnostics.find((diagnostic) => diagnostic.code === "SMITHERS3001");
    expect(failure?.message).toBe(
      'native pin failed: Module<"node:fs"> is required through ' +
        "main.sm#pinned -> main.sm#inner -> middle.sm#middle -> leaf.sm#leaf",
    );
    // The assertion is what failed, so the diagnostic sits on the `native(...)`
    // call rather than on the declaration it names.
    expect(failure).toMatchObject({ file: "main.sm", line: 6, column: 9, severity: "error" });
  });

  test("a pin written in another module reports against that module's assertion", () => {
    const result = analyzeCompatibilityProject({
      "worker.sm": `
        export function work(): unknown { return process.pid }
      `,
      "pins.sm": `
        import { work } from "./worker.sm"
        import { native } from "smithers:native"
        native(work)
      `,
    });
    expect(result.functions["worker.sm#work"].nativePinned).toBe(true);
    expect(result.diagnostics.find((diagnostic) => diagnostic.code === "SMITHERS3001"))
      .toMatchObject({ file: "pins.sm", line: 4, severity: "error" });
  });
});

const CAPABILITY_MODULE = `
  import { Context } from "smthrs/context"
  export abstract class Config extends Context {
    abstract readonly retries: number
  }
`;

describe("nominal Context requirements", () => {
  test("records a nominal capability read that used to be reported as no requirement at all", () => {
    // Regression guard for the under-reporting gap: before the classifier had a
    // compiler-owned declaration for `smthrs/context`, `Config` resolved to
    // nothing and this row came back empty.
    const result = analyzeCompatibility(`
      import { Context } from "smthrs/context"
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
      import { Context } from "smthrs/context"
      abstract class Config extends Context { abstract readonly retries: number }
      export function slashForm(): number { return Config.context().retries }
    `);
    expect(slash.functions.slashForm.requirements).toEqual(["Config"]);

    const colon = analyzeCompatibility(`
      import { panic } from "smithers:exceptions"
      export function intrinsic(): never { return panic("x") }
    `);
    expect(colon.functions.intrinsic.requirements).toEqual([]);

    const lookalikePackage = analyzeCompatibility(`
      import { Context } from "smitherslanguage/context"
      export function foreign(): unknown { return Context }
    `);
    expect(lookalikePackage.functions.foreign.requirements).toEqual(["TypeScript"]);

    // Membership in the compiler-owned registry is exact, matching
    // COMPILER_INTRINSIC_SPECIFIERS in the frontend. A colon specifier the
    // compiler does not own, and the bare `smthrs` spelling the frontend
    // registry does not carry, are foreign code: they contribute `TypeScript`
    // rather than vanishing from the row a native pin is asserted over.
    const unownedColon = analyzeCompatibility(`
      import "smithers:not-a-real-intrinsic"
      export function sideEffect(): number { return 1 }
    `);
    expect(unownedColon.functions.sideEffect.requirements).toEqual(["TypeScript"]);

    const bare = analyzeCompatibility(`
      import "smthrs"
      export function sideEffect(): number { return 1 }
    `);
    expect(bare.functions.sideEffect.requirements).toEqual(["TypeScript"]);
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
      import { Context as Root } from "smthrs/context"
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
      "capabilities.sm": CAPABILITY_MODULE,
      "leaf.sm": `
        import { Config } from "./capabilities.sm"
        export function leaf(): number { return Config.context().retries }
      `,
      "main.sm": `
        import { leaf } from "./leaf.sm"
        export function middle(): number { return leaf() }
        export function top(): number { return middle() + Date.now() }
      `,
    });
    expect(result.functions["leaf.sm#leaf"].requirements).toEqual(["Config"]);
    expect(result.functions["main.sm#middle"].requirements).toEqual(["Config"]);
    expect(result.functions["main.sm#middle"].requirementPaths.Config)
      .toEqual(["main.sm#middle", "leaf.sm#leaf"]);
    expect(result.functions["main.sm#top"].requirements).toEqual(["Clock", "Config"]);
    expect(result.functions["main.sm#top"].requirementPaths.Config)
      .toEqual(["main.sm#top", "main.sm#middle", "leaf.sm#leaf"]);
  });

  test("distinguishes colliding capability names by module, exactly as the frontend does", () => {
    const sources = {
      "left.sm": `
        import { Context } from "smthrs/context"
        export abstract class Config extends Context { abstract readonly retries: number }
        export function left(): number { return Config.context().retries }
      `,
      "right.sm": `
        import { Context } from "smthrs/context"
        export abstract class Config extends Context { abstract readonly timeout: number }
        export function right(): number { return Config.context().timeout }
      `,
    };
    const classifier = analyzeCompatibilityProject(sources);
    const frontend = analyzeProject(
      Object.entries(sources).map(([fileName, source]) => ({ fileName, source })),
      { rootDir: "/smithers-agreement" },
    );
    expect(classifier.functions["left.sm#left"].requirements).toEqual(["Config@left"]);
    expect(classifier.functions["right.sm#right"].requirements).toEqual(["Config@right"]);
    expect(classifier.functions["left.sm#left"].requirements)
      .toEqual([...frontend.files["left.sm"]!.rows.left!.requirements]);
    expect(classifier.functions["right.sm#right"].requirements)
      .toEqual([...frontend.files["right.sm"]!.rows.right!.requirements]);
  });

  test("a native pin rejects transitive TypeScript but reports a Context requirement", () => {
    // The spec makes `TypeScript` the requirement a native pin must reject. A
    // nominal capability is target-agnostic: it is satisfied by whichever layer
    // the native target provides, so it is reported, never rejected.
    const capabilityOnly = analyzeCompatibilityProject({
      "capabilities.sm": CAPABILITY_MODULE,
      "main.sm": `
        import { Config } from "./capabilities.sm"
        import { native } from "smithers:native"
        export function reads(): number { return Config.context().retries }
        export function pinned(): number { return reads() }
        native(pinned)
      `,
    });
    expect(capabilityOnly.functions["main.sm#pinned"].nativePinned).toBe(true);
    expect(capabilityOnly.functions["main.sm#pinned"].requirements).toEqual(["Config"]);
    expect(capabilityOnly.functions["main.sm#pinned"].requirementPaths.Config)
      .toEqual(["main.sm#pinned", "main.sm#reads"]);
    expect(capabilityOnly.diagnostics.filter((diagnostic) => diagnostic.code === "SMITHERS3001"))
      .toEqual([]);

    const alsoTypeScript = analyzeCompatibilityProject({
      "capabilities.sm": CAPABILITY_MODULE,
      "main.sm": `
        import { Config } from "./capabilities.sm"
        import { readFileSync } from "node:fs"
        import { native } from "smithers:native"
        export function reads(): number { return Config.context().retries }
        export function host(): unknown { return readFileSync("x") as any }
        export function pinned(): number { host(); return reads() }
        native(pinned)
      `,
    });
    const pinDiagnostics = alsoTypeScript.diagnostics
      .filter((diagnostic) => diagnostic.code === "SMITHERS3001");
    expect(alsoTypeScript.functions["main.sm#pinned"].requirements)
      .toEqual(['Module<"node:fs">', "Config", "TypeScript"].sort());
    // Every blocking requirement is reported, each with its dependency path,
    // and the reported set never includes the nominal capability.
    expect(pinDiagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      'native pin failed: Module<"node:fs"> is required through main.sm#pinned -> main.sm#host',
      "native pin failed: TypeScript is required through main.sm#pinned -> main.sm#host",
    ]);
    expect(pinDiagnostics.every((diagnostic) => !diagnostic.message.includes("Config"))).toBe(true);
  });

  test("agrees with the language frontend row for single-module capability shapes", () => {
    const direct = `
      import { Context } from "smthrs/context"
      abstract class Config extends Context { abstract readonly retries: number }
      export function readRetries(): number { return Config.context().retries }
      export function caller(): number { return readRetries() + 1 }
    `;
    expect(analyzeCompatibility(direct).functions.readRetries.requirements)
      .toEqual([...frontendRequirements(direct, "readRetries")]);
    expect(analyzeCompatibility(direct).functions.caller.requirements)
      .toEqual([...frontendRequirements(direct, "caller")]);

    const renamedRoot = `
      import { Context as Root } from "smthrs/context"
      abstract class Config extends Root { abstract readonly retries: number }
      export function readRetries(): number { return Config.context().retries }
    `;
    expect(analyzeCompatibility(renamedRoot).functions.readRetries.requirements)
      .toEqual([...frontendRequirements(renamedRoot, "readRetries")]);
    expect(analyzeCompatibility(renamedRoot).functions.readRetries.requirements).toEqual(["Config"]);

    const inherited = `
      import { Context } from "smthrs/context"
      abstract class Base extends Context { abstract readonly base: number }
      abstract class Derived extends Base { abstract readonly extra: number }
      export function chained(): number { return Derived.context().extra }
    `;
    expect(analyzeCompatibility(inherited).functions.chained.requirements)
      .toEqual([...frontendRequirements(inherited, "chained")]);
    expect(analyzeCompatibility(inherited).functions.chained.requirements).toEqual(["Derived"]);

    const shadowedLocal = `
      import { Context } from "smthrs/context"
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
      "capabilities.sm": CAPABILITY_MODULE,
      "aliased.sm": `
        import { Config as Settings } from "./capabilities.sm"
        export function aliased(): number { return Settings.context().retries }
      `,
      "namespaced.sm": `
        import * as capabilities from "./capabilities.sm"
        export function namespaced(): number { return capabilities.Config.context().retries }
      `,
      "transitive.sm": `
        import { aliased } from "./aliased.sm"
        import { namespaced } from "./namespaced.sm"
        export function transitive(): number { return aliased() + namespaced() }
      `,
    };
    const classifier = analyzeCompatibilityProject(sources);
    const frontend = analyzeProject(
      Object.entries(sources).map(([fileName, source]) => ({ fileName, source })),
      { rootDir: "/smithers-agreement" },
    );
    for (const [file, fn] of [
      ["aliased.sm", "aliased"],
      ["namespaced.sm", "namespaced"],
      ["transitive.sm", "transitive"],
    ] as const) {
      expect(classifier.functions[`${file}#${fn}`].requirements)
        .toEqual([...frontend.files[file]!.rows[fn]!.requirements]);
      expect(classifier.functions[`${file}#${fn}`].requirements).toEqual(["Config"]);
    }
  });

  test("documents where the classifier row legitimately diverges from the frontend row", () => {
    // 1. Ambient authority. The frontend REJECTS ambient clock/entropy in
    //    authored `.sm` (SMITHERS1602/SMITHERS1603) and leaves the row empty; the
    //    target classifier is a portability report over already-accepted code,
    //    so it classifies the same use as a `Clock`/`Random` requirement.
    const ambient = `
      export function now(): number { return Date.now() + Math.random() }
    `;
    expect(analyzeCompatibility(ambient).functions.now.requirements).toEqual(["Clock", "Random"]);
    expect(frontendRequirements(ambient, "now")).toEqual([]);
    const ambientDiagnostics = analyzeProject(
      [{ fileName: "main.sm", source: ambient }],
      { rootDir: "/smithers-agreement" },
    ).diagnostics.map((diagnostic) => diagnostic.code);
    expect(ambientDiagnostics).toContain("SMITHERS1602");
    expect(ambientDiagnostics).toContain("SMITHERS1603");

    // 2. Layer satisfaction is NO LONGER a divergence, legitimate or otherwise.
    //    This entry used to say the classifier "never descends into a nested
    //    callable, so it reports nothing at the provide site instead", and
    //    noted that "only the frontend would have caught an UNSATISFIED
    //    requirement there". That was a fail-open recorded as a divergence: the
    //    empty row below was right by accident, because the callback was
    //    skipped, and the same skip granted a native pin over
    //    `Layer.provide(layer, () => process.pid)`. The classifier now
    //    recognizes the compiler-owned `Layer` the way the frontend does and
    //    subtracts what the layer provides, so the empty row is a PROVED
    //    subtraction — and the unsatisfied case below agrees too.
    const provided = `
      import { Context } from "smthrs/context"
      import { Layer } from "smthrs/provider"
      abstract class Config extends Context { abstract readonly retries: number }
      export function scoped(): number {
        const layer = Layer.succeed(Config, { retries: 1 })
        return Layer.provide(layer, () => Config.context().retries)
      }
    `;
    expect(analyzeCompatibility(provided).functions.scoped.requirements).toEqual([]);
    expect(frontendRequirements(provided, "scoped")).toEqual([]);

    const unsatisfied = `
      import { Context } from "smthrs/context"
      import { Layer } from "smthrs/provider"
      abstract class Config extends Context { abstract readonly retries: number }
      abstract class Other extends Context { abstract readonly n: number }
      export function scoped(): number {
        const layer = Layer.succeed(Config, { retries: 1 })
        return Layer.provide(layer, () => Other.context().n)
      }
    `;
    expect(analyzeCompatibility(unsatisfied).functions.scoped.requirements).toEqual(["Other"]);
    expect(frontendRequirements(unsatisfied, "scoped")).toEqual(["Other"]);
  });

  test("the call-graph shapes that used to under-report now agree with the frontend", () => {
    // These were NEVER legitimate divergences, and this test recorded them as a
    // visible gap until the classifier resolved a callee the way the frontend
    // does. Propagation used to need a callee IDENTIFIER whose symbol was an
    // analyzed function declaration, so an indirect call through a value binding
    // and a call to an object-literal method each lost the row the frontend
    // kept. Both now resolve through `checker.getResolvedSignature`, which is
    // what `resolveLocalCallee` in `src/language/semantic.ts` asks first — so the
    // two rows agree by construction rather than by two tables agreeing.
    const indirect = `
      import { Context } from "smthrs/context"
      abstract class Config extends Context { abstract readonly retries: number }
      export function reads(): number { return Config.context().retries }
      export function indirect(): number { const alias = reads; return alias() }
    `;
    expect(analyzeCompatibility(indirect).functions.reads.requirements).toEqual(["Config"]);
    expect(analyzeCompatibility(indirect).functions.indirect.requirements).toEqual(["Config"]);
    expect(frontendRequirements(indirect, "indirect")).toEqual(["Config"]);
    // The alias resolves to an ANALYZED function, so the row still arrives
    // through the call graph with the path that names it, not by inlining.
    expect(analyzeCompatibility(indirect).functions.indirect.requirementPaths.Config)
      .toEqual(["indirect", "reads"]);

    const method = `
      import { Context } from "smthrs/context"
      abstract class Config extends Context { abstract readonly retries: number }
      export const holder = { read(): number { return Config.context().retries } }
      export function callsMethod(): number { return holder.read() }
    `;
    expect(analyzeCompatibility(method).functions.callsMethod.requirements).toEqual(["Config"]);
    expect(frontendRequirements(method, "callsMethod")).toEqual(["Config"]);
    // An object-literal method is not an analysis fact, so it is entered where
    // it runs and the route names the method it entered.
    expect(analyzeCompatibility(method).functions.callsMethod.requirementPaths.Config)
      .toEqual(["callsMethod", "read"]);

    // Naming a method is still not using it, in both directions.
    const named = `
      import { Context } from "smthrs/context"
      abstract class Config extends Context { abstract readonly retries: number }
      export const holder = { read(): number { return Config.context().retries } }
      export function namesMethod(): unknown { return holder.read }
    `;
    expect(analyzeCompatibility(named).functions.namesMethod.requirements).toEqual([]);
    expect(frontendRequirements(named, "namesMethod")).toEqual([]);

    // A generic capability receiver is under-reported by BOTH analyzers: the
    // receiver's symbol is a type parameter, not a Context class declaration.
    const generic = `
      import { Context } from "smthrs/context"
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

/**
 * `docs/ASSET_LOADERS.md` (Locked): "Loading happens during compilation. It
 * does not add `FileSystem` or another runtime platform requirement to the
 * importing program."
 *
 * The native pin is the observation channel: it is a checked assertion over the
 * complete transitive graph, so a pinned function that reads an asset compiles
 * only when the asset edge contributed no requirement. Both directions are
 * pinned here — the compile-time edge must vanish, and an ORDINARY relative
 * TypeScript import must still charge `TypeScript` with its path intact.
 */
describe("compile-time asset imports", () => {
  const withRoot = async (run: (root: string) => Promise<void>): Promise<void> => {
    const root = await mkdtemp(join(tmpdir(), "smithers-classify-assets-"));
    try {
      await run(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  };

  test("a function reading a const JSON asset satisfies a native pin end to end", async () => {
    // The whole pipeline, because the classifier reads AUTHORED text while the
    // asset stage is the component that owns the edge: this fails if either
    // half stops agreeing about which relative imports are compile-time.
    await withRoot(async (root) => {
      await writeFile(join(root, "config.json"), '{"mode":"production","ports":[80,443]}\n');
      const authored = `
        import { native } from "smithers:native"
        import config from "./config.json" with { type: "json", mode: "const" }
        function describe(): string { return config.mode + "/" + config.ports.length }
        native(describe)
        export function main(): string { return describe() }
      `;
      const staged = await compileSourceAssetModules({
        compiler: new AssetCompiler({
          root,
          cacheDirectory: join(root, ".cache"),
          target: "node-es2022",
          options: { frontend: "classify-asset-test" },
        }),
        sources: [{ fileName: "main.sm", source: authored }],
      });
      expect(staged.ok).toBe(true);
      // The stage claims exactly this edge; the classifier must not charge it.
      expect(staged.modules.map((module) => module.resolutionAliases)).toEqual([["config.json"]]);

      const compiled = compileProject([{ fileName: "main.sm", source: authored }], {
        rootDir: root,
        outDir: join(root, "out"),
        additionalRuntimeSources: staged.modules,
        additionalRuntimeOutputs: [{
          sourceFileName: staged.modules[0]!.sourceFileName,
          outputFileName: join(root, "out", "__smithers_assets__", `${staged.modules[0]!.logicalKey}.ts`),
          resolutionAliases: staged.modules[0]!.resolutionAliases,
          stripImportAttributes: true,
        }],
      });
      expect(compiled.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([]);
    });
  });

  test("the compile-time edge contributes no requirement, and the same value read from code still does", () => {
    const asset = analyzeCompatibility(`
      import { native } from "smithers:native"
      import config from "./config.json" with { type: "json", mode: "const" }
      function describe(): string { return config.mode + "/" + config.ports.length }
      native(describe)
    `);
    expect(asset.functions.describe.requirements).toEqual([]);
    expect(asset.functions.describe.nativePinned).toBe(true);
    expect(asset.diagnostics).toEqual([]);

    // The controlled A/B the conformance lane used: the identical program with
    // the same object written as a local `as const` has always pinned clean, so
    // the asset import was the only difference.
    const local = analyzeCompatibility(`
      import { native } from "smithers:native"
      const config = { mode: "production", ports: [80, 443] } as const
      function describe(): string { return config.mode + "/" + config.ports.length }
      native(describe)
    `);
    expect(local.functions.describe.requirements).toEqual([]);
    expect(local.diagnostics).toEqual([]);

    // Every built-in loader the specification names is the same compile-time
    // edge, selected by the attribute rather than by the extension.
    for (const attributes of [
      `{ type: "text" }`,
      `{ type: "bytes" }`,
      `{ type: "markdown" }`,
      `{ type: "mdx" }`,
      `{ type: "json" }`,
    ]) {
      const result = analyzeCompatibility(`
        import { native } from "smithers:native"
        import asset from "./prompt.md" with ${attributes}
        function describe(): unknown { return asset }
        native(describe)
      `);
      expect(result.functions.describe.requirements).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    }
  });

  test("an ordinary relative TypeScript import still charges TypeScript with its path intact", () => {
    // The other direction, and the hazard: exempting the asset edge must not
    // make relative imports — or any specifier namespace — requirement-free.
    const direct = analyzeCompatibility(`
      import { native } from "smithers:native"
      import { helper } from "./helper.ts"
      function describe(): string { return helper() }
      native(describe)
    `);
    expect(direct.functions.describe.requirements).toEqual(["TypeScript"]);
    expect(direct.diagnostics.find((diagnostic) => diagnostic.code === "SMITHERS3001")?.message)
      .toBe("native pin failed: TypeScript is required through describe");

    const transitive = analyzeCompatibilityProject({
      "leaf.sm": `
        import { helper } from "./helper.js"
        export function leaf(): string { return helper() }
      `,
      "main.sm": `
        import { leaf } from "./leaf.sm"
        import config from "./config.json" with { type: "json", mode: "const" }
        import { native } from "smithers:native"
        export function inner(): string { return leaf() + config.mode }
        export function pinned(): string { return inner() }
        native(pinned)
      `,
    });
    expect(transitive.functions["main.sm#pinned"].requirementPaths.TypeScript)
      .toEqual(["main.sm#pinned", "main.sm#inner", "leaf.sm#leaf"]);
    expect(transitive.diagnostics.find((diagnostic) => diagnostic.code === "SMITHERS3001")?.message)
      .toBe("native pin failed: TypeScript is required through main.sm#pinned -> main.sm#inner -> leaf.sm#leaf");
  });

  test("only the form the asset stage actually owns is exempt", () => {
    // Each of these is a shape `poc/src/build/source-assets.ts` refuses, so
    // none of them may become a requirement-free edge here. The exemption is a
    // property of the attributed import declaration, never of the specifier.
    const refused: Readonly<Record<string, string>> = {
      // SMITHERS5202: the legacy assertion spelling is not an asset import.
      legacyAssert: `import config from "./config.json" assert { type: "json" }`,
      // SMITHERS5201: a non-code import with no `type` selects no loader.
      noAttribute: `import config from "./config.json"`,
      emptyType: `import config from "./config.json" with { type: "" }`,
      // SMITHERS5207: an asset import must be relative.
      barePackage: `import config from "some-package/config.json" with { type: "json" }`,
      // An attribute the asset stage does not read at all.
      otherAttribute: `import config from "./config.json" with { mode: "const" }`,
    };
    for (const [name, importLine] of Object.entries(refused)) {
      const result = analyzeCompatibility(`
        import { native } from "smithers:native"
        ${importLine}
        function describe(): unknown { return config }
        native(describe)
      `);
      expect([name, result.functions.describe.requirements]).toEqual([name, ["TypeScript"]]);
      expect([name, result.diagnostics.some((diagnostic) => diagnostic.code === "SMITHERS3001")])
        .toEqual([name, true]);
    }

    // SMITHERS5208: asset imports require runtime bindings, so a side-effect
    // import is an ordinary runtime module edge whatever it is attributed with.
    const sideEffect = analyzeCompatibility(`
      import "./config.json" with { type: "json" }
      import { native } from "smithers:native"
      function describe(): number { return 1 }
      native(describe)
    `);
    expect(sideEffect.functions.describe.requirements).toEqual(["TypeScript"]);
  });

  test("the exemption's premise holds: without the asset stage the read is rejected", async () => {
    // The exemption reads the attribute and plumbs no state from the asset
    // stage. That is sound only because a project where the stage did NOT claim
    // the edge cannot compile: the binding is then a foreign value, not a
    // compiler-generated pure-data module. This is the premise, measured rather
    // than reasoned, so it cannot rot silently into a false certification.
    await withRoot(async (root) => {
      await writeFile(join(root, "config.json"), '{"mode":"production"}\n');
      await writeFile(join(root, "system.md"), "# hello\n");
      const reads: Readonly<Record<string, string>> = {
        propertyRead: `import config from "./config.json" with { type: "json", mode: "const" }
          function describe(): string { return config.mode }`,
        wholeValue: `import config from "./config.json" with { type: "json", mode: "const" }
          function describe(): string { return String(config) }`,
        namespaceRead: `import * as config from "./config.json" with { type: "json" }
          function describe(): unknown { return config }`,
        textAsset: `import prompt from "./system.md" with { type: "text" }
          function describe(): string { return prompt }`,
        missingFile: `import missing from "./missing.json" with { type: "json" }
          function describe(): string { return String(missing) }`,
      };
      for (const [name, body] of Object.entries(reads)) {
        const compiled = compileProject([{
          fileName: "main.sm",
          source: `
            import { native } from "smithers:native"
            ${body}
            native(describe)
            export function main(): unknown { return describe() }
          `,
        }], { rootDir: root, outDir: join(root, "out") });
        // Rejected by the foreign-value/foreign-module rules, never accepted
        // with a granted pin.
        expect([name, compiled.diagnostics.some((diagnostic) =>
          ["SMITHERS1506", "SMITHERS1508", "SMITHERS1510"].includes(diagnostic.code))]).toEqual([name, true]);
      }
    });
  });

  test("the neighbouring compile-time-only edges keep their classifications", () => {
    // `embed(...)` is a tracked comptime input: the compiler inlines the file
    // text, so reading it is not runtime I/O. The comptime pass erases the
    // whole `smithers:comptime` edge before this analyzer runs; the row is
    // requirement-free either way.
    const embedded = analyzeCompatibility(`
      import { comptime, embed } from "smithers:comptime"
      import { native } from "smithers:native"
      function describe(): string { return comptime(embed("./data.txt")) }
      native(describe)
    `);
    expect(embedded.functions.describe.requirements).toEqual([]);
    expect(embedded.diagnostics).toEqual([]);

    // `smithers:schema` is deliberately NOT in the compiler-owned registry,
    // which is exactly the frontend's COMPILER_INTRINSIC_SPECIFIERS. The
    // comptime pass removes that import and prepends `smthrs/schema-runtime`,
    // so the classifier only ever sees the specifier in a project the pass did
    // not lower — where the frontend itself rejects it (SMITHERS1510). Charging
    // `TypeScript` is the conservative answer; widening the registry to absorb
    // it would be an under-report in the direction a pin must never fail.
    const schema = analyzeCompatibility(`
      import { Schema } from "smithers:schema"
      export function derives(): unknown { return Schema.derive() }
    `);
    expect(schema.functions.derives.requirements).toEqual(["TypeScript"]);
    const lowered = analyzeCompatibility(`
      import { Schema } from "smthrs/schema-runtime"
      export function derives(): unknown { return Schema }
    `);
    expect(lowered.functions.derives.requirements).toEqual([]);

    // Dynamic import stays charged, and it is the dynamic-import OPERATION that
    // is charged rather than the asset: a literal dynamic import of a project
    // `.sm` module is charged identically. This over-reports (it refuses a pin
    // rather than granting one) and is deliberately left alone here.
    const dynamicAsset = analyzeCompatibility(`
      export async function load(): Promise<unknown> {
        return await import("./config.json", { with: { type: "json" } })
      }
    `);
    const dynamicModule = analyzeCompatibility(`
      export async function load(): Promise<unknown> { return await import("./other.sm") }
    `);
    expect(dynamicAsset.functions.load.requirements).toEqual(["TypeScript"]);
    expect(dynamicModule.functions.load.requirements).toEqual(["TypeScript"]);
  });
});

/**
 * Foreign edges laundered through a project module.
 *
 * A native pin is a CERTIFICATION that a function needs no TypeScript/Node
 * runtime, checked over the complete transitive graph (`specification/
 * compatibility.mdx`, Locked: "Compilation MUST fail if any reachable operation
 * or provider requires TypeScript"). The classifier stopped following a binding
 * at the first import declaration and treated every project-module specifier as
 * requirement-free, so ANY project module could launder a `node:` import
 * through a re-export and the pin was granted with no diagnostic while the
 * direct import of the same function refused it. That is the fail-open
 * direction: the compiler said yes to an assertion the specification forbids.
 *
 * Both directions are pinned here. Every re-binding form that reaches a real
 * foreign module must refuse the pin AND name the laundering route; the
 * requirement-free edges the specification and the asset stage own — type-only
 * re-exports, compile-time asset re-exports, compiler-owned modules, and
 * ordinary project re-exports — must stay requirement-free.
 */
describe("foreign edges laundered through a project module", () => {
  const PIN = `import { native } from "smithers:native"`;
  /** Reads a binding named `readFileSync` re-exported by `reexport.sm`. */
  const READER = `
    import { readFileSync } from "./reexport.sm"
    ${PIN}
    export function pinned(): unknown { return readFileSync("x") }
    native(pinned)
  `;

  const pinOf = (result: ReturnType<typeof analyzeCompatibilityProject>): {
    requirements: string[];
    path: string[] | undefined;
    refused: string[];
  } => ({
    requirements: result.functions["main.sm#pinned"]!.requirements,
    path: result.functions["main.sm#pinned"]!.requirementPaths['Module<"node:fs">'],
    refused: result.diagnostics.filter((diagnostic) => diagnostic.code === "SMITHERS3001")
      .map((diagnostic) => diagnostic.message),
  });

  test("the reproduction: a re-export laundered the edge the direct import refuses", () => {
    // The A/B control C40 recorded. Both programs read the same `node:fs`
    // function; only the route differs, so they must reach the same verdict.
    const direct = analyzeCompatibilityProject({
      "main.sm": `
        import { readFileSync } from "node:fs"
        ${PIN}
        export function pinned(): unknown { return readFileSync("x") }
        native(pinned)
      `,
    });
    expect(pinOf(direct)).toEqual({
      requirements: ['Module<"node:fs">'],
      path: ["main.sm#pinned"],
      refused: ['native pin failed: Module<"node:fs"> is required through main.sm#pinned'],
    });

    const laundered = analyzeCompatibilityProject({
      "reexport.sm": `export { readFileSync } from "node:fs"`,
      "main.sm": READER,
    });
    expect(pinOf(laundered)).toEqual({
      requirements: ['Module<"node:fs">'],
      // The route, not just the verdict: the path names the laundering module
      // and ends at the module that actually introduced the requirement.
      path: ["main.sm#pinned", "reexport.sm", "node:fs"],
      refused: [
        'native pin failed: Module<"node:fs"> is required through main.sm#pinned -> reexport.sm -> node:fs',
      ],
    });
  });

  test("every re-binding form that reaches node:fs refuses the pin and names the route", () => {
    // One table, one verdict per form. Each entry is a different way to publish
    // a foreign binding out of a project module; the analyzer must follow all
    // of them, because an author can pick any of them by accident.
    const forms: Readonly<Record<string, { reexport: string; main?: string }>> = {
      namedReexport: { reexport: `export { readFileSync } from "node:fs"` },
      starReexport: { reexport: `export * from "node:fs"` },
      defaultAsNamed: { reexport: `export { default as readFileSync } from "node:fs"` },
      importThenExport: {
        reexport: `
          import { readFileSync } from "node:fs"
          export { readFileSync }
        `,
      },
      renamedThroughExport: {
        reexport: `
          import { readFileSync as local } from "node:fs"
          export { local as readFileSync }
        `,
      },
      valueBinding: {
        reexport: `
          import * as fs from "node:fs"
          export const readFileSync = fs.readFileSync
        `,
      },
      destructuredBinding: {
        reexport: `
          import * as fs from "node:fs"
          export const { readFileSync } = fs
        `,
      },
      exportAssignment: {
        reexport: `
          import { readFileSync } from "node:fs"
          export default readFileSync
        `,
        main: `
          import readFileSync from "./reexport.sm"
          ${PIN}
          export function pinned(): unknown { return readFileSync("x") }
          native(pinned)
        `,
      },
      namespaceReexport: {
        reexport: `export * as fs from "node:fs"`,
        main: `
          import { fs } from "./reexport.sm"
          ${PIN}
          export function pinned(): unknown { return fs.readFileSync("x") }
          native(pinned)
        `,
      },
      namespaceImportOfLaunderer: {
        reexport: `export { readFileSync } from "node:fs"`,
        main: `
          import * as laundry from "./reexport.sm"
          ${PIN}
          export function pinned(): unknown { return laundry.readFileSync("x") }
          native(pinned)
        `,
      },
      wholeNamespaceEscapes: {
        // The member is not statically known, so the whole namespace is
        // answered conservatively: it really does carry the foreign binding.
        reexport: `export { readFileSync } from "node:fs"`,
        main: `
          import * as laundry from "./reexport.sm"
          ${PIN}
          export function pinned(): unknown { return laundry }
          native(pinned)
        `,
      },
    };
    for (const [name, form] of Object.entries(forms)) {
      const result = analyzeCompatibilityProject({
        "reexport.sm": form.reexport,
        "main.sm": form.main ?? READER,
      });
      expect([name, pinOf(result)]).toEqual([name, {
        requirements: ['Module<"node:fs">'],
        path: ["main.sm#pinned", "reexport.sm", "node:fs"],
        refused: [
          'native pin failed: Module<"node:fs"> is required through main.sm#pinned -> reexport.sm -> node:fs',
        ],
      }]);
    }
  });

  test("a parameter default is part of the row it executes in", () => {
    // Found while enumerating the laundering forms: the body-only walk skipped
    // parameter defaults, so a `node:fs` edge written in the signature was
    // certified native.
    const result = analyzeCompatibilityProject({
      "main.sm": `
        import { readFileSync } from "node:fs"
        ${PIN}
        export function pinned(read = readFileSync): unknown { return read("x") }
        native(pinned)
      `,
    });
    expect(pinOf(result)).toEqual({
      requirements: ['Module<"node:fs">'],
      path: ["main.sm#pinned"],
      refused: ['native pin failed: Module<"node:fs"> is required through main.sm#pinned'],
    });
  });

  test("a value binding launders inside one module too", () => {
    const result = analyzeCompatibilityProject({
      "main.sm": `
        import * as fs from "node:fs"
        ${PIN}
        const readFileSync = fs.readFileSync
        export function pinned(): unknown { return readFileSync("x") }
        native(pinned)
      `,
    });
    // No module boundary was crossed, so the route gains no hop.
    expect(pinOf(result)).toEqual({
      requirements: ['Module<"node:fs">'],
      path: ["main.sm#pinned"],
      refused: ['native pin failed: Module<"node:fs"> is required through main.sm#pinned'],
    });
  });

  test("the route is followed through two project modules and stays attributed", () => {
    const result = analyzeCompatibilityProject({
      "inner.sm": `export { readFileSync } from "node:fs"`,
      "outer.sm": `export { readFileSync } from "./inner.sm"`,
      "main.sm": `
        import { readFileSync } from "./outer.sm"
        ${PIN}
        export function pinned(): unknown { return readFileSync("x") }
        native(pinned)
      `,
    });
    expect(pinOf(result)).toEqual({
      requirements: ['Module<"node:fs">'],
      path: ["main.sm#pinned", "outer.sm", "inner.sm", "node:fs"],
      refused: [
        'native pin failed: Module<"node:fs"> is required through main.sm#pinned -> outer.sm -> inner.sm -> node:fs',
      ],
    });

    // Star re-exports chain the same way, and the checker has no alias to
    // follow for either hop because `node:fs` resolves to no file here.
    const stars = analyzeCompatibilityProject({
      "inner.sm": `export * from "node:fs"`,
      "outer.sm": `export * from "./inner.sm"`,
      "main.sm": `
        import { readFileSync } from "./outer.sm"
        ${PIN}
        export function pinned(): unknown { return readFileSync("x") }
        native(pinned)
      `,
    });
    expect(pinOf(stars).path).toEqual(["main.sm#pinned", "outer.sm", "inner.sm", "node:fs"]);
  });

  test("a re-export cycle terminates, and a foreign edge inside one is still attributed", () => {
    // Termination first: a name that only ever re-exports itself resolves to
    // nothing, and the walk must end rather than hang.
    const named = analyzeCompatibilityProject({
      "a.sm": `export { readFileSync } from "./b.sm"`,
      "b.sm": `export { readFileSync } from "./a.sm"`,
      "main.sm": `
        import { readFileSync } from "./a.sm"
        ${PIN}
        export function pinned(): unknown { return readFileSync("x") }
        native(pinned)
      `,
    });
    expect(pinOf(named)).toEqual({ requirements: [], path: undefined, refused: [] });

    const stars = analyzeCompatibilityProject({
      "a.sm": `export * from "./b.sm"`,
      "b.sm": `export * from "./a.sm"`,
      "main.sm": `
        import { readFileSync } from "./a.sm"
        ${PIN}
        export function pinned(): unknown { return readFileSync("x") }
        native(pinned)
      `,
    });
    expect(pinOf(stars)).toEqual({ requirements: [], path: undefined, refused: [] });

    // And the cycle must not become an escape hatch: a foreign edge reachable
    // through a cyclic star graph is still charged, with its route.
    const cyclic = analyzeCompatibilityProject({
      "a.sm": `
        export { readFileSync } from "node:fs"
        export * from "./b.sm"
      `,
      "b.sm": `
        export * from "./a.sm"
        export function helper(): number { return 1 }
      `,
      "main.sm": `
        import { readFileSync } from "./b.sm"
        ${PIN}
        export function pinned(): unknown { return readFileSync("x") }
        native(pinned)
      `,
    });
    expect(pinOf(cyclic)).toEqual({
      requirements: ['Module<"node:fs">'],
      path: ["main.sm#pinned", "b.sm", "a.sm", "node:fs"],
      refused: [
        'native pin failed: Module<"node:fs"> is required through main.sm#pinned -> b.sm -> a.sm -> node:fs',
      ],
    });
  });

  test("the retained path mixes call hops and module hops without either shadowing the other", () => {
    // `addRequirement` keeps the FIRST path it sees for a requirement, and a
    // lane once shipped a spurious requirement that was inserted at a shallower
    // hop and thereby degraded a real path. Two different blocking requirements
    // reached by two different routes must each keep their own complete route.
    const result = analyzeCompatibilityProject({
      "reexport.sm": `export { readFileSync } from "node:fs"`,
      "leaf.sm": `
        import { readFileSync } from "./reexport.sm"
        export function leaf(): unknown { return readFileSync("x") }
      `,
      "main.sm": `
        import { leaf } from "./leaf.sm"
        import { parse } from "./vendor.sm"
        ${PIN}
        export function inner(): unknown { return leaf() }
        export function pinned(): unknown { return String(inner()) + String(parse("x")) }
        native(pinned)
      `,
      "vendor.sm": `export { parse } from "left-pad"`,
    });
    const pinned = result.functions["main.sm#pinned"]!;
    expect(pinned.requirements).toEqual(['Module<"node:fs">', "TypeScript"]);
    expect(pinned.requirementPaths['Module<"node:fs">'])
      .toEqual(["main.sm#pinned", "main.sm#inner", "leaf.sm#leaf", "reexport.sm", "node:fs"]);
    // A laundered bare package charges the built-in `TypeScript` requirement,
    // whose name does NOT identify the module, so the route is the only thing
    // that tells the author which edge to remove.
    expect(pinned.requirementPaths.TypeScript).toEqual(["main.sm#pinned", "vendor.sm", "left-pad"]);
    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === "SMITHERS3001")
      .map((diagnostic) => diagnostic.message)).toEqual([
      'native pin failed: Module<"node:fs"> is required through main.sm#pinned -> main.sm#inner -> leaf.sm#leaf -> reexport.sm -> node:fs',
      "native pin failed: TypeScript is required through main.sm#pinned -> vendor.sm -> left-pad",
    ]);
  });

  test("the negative direction: laundering the compile-time edges adds no requirement", () => {
    // Type-only re-exports (Locked: "A type-only import MUST NOT add that
    // requirement"), in every spelling that can carry one.
    const typeOnly: Readonly<Record<string, { reexport: string; main: string }>> = {
      exportTypeFrom: {
        reexport: `export type { Stats } from "node:fs"`,
        main: `
          import type { Stats } from "./reexport.sm"
          ${PIN}
          export function pinned(value: Stats): unknown { return value }
          native(pinned)
        `,
      },
      inlineTypeSpecifier: {
        reexport: `export { type Stats } from "node:fs"`,
        main: `
          import { type Stats } from "./reexport.sm"
          ${PIN}
          export function pinned(value: Stats): unknown { return value }
          native(pinned)
        `,
      },
      typeOnlyImportThenExport: {
        reexport: `
          import type { Stats } from "node:fs"
          export type { Stats }
        `,
        main: `
          import type { Stats } from "./reexport.sm"
          ${PIN}
          export function pinned(value: Stats): unknown { return value }
          native(pinned)
        `,
      },
    };
    for (const [name, form] of Object.entries(typeOnly)) {
      const result = analyzeCompatibilityProject({ "reexport.sm": form.reexport, "main.sm": form.main });
      expect([name, pinOf(result)]).toEqual([name, { requirements: [], path: undefined, refused: [] }]);
      expect([name, result.functions["main.sm#pinned"]!.nativePinned]).toEqual([name, true]);
    }

    // C40's compile-time asset edge, now reached THROUGH a re-export. The
    // source-asset stage records `export … from "./x.json" with { type }` as a
    // `"re-export"` asset edge on the same terms it accepts the import form, so
    // following the binding must not charge it.
    const asset = analyzeCompatibilityProject({
      "assets.sm": `export { default as config } from "./config.json" with { type: "json", mode: "const" }`,
      "main.sm": `
        import { config } from "./assets.sm"
        ${PIN}
        export function pinned(): unknown { return config }
        native(pinned)
      `,
    });
    expect(pinOf(asset)).toEqual({ requirements: [], path: undefined, refused: [] });
    expect(asset.functions["main.sm#pinned"]!.nativePinned).toBe(true);

    // Compiler-owned virtual modules stay requirement-free through a re-export
    // too — the registry is exact-match and is consulted at the end of the
    // walk, exactly as it is for a direct import.
    const owned = analyzeCompatibilityProject({
      "runtime.sm": `
        export { Layer } from "smthrs/provider"
        export * from "smthrs/context"
      `,
      "main.sm": `
        import { Layer, Context } from "./runtime.sm"
        ${PIN}
        export function pinned(): unknown { return [Layer, Context] }
        native(pinned)
      `,
    });
    expect(pinOf(owned)).toEqual({ requirements: [], path: undefined, refused: [] });

    // An ordinary project re-export of project code is still not an edge: the
    // re-exported function's own requirements belong to the call graph, which
    // reports them with the function path it always did.
    const clean = analyzeCompatibilityProject({
      "impl.sm": `export function helper(): number { return 1 }`,
      "reexport.sm": `export { helper } from "./impl.sm"`,
      "stars.sm": `export * from "./impl.sm"`,
      "main.sm": `
        import { helper } from "./reexport.sm"
        import { helper as starred } from "./stars.sm"
        ${PIN}
        export function pinned(): number { return helper() + starred() }
        native(pinned)
      `,
    });
    expect(pinOf(clean)).toEqual({ requirements: [], path: undefined, refused: [] });
    expect(clean.functions["main.sm#pinned"]!.nativePinned).toBe(true);

    const propagated = analyzeCompatibilityProject({
      "impl.sm": `export function helper(): unknown { return process.pid }`,
      "reexport.sm": `export { helper } from "./impl.sm"`,
      "main.sm": `
        import { helper } from "./reexport.sm"
        ${PIN}
        export function pinned(): unknown { return helper() }
        native(pinned)
      `,
    });
    expect(propagated.functions["main.sm#pinned"]!.requirementPaths['Host<"process">'])
      .toEqual(["main.sm#pinned", "impl.sm#helper"]);
  });

  test("a namespace read charges the export it actually reads, not the module", () => {
    // Precision in the direction that matters for over-correction: a module
    // that launders one binding does not become foreign wholesale.
    const sources = {
      "mixed.sm": `
        export { readFileSync } from "node:fs"
        export function safe(): number { return 1 }
      `,
      "main.sm": `
        import * as mixed from "./mixed.sm"
        ${PIN}
        export function pinned(): number { return mixed.safe() }
        native(pinned)
      `,
    };
    expect(pinOf(analyzeCompatibilityProject(sources)))
      .toEqual({ requirements: [], path: undefined, refused: [] });

    // The named import of the clean binding is likewise unaffected.
    const named = analyzeCompatibilityProject({
      "mixed.sm": sources["mixed.sm"],
      "main.sm": `
        import { safe } from "./mixed.sm"
        ${PIN}
        export function pinned(): number { return safe() }
        native(pinned)
      `,
    });
    expect(pinOf(named)).toEqual({ requirements: [], path: undefined, refused: [] });
  });
});

describe("ambient authority laundered through a module-level initializer", () => {
  const PIN = `import { native } from "smithers:native"`;
  /** Reads a binding named `value` produced by `config.sm`'s initializer. */
  const READER = `
    import { value } from "./config.sm"
    ${PIN}
    export function pinned(): unknown { return value }
    native(pinned)
  `;

  const rowOf = (result: ReturnType<typeof analyzeCompatibilityProject>): {
    requirements: string[];
    paths: Record<string, string[]>;
    refused: string[];
  } => ({
    requirements: result.functions["main.sm#pinned"]!.requirements,
    paths: result.functions["main.sm#pinned"]!.requirementPaths,
    refused: result.diagnostics.filter((diagnostic) => diagnostic.code === "SMITHERS3001")
      .map((diagnostic) => diagnostic.message),
  });

  test("the reproduction: an initializer laundered the authority the body charges", () => {
    // The A/B control. Both programs depend on `process.pid`; only the route
    // differs, so they must reach the same verdict. C41 measured the laundered
    // half as `requirements: []` with the pin GRANTED — a certification the
    // Locked Native Pin rule forbids, since `Host<"process">` is this POC's
    // spelling of JavaScript-host dependence.
    const direct = analyzeCompatibilityProject({
      "main.sm": `
        ${PIN}
        export function pinned(): unknown { return process.pid }
        native(pinned)
      `,
    });
    expect(rowOf(direct)).toEqual({
      requirements: ['Host<"process">'],
      paths: { 'Host<"process">': ["main.sm#pinned"] },
      refused: ['native pin failed: Host<"process"> is required through main.sm#pinned'],
    });

    const laundered = analyzeCompatibilityProject({
      "config.sm": `export const value = process.pid`,
      "main.sm": READER,
    });
    expect(rowOf(laundered)).toEqual({
      requirements: ['Host<"process">'],
      // The route, not just the verdict: a `Host<...>` requirement names a
      // service rather than a location, so without the binding hop and the
      // ambient expression the author is told a pin failed and nothing else.
      paths: { 'Host<"process">': ["main.sm#pinned", "config.sm#value", "process.pid"] },
      refused: [
        'native pin failed: Host<"process"> is required through main.sm#pinned -> config.sm#value -> process.pid',
      ],
    });
  });

  test("every initializer form that captures ambient authority is charged with its route", () => {
    // One table, one verdict per form. `Clock` and `Random` name services the
    // native target can supply with its own layer, so they belong in the ROW and
    // do not refuse the pin; `Host<...>` is host dependence and does refuse it.
    // Both are fail-opens when the row is missing entirely, which is what each
    // of these forms produced before.
    const forms: Readonly<Record<string, {
      config?: string;
      main?: string;
      requirement: string;
      path: string[];
      refuses: boolean;
    }>> = {
      hostGlobalMember: {
        config: `export const value = process.pid`,
        requirement: 'Host<"process">',
        path: ["main.sm#pinned", "config.sm#value", "process.pid"],
        refuses: true,
      },
      // A non-exported module-level const is the same laundering: the reader is
      // in the same module, so the route has no module hop, only the binding.
      moduleLocalConst: {
        main: `
          ${PIN}
          const value = process.pid
          export function pinned(): unknown { return value }
          native(pinned)
        `,
        requirement: 'Host<"process">',
        path: ["main.sm#pinned", "main.sm#value", "process.pid"],
        refuses: true,
      },
      clockCalledAtModuleLevel: {
        config: `export const value = Date.now()`,
        requirement: "Clock",
        path: ["main.sm#pinned", "config.sm#value", "Date.now"],
        refuses: false,
      },
      // The function captured rather than called. The authority is the same and
      // is reached at the same place, so the verdict and route are identical —
      // the analyzer never has to decide when the call happens.
      clockCapturedNotCalled: {
        config: `export const value = Date.now`,
        main: `
          import { value } from "./config.sm"
          ${PIN}
          export function pinned(): unknown { return value() }
          native(pinned)
        `,
        requirement: "Clock",
        path: ["main.sm#pinned", "config.sm#value", "Date.now"],
        refuses: false,
      },
      constructedDate: {
        config: `export const value = new Date()`,
        requirement: "Clock",
        path: ["main.sm#pinned", "config.sm#value", "Date"],
        refuses: false,
      },
      objectLiteral: {
        config: `export const value = { pid: process.pid, label: "x" }`,
        main: `
          import { value } from "./config.sm"
          ${PIN}
          export function pinned(): unknown { return value.pid }
          native(pinned)
        `,
        requirement: 'Host<"process">',
        path: ["main.sm#pinned", "config.sm#value", "process.pid"],
        refuses: true,
      },
      arrayLiteral: {
        config: `export const value = [Date.now(), 0]`,
        main: `
          import { value } from "./config.sm"
          ${PIN}
          export function pinned(): unknown { return value[0] }
          native(pinned)
        `,
        requirement: "Clock",
        path: ["main.sm#pinned", "config.sm#value", "Date.now"],
        refuses: false,
      },
      namespaceRead: {
        config: `export const value = process.pid`,
        main: `
          import * as config from "./config.sm"
          ${PIN}
          export function pinned(): unknown { return config.value }
          native(pinned)
        `,
        requirement: 'Host<"process">',
        path: ["main.sm#pinned", "config.sm#value", "process.pid"],
        refuses: true,
      },
      destructuredFromAmbientRoot: {
        config: `export const { pid: value } = process`,
        requirement: 'Host<"process">',
        path: ["main.sm#pinned", "config.sm#value", "process"],
        refuses: true,
      },
      exportAssignment: {
        config: `export default process.pid`,
        main: `
          import value from "./config.sm"
          ${PIN}
          export function pinned(): unknown { return value }
          native(pinned)
        `,
        requirement: 'Host<"process">',
        path: ["main.sm#pinned", "config.sm#default", "process.pid"],
        refuses: true,
      },
      randomness: {
        config: `export const value = Math.random()`,
        requirement: "Random",
        path: ["main.sm#pinned", "config.sm#value", "Math.random"],
        refuses: false,
      },
      cryptoRandomness: {
        config: `export const value = crypto.randomUUID()`,
        requirement: "Random",
        path: ["main.sm#pinned", "config.sm#value", "crypto.randomUUID"],
        refuses: false,
      },
      // The rest of `crypto` is host dependence rather than randomness, and it
      // is the direction that refuses a pin.
      cryptoHost: {
        config: `export const value = crypto.subtle`,
        requirement: 'Host<"crypto">',
        path: ["main.sm#pinned", "config.sm#value", "crypto.subtle"],
        refuses: true,
      },
      performanceClock: {
        config: `export const value = performance.now()`,
        requirement: "Clock",
        path: ["main.sm#pinned", "config.sm#value", "performance.now"],
        refuses: false,
      },
    };
    for (const [name, form] of Object.entries(forms)) {
      const sources: Record<string, string> = { "main.sm": form.main ?? READER };
      if (form.config !== undefined) sources["config.sm"] = form.config;
      const actual = rowOf(analyzeCompatibilityProject(sources));
      expect([name, actual.requirements]).toEqual([name, [form.requirement]]);
      expect([name, actual.paths[form.requirement]]).toEqual([name, form.path]);
      expect([name, actual.refused]).toEqual([name, form.refuses
        ? [`native pin failed: ${form.requirement} is required through ${form.path.join(" -> ")}`]
        : []]);
    }
  });

  test("an initializer reached through another module keeps every hop of the route", () => {
    // Where this meets C41's work: the binding half is resolved by the same
    // hop-by-hop walk, so a re-export chain ENDING at an ambient initializer
    // names each laundering module and then the binding that captured it.
    const chained = analyzeCompatibilityProject({
      "inner.sm": `export const value = process.pid`,
      "outer.sm": `export { value } from "./inner.sm"`,
      "main.sm": `
        import { value } from "./outer.sm"
        ${PIN}
        export function pinned(): unknown { return value }
        native(pinned)
      `,
    });
    expect(chained.functions["main.sm#pinned"]!.requirementPaths['Host<"process">'])
      .toEqual(["main.sm#pinned", "outer.sm", "inner.sm#value", "process.pid"]);

    // Call hops, module hops, the binding hop and the ambient source compose in
    // one path, so the reader is led from the pinned function all the way to the
    // expression to delete.
    const composed = analyzeCompatibilityProject({
      "config.sm": `export const value = process.pid`,
      "reexport.sm": `export { value } from "./config.sm"`,
      "leaf.sm": `
        import { value } from "./reexport.sm"
        export function leaf(): unknown { return value }
      `,
      "main.sm": `
        import { leaf } from "./leaf.sm"
        ${PIN}
        export function inner(): unknown { return leaf() }
        export function pinned(): unknown { return inner() }
        native(pinned)
      `,
    });
    expect(composed.functions["main.sm#pinned"]!.requirementPaths['Host<"process">']).toEqual([
      "main.sm#pinned",
      "main.sm#inner",
      "leaf.sm#leaf",
      "reexport.sm",
      "config.sm#value",
      "process.pid",
    ]);

    // A re-export cycle that also holds an ambient initializer terminates and is
    // still attributed, on the same stack discipline C41 established.
    const cyclic = analyzeCompatibilityProject({
      "a.sm": `export { value } from "./b.sm"`,
      "b.sm": `
        export { value as unused } from "./a.sm"
        export const value = process.pid
      `,
      "main.sm": `
        import { value } from "./a.sm"
        ${PIN}
        export function pinned(): unknown { return value }
        native(pinned)
      `,
    });
    expect(cyclic.functions["main.sm#pinned"]!.requirementPaths['Host<"process">'])
      .toEqual(["main.sm#pinned", "a.sm", "b.sm#value", "process.pid"]);
  });

  test("a blocking requirement is never lost behind a non-blocking one in the same initializer", () => {
    // The reason ambient findings accumulate instead of stopping at the first
    // hit like the module-edge search does. `Clock` is reached first and does
    // not refuse a pin; keeping only it would grant the certification that
    // `process.pid` forbids, which is the same fail-open in a new spelling.
    const several = analyzeCompatibilityProject({
      "config.sm": `export const value = { at: Date.now(), pid: process.pid }`,
      "main.sm": READER,
    });
    expect(rowOf(several)).toEqual({
      requirements: ["Clock", 'Host<"process">'],
      paths: {
        Clock: ["main.sm#pinned", "config.sm#value", "Date.now"],
        'Host<"process">': ["main.sm#pinned", "config.sm#value", "process.pid"],
      },
      refused: [
        'native pin failed: Host<"process"> is required through main.sm#pinned -> config.sm#value -> process.pid',
      ],
    });

    // A module edge and ambient authority in one initializer: both are charged,
    // each with its own route, and neither shadows the other.
    const mixed = analyzeCompatibilityProject({
      "config.sm": `
        import { readFileSync } from "node:fs"
        export const value = { file: readFileSync("x"), pid: process.pid }
      `,
      "main.sm": READER,
    });
    expect(mixed.functions["main.sm#pinned"]!.requirementPaths).toEqual({
      'Host<"process">': ["main.sm#pinned", "config.sm#value", "process.pid"],
      'Module<"node:fs">': ["main.sm#pinned", "config.sm", "node:fs"],
    });

    // Two requirements reached by two DIFFERENT routes from one function keep
    // both routes complete, exactly as C41's composite case requires.
    const twoRoutes = analyzeCompatibilityProject({
      "config.sm": `export const value = process.pid`,
      "vendor.sm": `export { padStart } from "left-pad"`,
      "main.sm": `
        import { value } from "./config.sm"
        import { padStart } from "./vendor.sm"
        ${PIN}
        export function pinned(): unknown { return [value, padStart] }
        native(pinned)
      `,
    });
    expect(twoRoutes.diagnostics.filter((diagnostic) => diagnostic.code === "SMITHERS3001")
      .map((diagnostic) => diagnostic.message)).toEqual([
      'native pin failed: Host<"process"> is required through main.sm#pinned -> config.sm#value -> process.pid',
      "native pin failed: TypeScript is required through main.sm#pinned -> vendor.sm -> left-pad",
    ]);
  });

  test("the negative direction: an ordinary module-level value still charges nothing", () => {
    // Over-correction is the live hazard in this file: one lane shipped a
    // fail-open while fixing a fail-closed, another broke ordinary boolean
    // negation, and a third made a whole specifier namespace requirement-free.
    // Every row here must stay requirement-free and keep its pin.
    const ordinary: Readonly<Record<string, { config?: string; main?: string }>> = {
      // A lexical shadow is not ambient authority. This is the false-positive
      // direction and it is decided by the same `isAmbientReference` the body
      // walk uses, not by a second opinion written here.
      shadowedHostGlobal: {
        config: `
          const process = { pid: 7 }
          export const value = process.pid
        `,
      },
      shadowedClock: {
        config: `
          const Date = { now: () => 7 }
          export const value = Date.now()
        `,
      },
      // Locked and asserted for function bodies since before this lane:
      // `Date.parse`/`Date.UTC` read no clock.
      dateParse: { config: `export const value = Date.parse("2020-01-01")` },
      dateUtc: { config: `export const value = Date.UTC(2020, 0)` },
      destructuredDeterministicDate: {
        config: `export const { parse: value } = Date`,
      },
      deterministicDateConstruction: { config: `export const value = new Date(0)` },
      deterministicMath: { config: `export const value = Math.max(1, 2) + Math.PI + Math.abs(-1)` },
      // A plain computed value must not suddenly charge anything.
      computedConstant: { config: `export const value = 1 + 2 * 3` },
      stringWork: { config: `export const value = "a".concat("b").length` },
      // A property that merely SHARES a name with an ambient root is a property.
      propertyNamedLikeARoot: {
        config: `
          const bag = { process: 1, Date: 2, crypto: 3 }
          export const value = bag.process
        `,
      },
      // Building a closure does not run it. The analyzed function body has
      // always applied this rule; the initializer scan applies the same one, so
      // merely reading the binding stays ordinary.
      deferredClosure: { config: `export const value = () => process.pid` },
      // Name-directed, exactly as C41's module walk is: a module that launders
      // one binding does not become foreign wholesale.
      cleanSiblingOfALaunderingBinding: {
        config: `
          export const laundered = process.pid
          export const value = 1
        `,
      },
      // A capability read is the SUPPORTED way to reach host state, and it is a
      // nominal row rather than host dependence, so it must keep its pin.
      capabilityInsteadOfAmbient: {
        main: `
          import { Context } from "smthrs/context"
          ${PIN}
          abstract class Clock extends Context { abstract now(): number }
          export function pinned(): number { return Clock.context().now() }
          native(pinned)
        `,
      },
    };
    for (const [name, form] of Object.entries(ordinary)) {
      const sources: Record<string, string> = { "main.sm": form.main ?? READER };
      if (form.config !== undefined) sources["config.sm"] = form.config;
      const result = analyzeCompatibilityProject(sources);
      const actual = rowOf(result);
      expect([name, actual.refused]).toEqual([name, []]);
      expect([name, result.functions["main.sm#pinned"]!.nativePinned]).toEqual([name, true]);
      // The capability row is a reported requirement that does NOT block; every
      // other form here must be requirement-free outright.
      if (name !== "capabilityInsteadOfAmbient") {
        expect([name, actual.requirements]).toEqual([name, []]);
      } else {
        expect([name, actual.requirements]).toEqual([name, ["Clock"]]);
      }
    }
  });

  test("the fix reaches the whole pipeline, and the frontend refuses it independently", () => {
    // End to end through `compileProject`, not only the unit API. Two
    // independent components refuse this program, which is the point: the
    // frontend rejects the ambient read in authored `.sm` (SMITHERS1601) and the
    // native pin is a checked assertion over the transitive graph that must fail
    // on its own evidence (SMITHERS3001). Before this lane only the frontend
    // spoke, so the pin was a certification granted to a host-dependent graph.
    const laundered = compileProject(
      [
        { fileName: "config.mod.sm", source: `export const pid = process.pid\n` },
        {
          fileName: "main.sm",
          source: `import { pid } from "./config.mod.sm"
import { native } from "smithers:native"

export function hostBacked(): number {
  return pid
}

export function checksum(): number {
  return hostBacked()
}

native(checksum)
`,
        },
      ],
      { rootDir: "/smithers-ambient-e2e", outDir: "/smithers-ambient-e2e/out" },
    );
    expect(laundered.diagnostics.map((diagnostic) => diagnostic.code))
      .toEqual(["SMITHERS1601", "SMITHERS3001"]);
    expect(laundered.diagnostics.find((diagnostic) => diagnostic.code === "SMITHERS3001")?.message)
      .toBe(
        'native pin failed: Host<"process"> is required through ' +
          "main.sm#checksum -> main.sm#hostBacked -> config.mod.sm#pid -> process.pid",
      );

    // The clean control compiles, so the pipeline is not simply refusing every
    // module-level constant.
    const clean = compileProject(
      [
        { fileName: "config.mod.sm", source: `export const size = 4 * 1024\n` },
        {
          fileName: "main.sm",
          source: `import { size } from "./config.mod.sm"
import { native } from "smithers:native"

export function checksum(): number {
  return size
}

native(checksum)
`,
        },
      ],
      { rootDir: "/smithers-ambient-e2e", outDir: "/smithers-ambient-e2e/out" },
    );
    expect(clean.diagnostics).toEqual([]);
  });
});

describe("a callable invoked where it is defined", () => {
  const PIN = `import { native } from "smithers:native"`;
  /** Reads a binding named `value` produced by `config.sm`'s initializer. */
  const READER = `
    import { value } from "./config.sm"
    ${PIN}
    export function pinned(): unknown { return value }
    native(pinned)
  `;
  /** Reads the `pid` member off that binding, for the container forms. */
  const MEMBER_READER = `
    import { value } from "./config.sm"
    ${PIN}
    export function pinned(): unknown { return value.pid }
    native(pinned)
  `;

  const rowOf = (result: ReturnType<typeof analyzeCompatibilityProject>): {
    requirements: string[];
    paths: Record<string, string[]>;
    refused: string[];
  } => ({
    requirements: result.functions["main.sm#pinned"]!.requirements,
    paths: result.functions["main.sm#pinned"]!.requirementPaths,
    refused: result.diagnostics.filter((diagnostic) => diagnostic.code === "SMITHERS3001")
      .map((diagnostic) => diagnostic.message),
  });

  test("the reproduction: an immediately invoked callable ran while both walks skipped it", () => {
    // The A/B control. Both programs read `process.pid` when the module loads;
    // only the spelling differs, so they must reach the same verdict. Measured
    // before this lane, the parenthesized half was `requirements: []` with the
    // pin GRANTED — the same fail-open C50 closed for the plain initializer,
    // wearing a pair of parentheses.
    const direct = analyzeCompatibilityProject({
      "config.sm": `export const value = process.pid`,
      "main.sm": READER,
    });
    const invoked = analyzeCompatibilityProject({
      "config.sm": `export const value = (() => process.pid)()`,
      "main.sm": READER,
    });
    expect(rowOf(invoked)).toEqual(rowOf(direct));
    expect(rowOf(invoked)).toEqual({
      requirements: ['Host<"process">'],
      paths: { 'Host<"process">': ["main.sm#pinned", "config.sm#value", "process.pid"] },
      refused: [
        'native pin failed: Host<"process"> is required through main.sm#pinned -> config.sm#value -> process.pid',
      ],
    });

    // C50 reported the same blind spot in the analyzed BODY walk, so the body
    // half is an A/B control of its own rather than an assumption.
    const bodyDirect = analyzeCompatibilityProject({
      "main.sm": `
        ${PIN}
        export function pinned(): unknown { return process.pid }
        native(pinned)
      `,
    });
    const bodyInvoked = analyzeCompatibilityProject({
      "main.sm": `
        ${PIN}
        export function pinned(): unknown { return (() => process.pid)() }
        native(pinned)
      `,
    });
    expect(rowOf(bodyInvoked)).toEqual(rowOf(bodyDirect));
    expect(rowOf(bodyInvoked)).toEqual({
      requirements: ['Host<"process">'],
      paths: { 'Host<"process">': ["main.sm#pinned"] },
      refused: ['native pin failed: Host<"process"> is required through main.sm#pinned'],
    });
  });

  test("every immediately invoked form is charged where it runs, with its route intact", () => {
    // One table, one verdict per form. The route is asserted and not just the
    // verdict, because a `Host<...>` requirement names a service rather than a
    // location: without the last hop the author is told a pin failed and never
    // which expression to delete.
    const forms: Readonly<Record<string, {
      config?: string;
      outer?: string;
      main?: string;
      requirement: string;
      path: string[];
      refuses: boolean;
    }>> = {
      // The reported form, and its three sibling spellings of the same call.
      arrowIife: {
        config: `export const value = (() => process.pid)()`,
        requirement: 'Host<"process">',
        path: ["main.sm#pinned", "config.sm#value", "process.pid"],
        refuses: true,
      },
      functionExpressionIife: {
        config: `export const value = (function () { return process.pid })()`,
        requirement: 'Host<"process">',
        path: ["main.sm#pinned", "config.sm#value", "process.pid"],
        refuses: true,
      },
      // The name binds only inside the expression, so the callable is still
      // reachable at exactly one place: the call wrapped around it.
      namedFunctionExpressionIife: {
        config: `export const value = (function readPid() { return process.pid })()`,
        requirement: 'Host<"process">',
        path: ["main.sm#pinned", "config.sm#value", "process.pid"],
        refuses: true,
      },
      // The authority is captured when the module loads whether or not the
      // Promise is ever awaited, so an async IIFE is charged like any other.
      asyncArrowIife: {
        config: `export const value = (async () => process.pid)()`,
        requirement: 'Host<"process">',
        path: ["main.sm#pinned", "config.sm#value", "process.pid"],
        refuses: true,
      },
      // `.call`/`.apply` invoke the receiver on the spot. `.bind` does not, so
      // it is charged only because the bound result is invoked in turn — the
      // negative half of that pair is asserted below.
      reflectiveCall: {
        config: `export const value = (() => process.pid).call(null)`,
        requirement: 'Host<"process">',
        path: ["main.sm#pinned", "config.sm#value", "process.pid"],
        refuses: true,
      },
      reflectiveApply: {
        config: `export const value = (() => process.pid).apply(null)`,
        requirement: 'Host<"process">',
        path: ["main.sm#pinned", "config.sm#value", "process.pid"],
        refuses: true,
      },
      boundThenInvoked: {
        config: `export const value = (() => process.pid).bind(null)()`,
        requirement: 'Host<"process">',
        path: ["main.sm#pinned", "config.sm#value", "process.pid"],
        refuses: true,
      },
      // `?.()` is still a call, and a tagged template invokes its tag with the
      // template's parts. Neither is a new rule, only another callee position.
      optionalCall: {
        config: `export const value = (() => process.pid)?.()`,
        requirement: 'Host<"process">',
        path: ["main.sm#pinned", "config.sm#value", "process.pid"],
        refuses: true,
      },
      taggedTemplate: {
        config: "export const value = ((parts: TemplateStringsArray) => process.pid)`x`",
        requirement: 'Host<"process">',
        path: ["main.sm#pinned", "config.sm#value", "process.pid"],
        refuses: true,
      },
      // `new` runs the body exactly as a call does.
      constructorForm: {
        config: `export const value = new (function (this: any) { this.pid = process.pid })()`,
        requirement: 'Host<"process">',
        path: ["main.sm#pinned", "config.sm#value", "process.pid"],
        refuses: true,
      },
      // The containers C50 established must accumulate rather than
      // short-circuit still do so when the authority is behind an IIFE.
      iifeInObjectLiteral: {
        config: `export const value = { pid: (() => process.pid)() }`,
        main: MEMBER_READER,
        requirement: 'Host<"process">',
        path: ["main.sm#pinned", "config.sm#value", "process.pid"],
        refuses: true,
      },
      iifeInArrayLiteral: {
        config: `export const value = [(() => process.pid)(), 0]`,
        main: `
          import { value } from "./config.sm"
          ${PIN}
          export function pinned(): unknown { return value[0] }
          native(pinned)
        `,
        requirement: 'Host<"process">',
        path: ["main.sm#pinned", "config.sm#value", "process.pid"],
        refuses: true,
      },
      // Where this meets C41: the binding half is resolved by the same
      // hop-by-hop walk, so a re-export chain ending at an IIFE names every
      // laundering module and then the binding that captured the authority.
      iifeThroughAReExportChain: {
        config: `export const value = (() => process.pid)()`,
        outer: `export { value } from "./config.sm"`,
        main: `
          import { value } from "./outer.sm"
          ${PIN}
          export function pinned(): unknown { return value }
          native(pinned)
        `,
        requirement: 'Host<"process">',
        path: ["main.sm#pinned", "outer.sm", "config.sm#value", "process.pid"],
        refuses: true,
      },
      // The body walk, where the route is the function's own name. `Clock`
      // names a service the native target supplies, so it is reported and does
      // not refuse — it was equally missing before.
      clockIifeInFunctionBody: {
        main: `
          ${PIN}
          export function pinned(): unknown { return (() => Date.now())() }
          native(pinned)
        `,
        requirement: "Clock",
        path: ["main.sm#pinned"],
        refuses: false,
      },
      // An IIFE is not a special case bolted onto the ambient rule: the same
      // boundary hid every other fact the body walk collects. A foreign module
      // edge and `eval` inside one were lost in exactly the same way.
      foreignEdgeInsideAnIifeInFunctionBody: {
        main: `
          import { readFileSync } from "node:fs"
          ${PIN}
          export function pinned(): unknown { return (() => readFileSync("x"))() }
          native(pinned)
        `,
        requirement: 'Module<"node:fs">',
        path: ["main.sm#pinned"],
        refuses: true,
      },
      evalInsideAnIifeInFunctionBody: {
        main: `
          ${PIN}
          export function pinned(source: string): unknown { return (() => eval(source))() }
          native(pinned)
        `,
        requirement: "TypeScript",
        path: ["main.sm#pinned"],
        refuses: true,
      },
      // Authority one call deeper, in a body: the IIFE now really is walked, so
      // the call inside it becomes an ordinary call-graph edge and the existing
      // fixpoint carries the callee's row up with both hops of the path.
      iifeCallingAnAnalyzedFunction: {
        main: `
          ${PIN}
          function helper(): number { return process.pid }
          export function pinned(): unknown { return (() => helper())() }
          native(pinned)
        `,
        requirement: 'Host<"process">',
        path: ["main.sm#pinned", "main.sm#helper"],
        refuses: true,
      },
    };
    for (const [name, form] of Object.entries(forms)) {
      const sources: Record<string, string> = { "main.sm": form.main ?? READER };
      if (form.config !== undefined) sources["config.sm"] = form.config;
      if (form.outer !== undefined) sources["outer.sm"] = form.outer;
      const actual = rowOf(analyzeCompatibilityProject(sources));
      expect([name, actual.requirements]).toEqual([name, [form.requirement]]);
      expect([name, actual.paths[form.requirement]]).toEqual([name, form.path]);
      expect([name, actual.refused]).toEqual([name, form.refuses
        ? [`native pin failed: ${form.requirement} is required through ${form.path.join(" -> ")}`]
        : []]);
    }
  });

  test("a blocking requirement behind an IIFE is not lost behind a non-blocking one", () => {
    // C50's accumulation rule, re-measured through the new boundary. `Clock` is
    // reached first and does not refuse a pin; keeping only the first hit would
    // grant the certification the IIFE forbids, which is the original fail-open
    // in a third spelling.
    const several = analyzeCompatibilityProject({
      "config.sm": `export const value = { at: Date.now(), pid: (() => process.pid)() }`,
      "main.sm": MEMBER_READER,
    });
    expect(rowOf(several)).toEqual({
      requirements: ["Clock", 'Host<"process">'],
      paths: {
        Clock: ["main.sm#pinned", "config.sm#value", "Date.now"],
        'Host<"process">': ["main.sm#pinned", "config.sm#value", "process.pid"],
      },
      refused: [
        'native pin failed: Host<"process"> is required through main.sm#pinned -> config.sm#value -> process.pid',
      ],
    });
  });

  test("the negative direction: a callable that is DEFINED and not invoked stays ordinary", () => {
    // The direction this file has repeatedly got wrong — four over-corrections
    // across its history, one of which was a first attempt at exactly this fix
    // that descended into nested callables and broke the `deferred` assertion
    // rather than admitting the rule was wrong. Every row here must stay
    // requirement-free and keep its pin.
    const ordinary: Readonly<Record<string, { config?: string; main?: string }>> = {
      // THE PROTECTED ASSERTION, restated in the initializer scan's own terms:
      // defining a callable that would touch ambient authority is not a use of
      // that authority. If this row ever charges, the fix has become a
      // definition rule and is wrong.
      deferredClosure: { config: `export const value = () => process.pid` },
      deferredHostGlobalInABody: {
        main: `
          ${PIN}
          export function pinned(): unknown {
            const deferred = () => window.location
            return deferred
          }
          native(pinned)
        `,
      },
      // Stored, then never called.
      storedThenNeverCalled: {
        config: `
          const read = () => process.pid
          export const value = read
        `,
      },
      // Passed as an ARGUMENT without being invoked. This is the form that
      // makes `.map(callback)` undecidable from syntax alone: the two are
      // indistinguishable without modelling the callee's body, so the rule that
      // keeps this ordinary is the same rule that leaves `.map` to the
      // higher-order lane.
      passedAsAnArgument: {
        config: `
          function keep(fn: () => number): () => number { return fn }
          export const value = keep(() => process.pid)
        `,
      },
      // `.bind` alone produces another callable and runs nothing. It is charged
      // above only when the bound result is itself invoked, which is the pair
      // that proves the rule tracks invocation rather than the method name.
      boundButNeverInvoked: { config: `export const value = (() => process.pid).bind(null)` },
      // The control for the tagged-template form above: a callable that COULD
      // tag a template but does not is still only defined.
      templateTagNeverApplied: {
        config: `export const value = ((parts: TemplateStringsArray) => process.pid)`,
      },
      // `deferred` is sticky: an IIFE written INSIDE a closure runs only when
      // that closure is called, so the enclosing deferral still wins.
      iifeInsideADeferredClosure: { config: `export const value = () => (() => process.pid)()` },
      // An IIFE that RETURNS a closure ran the outer callable and not the inner
      // one, so only the outer body is charged — and it touches nothing.
      iifeReturningAnUninvokedClosure: { config: `export const value = (() => () => process.pid)()` },
      // The exemptions must survive the new boundary by construction: this is
      // the analyzer's one ambient table applied at a new node, never a second
      // table written for IIFEs.
      dateParseInsideAnIife: { config: `export const value = (() => Date.parse("2020-01-01"))()` },
      dateUtcInsideAnIife: { config: `export const value = (() => Date.UTC(2020, 0))()` },
      deterministicMathInsideAnIife: {
        config: `export const value = (() => Math.max(1, 2) + Math.PI)()`,
      },
      deterministicDateInsideAnIife: { config: `export const value = (() => new Date(0).getTime())()` },
      // A lexical shadow inside an IIFE is decided by the same
      // `isAmbientReference` the body walk uses, in both the `const` and the
      // parameter spelling.
      lexicalShadowInsideAnIife: {
        config: `export const value = (() => { const process = { pid: 7 }; return process.pid })()`,
      },
      shadowingParameterOfAnIife: {
        config: `export const value = ((process: { pid: number }) => process.pid)({ pid: 7 })`,
      },
      // An ordinary computed value behind parentheses must not become a
      // requirement just because parentheses are now walked through.
      parenthesizedOrdinaryValue: { config: `export const value = ((1 + 2) * 3)` },
      ordinaryIife: { config: `export const value = (() => 1 + 2)()` },
    };
    for (const [name, form] of Object.entries(ordinary)) {
      const sources: Record<string, string> = { "main.sm": form.main ?? READER };
      if (form.config !== undefined) sources["config.sm"] = form.config;
      const result = analyzeCompatibilityProject(sources);
      const actual = rowOf(result);
      expect([name, actual.requirements]).toEqual([name, []]);
      expect([name, actual.refused]).toEqual([name, []]);
      expect([name, result.functions["main.sm#pinned"]!.nativePinned]).toEqual([name, true]);
    }
  });

  test("the fix reaches the whole pipeline, and the frontend refuses it independently", () => {
    // End to end through `compileProject`, the same shape C50 pinned for the
    // plain initializer. Two independent components refuse this program: the
    // frontend rejects the ambient read in authored `.sm` (SMITHERS1601) and
    // the native pin fails on its own evidence (SMITHERS3001). Before this lane
    // only the frontend spoke, and the pin certified a host-dependent graph.
    const laundered = compileProject(
      [
        { fileName: "config.mod.sm", source: `export const pid = (() => process.pid)()\n` },
        {
          fileName: "main.sm",
          source: `import { pid } from "./config.mod.sm"
import { native } from "smithers:native"

export function hostBacked(): number {
  return pid
}

export function checksum(): number {
  return hostBacked()
}

native(checksum)
`,
        },
      ],
      { rootDir: "/smithers-iife-e2e", outDir: "/smithers-iife-e2e/out" },
    );
    expect(laundered.diagnostics.map((diagnostic) => diagnostic.code))
      .toEqual(["SMITHERS1601", "SMITHERS3001"]);
    expect(laundered.diagnostics.find((diagnostic) => diagnostic.code === "SMITHERS3001")?.message)
      .toBe(
        'native pin failed: Host<"process"> is required through ' +
          "main.sm#checksum -> main.sm#hostBacked -> config.mod.sm#pid -> process.pid",
      );

    // The clean control still compiles, so the pipeline is not simply refusing
    // every parenthesized or immediately invoked module-level expression.
    const clean = compileProject(
      [
        { fileName: "config.mod.sm", source: `export const size = (() => 4 * 1024)()\n` },
        {
          fileName: "main.sm",
          source: `import { size } from "./config.mod.sm"
import { native } from "smithers:native"

export function checksum(): number {
  return size
}

native(checksum)
`,
        },
      ],
      { rootDir: "/smithers-iife-e2e", outDir: "/smithers-iife-e2e/out" },
    );
    expect(clean.diagnostics).toEqual([]);
  });
});

/**
 * The last cluster of measured fail-opens: a requirement reachable through the
 * module LOAD graph, or through a callable the analyzer had to follow a binding,
 * a member, or another call to reach.
 *
 * The Locked rule decides both, and decides them without needing a new
 * agreement: "A native pin MUST be a checked assertion over the COMPLETE
 * TRANSITIVE GRAPH. Compilation MUST fail if ANY REACHABLE OPERATION or provider
 * requires `TypeScript`" (`specification/compatibility.mdx`, Native Pin).
 * Evaluating a module evaluates what it side-effect imports, and calling a
 * function runs its body however the callee was spelled — both are reachable
 * operations by the plain reading of that sentence.
 *
 * What was missing was not a decision about WHETHER but agreement about WHAT THE
 * GRAPH IS, and the frontend had already answered half of it: `resolveLocalCallee`
 * in `src/language/semantic.ts` resolves a call through
 * `checker.getResolvedSignature(call)?.declaration`, which is why its row for
 * `alias()` and for `holder.read()` was right while this file's was empty. The
 * classifier now asks the checker the same question.
 */
describe("the module load graph, and callables reached through a binding", () => {
  const PIN = `import { native } from "smithers:native"`;
  /** Reads a binding named `value` produced by `config.sm`. */
  const READER = `
    import { value } from "./config.sm"
    ${PIN}
    export function pinned(): unknown { return value }
    native(pinned)
  `;
  /** Pins a function that touches nothing itself, for the load-graph forms. */
  const INERT = `
    ${PIN}
    export function pinned(): number { return 1 }
    native(pinned)
  `;

  const rowOf = (result: ReturnType<typeof analyzeCompatibilityProject>): {
    requirements: string[];
    paths: Record<string, string[]>;
    refused: string[];
  } => ({
    requirements: result.functions["main.sm#pinned"]!.requirements,
    paths: result.functions["main.sm#pinned"]!.requirementPaths,
    refused: result.diagnostics.filter((diagnostic) => diagnostic.code === "SMITHERS3001")
      .map((diagnostic) => diagnostic.message),
  });

  test("the reproduction: the load graph and a module-level call each certified a live host read", () => {
    // A/B control one. Both programs load `node:fs` when `main.sm` is evaluated;
    // only the number of links differs, so they must reach the same verdict.
    const direct = analyzeCompatibilityProject({
      "main.sm": `import "node:fs"\n${INERT}`,
    });
    const throughAModule = analyzeCompatibilityProject({
      "a.sm": `import "node:fs"\nexport const marker = 1`,
      "main.sm": `import "./a.sm"\n${INERT}`,
    });
    expect(rowOf(direct)).toEqual({
      requirements: ['Module<"node:fs">'],
      paths: { 'Module<"node:fs">': ["main.sm#pinned"] },
      refused: ['native pin failed: Module<"node:fs"> is required through main.sm#pinned'],
    });
    expect(rowOf(throughAModule).requirements).toEqual(rowOf(direct).requirements);
    expect(rowOf(throughAModule)).toEqual({
      requirements: ['Module<"node:fs">'],
      // The route, not just the verdict: it names the module whose evaluation
      // pulled the edge in, and ends at the specifier to delete.
      paths: { 'Module<"node:fs">': ["main.sm#pinned", "a.sm", "node:fs"] },
      refused: [
        'native pin failed: Module<"node:fs"> is required through main.sm#pinned -> a.sm -> node:fs',
      ],
    });

    // A/B control two, the other half of the cluster: a module-level CALL. The
    // control proves the spelling is irrelevant — `helper()` and the authority
    // written straight into the initializer are the same host read.
    const written = analyzeCompatibilityProject({
      "config.sm": `export const value = process.pid`,
      "main.sm": READER,
    });
    const called = analyzeCompatibilityProject({
      "config.sm": `function helper(): unknown { return process.pid }\nexport const value = helper()`,
      "main.sm": READER,
    });
    expect(rowOf(called).requirements).toEqual(rowOf(written).requirements);
    expect(rowOf(called)).toEqual({
      requirements: ['Host<"process">'],
      paths: {
        'Host<"process">': ["main.sm#pinned", "config.sm#value", "config.sm#helper", "process.pid"],
      },
      refused: [
        'native pin failed: Host<"process"> is required through ' +
          "main.sm#pinned -> config.sm#value -> config.sm#helper -> process.pid",
      ],
    });

    // A/B control three, in the analyzed BODY walk: an object-literal method
    // invoked through a binding, against the same read written directly.
    const bodyDirect = analyzeCompatibilityProject({
      "main.sm": `${PIN}\nexport function pinned(): unknown { return process.pid }\nnative(pinned)`,
    });
    const bodyMethod = analyzeCompatibilityProject({
      "main.sm": `${PIN}
        export function pinned(): unknown {
          const holder = { read(): unknown { return process.pid } }
          return holder.read()
        }
        native(pinned)`,
    });
    expect(rowOf(bodyMethod).requirements).toEqual(rowOf(bodyDirect).requirements);
    expect(rowOf(bodyMethod).paths).toEqual({
      'Host<"process">': ["main.sm#pinned", "main.sm#read"],
    });
  });

  test("every module LOAD graph form is charged with the route it loads through", () => {
    // One table, one verdict per form. A module's EVALUATION is charged, not its
    // exports: the route names each module of the load chain and ends at the
    // foreign specifier, because the thing to delete is an import.
    const forms: Readonly<Record<string, {
      modules: Readonly<Record<string, string>>;
      main?: string;
      requirement: string;
      path: string[];
    }>> = {
      // The reported form, and the one C41 first named.
      sideEffectImportOfALoadingModule: {
        modules: { "a.sm": `import "node:fs"\nexport const marker = 1` },
        main: `import "./a.sm"\n${INERT}`,
        requirement: 'Module<"node:fs">',
        path: ["main.sm#pinned", "a.sm", "node:fs"],
      },
      // Two `.sm` modules deep: the chain, not just the first link.
      twoModulesDeep: {
        modules: {
          "b.sm": `import "node:fs"\nexport const marker = 1`,
          "a.sm": `import "./b.sm"\nexport const marker = 2`,
        },
        main: `import "./a.sm"\n${INERT}`,
        requirement: 'Module<"node:fs">',
        path: ["main.sm#pinned", "a.sm", "b.sm", "node:fs"],
      },
      // A laundered bare package, where the requirement name identifies nothing
      // and the route is the only thing naming the edge to delete.
      barePackageThroughAModule: {
        modules: { "a.sm": `import "left-pad"\nexport const marker = 1` },
        main: `import "./a.sm"\n${INERT}`,
        requirement: "TypeScript",
        path: ["main.sm#pinned", "a.sm", "left-pad"],
      },
      // Reading a BOUND binding evaluates its module just as surely, so the load
      // graph is charged at the hop the binding walk already crosses.
      boundImportOfALoadingModule: {
        modules: { "config.sm": `import "node:fs"\nexport const value = 1` },
        requirement: 'Module<"node:fs">',
        path: ["main.sm#pinned", "config.sm", "node:fs"],
      },
      namespaceReadOfALoadingModule: {
        modules: { "a.sm": `import "node:fs"\nexport function safe(): number { return 1 }` },
        main: `import * as a from "./a.sm"\n${PIN}
          export function pinned(): number { return a.safe() }
          native(pinned)`,
        requirement: 'Module<"node:fs">',
        path: ["main.sm#pinned", "a.sm", "node:fs"],
      },
      defaultImportOfALoadingModule: {
        modules: { "config.sm": `import "node:fs"\nexport default 1` },
        main: `import value from "./config.sm"\n${PIN}
          export function pinned(): unknown { return value }
          native(pinned)`,
        requirement: 'Module<"node:fs">',
        path: ["main.sm#pinned", "config.sm", "node:fs"],
      },
      // Composes with C41's re-export walk: the load graph of every project
      // module the binding walk crosses is charged, in order.
      throughAReExportChain: {
        modules: {
          "leaf.sm": `import "node:fs"\nexport const value = 1`,
          "config.sm": `export { value } from "./leaf.sm"`,
        },
        requirement: 'Module<"node:fs">',
        path: ["main.sm#pinned", "config.sm", "leaf.sm", "node:fs"],
      },
      throughAStarReExport: {
        modules: {
          "leaf.sm": `import "node:fs"\nexport const value = 1`,
          "config.sm": `export * from "./leaf.sm"`,
        },
        requirement: 'Module<"node:fs">',
        path: ["main.sm#pinned", "config.sm", "leaf.sm", "node:fs"],
      },
    };
    for (const [name, form] of Object.entries(forms)) {
      const sources: Record<string, string> = { ...form.modules, "main.sm": form.main ?? READER };
      const actual = rowOf(analyzeCompatibilityProject(sources));
      expect([name, actual.requirements]).toEqual([name, [form.requirement]]);
      expect([name, actual.paths[form.requirement]]).toEqual([name, form.path]);
      expect([name, actual.refused]).toEqual([name, [
        `native pin failed: ${form.requirement} is required through ${form.path.join(" -> ")}`,
      ]]);
    }
  });

  test("the load graph terminates on a cycle and still charges what the cycle reaches", () => {
    // The module load graph introduces cycles the binding walk never had. The
    // seen-set is a STACK, so re-entering a module the chain is already inside
    // stops that branch while the outer frame keeps enumerating that module's
    // remaining edges — which is why a foreign edge sitting BEHIND the cycle is
    // still charged rather than swallowed by the cycle guard.
    const twoModuleCycle = analyzeCompatibilityProject({
      "a.sm": `import "./b.sm"\nexport const marker = 1`,
      "b.sm": `import "./a.sm"\nimport "node:fs"\nexport const marker = 2`,
      "main.sm": `import "./a.sm"\n${INERT}`,
    });
    expect(rowOf(twoModuleCycle)).toEqual({
      requirements: ['Module<"node:fs">'],
      paths: { 'Module<"node:fs">': ["main.sm#pinned", "a.sm", "b.sm", "node:fs"] },
      refused: [
        'native pin failed: Module<"node:fs"> is required through main.sm#pinned -> a.sm -> b.sm -> node:fs',
      ],
    });

    // Three modules round, and a module that imports itself.
    const threeModuleCycle = analyzeCompatibilityProject({
      "a.sm": `import "./b.sm"\nexport const marker = 1`,
      "b.sm": `import "./c.sm"\nexport const marker = 2`,
      "c.sm": `import "./a.sm"\nimport "node:fs"\nexport const marker = 3`,
      "main.sm": `import "./a.sm"\n${INERT}`,
    });
    expect(rowOf(threeModuleCycle).paths['Module<"node:fs">'])
      .toEqual(["main.sm#pinned", "a.sm", "b.sm", "c.sm", "node:fs"]);
    const selfCycle = analyzeCompatibilityProject({
      "a.sm": `import "./a.sm"\nimport "node:fs"\nexport const marker = 1`,
      "main.sm": `import "./a.sm"\n${INERT}`,
    });
    expect(rowOf(selfCycle).paths['Module<"node:fs">'])
      .toEqual(["main.sm#pinned", "a.sm", "node:fs"]);

    // Termination is not "it charged something": a cycle with NO foreign edge
    // must finish and report nothing, keeping its pin.
    const cleanCycle = analyzeCompatibilityProject({
      "a.sm": `import "./b.sm"\nexport const marker = 1`,
      "b.sm": `import "./a.sm"\nexport const marker = 2`,
      "main.sm": `import "./a.sm"\n${INERT}`,
    });
    expect(rowOf(cleanCycle)).toEqual({ requirements: [], paths: {}, refused: [] });
    expect(cleanCycle.functions["main.sm#pinned"]!.nativePinned).toBe(true);

    // A recursive and a mutually recursive callable terminate too, and are still
    // charged: the entered-callable set is monotone rather than stack-shaped,
    // because a callable contributes the same row however it was reached.
    const recursive = analyzeCompatibilityProject({
      "config.sm": `
        function helper(n: number): unknown { return n > 0 ? helper(n - 1) : process.pid }
        export const value = helper(2)
      `,
      "main.sm": READER,
    });
    expect(rowOf(recursive).paths['Host<"process">'])
      .toEqual(["main.sm#pinned", "config.sm#value", "config.sm#helper", "process.pid"]);
    const mutual = analyzeCompatibilityProject({
      "config.sm": `
        function first(n: number): unknown { return n > 0 ? second(n - 1) : process.pid }
        function second(n: number): unknown { return first(n) }
        export const value = first(2)
      `,
      "main.sm": READER,
    });
    expect(rowOf(mutual).requirements).toEqual(['Host<"process">']);
    const recursiveBody = analyzeCompatibilityProject({
      "main.sm": `${PIN}
        export function pinned(): unknown {
          const step = (n: number): unknown => n > 0 ? step(n - 1) : process.pid
          return step(2)
        }
        native(pinned)`,
    });
    expect(rowOf(recursiveBody).paths).toEqual({
      'Host<"process">': ["main.sm#pinned", "main.sm#step"],
    });
  });

  test("every callable reached through a binding, a member, or a call is charged where it runs", () => {
    // The remaining three fail-opens as one table: module-level calls, indirect
    // and higher-order calls, and object-literal/class methods. Each form runs a
    // body this analyzer can see, and each charged nothing before.
    const forms: Readonly<Record<string, {
      config?: string;
      main?: string;
      requirement: string;
      path: string[];
    }>> = {
      // --- module-level calls (C52's form 19) ---
      moduleLevelCall: {
        config: `function helper(): unknown { return process.pid }\nexport const value = helper()`,
        requirement: 'Host<"process">',
        path: ["main.sm#pinned", "config.sm#value", "config.sm#helper", "process.pid"],
      },
      moduleLevelCallTwoHopsDeep: {
        config: `
          function leaf(): unknown { return process.pid }
          function helper(): unknown { return leaf() }
          export const value = helper()
        `,
        requirement: 'Host<"process">',
        path: [
          "main.sm#pinned",
          "config.sm#value",
          "config.sm#helper",
          "config.sm#leaf",
          "process.pid",
        ],
      },
      moduleLevelCallIntoAnArrowBinding: {
        config: `const helper = (): unknown => process.pid\nexport const value = helper()`,
        requirement: 'Host<"process">',
        path: ["main.sm#pinned", "config.sm#value", "config.sm#helper", "process.pid"],
      },
      moduleLevelCallReachingAForeignModule: {
        config: `
          import { readFileSync } from "node:fs"
          function helper(): unknown { return readFileSync("x") }
          export const value = helper()
        `,
        requirement: 'Module<"node:fs">',
        path: ["main.sm#pinned", "config.sm", "node:fs"],
      },
      // --- indirect and higher-order calls ---
      calledThroughABinding: {
        main: `${PIN}
          export function pinned(): unknown { const f = (): unknown => process.pid; return f() }
          native(pinned)`,
        requirement: 'Host<"process">',
        path: ["main.sm#pinned", "main.sm#f"],
      },
      nestedFunctionDeclarationInvoked: {
        main: `${PIN}
          export function pinned(): unknown {
            function inner(): unknown { return process.pid }
            return inner()
          }
          native(pinned)`,
        requirement: 'Host<"process">',
        path: ["main.sm#pinned", "main.sm#inner"],
      },
      higherOrderReturningAnInvokedClosure: {
        main: `${PIN}
          export function pinned(): unknown {
            const make = () => (): unknown => process.pid
            return make()()
          }
          native(pinned)`,
        requirement: 'Host<"process">',
        // The returned closure is anonymous, so the route reports what it can
        // prove rather than inventing a name.
        path: ["main.sm#pinned"],
      },
      importedArrowInvoked: {
        config: `export const f = (): unknown => process.pid`,
        main: `import { f } from "./config.sm"\n${PIN}
          export function pinned(): unknown { return f() }
          native(pinned)`,
        requirement: 'Host<"process">',
        path: ["main.sm#pinned", "config.sm#f"],
      },
      // C52 charged `.call` where the callable is WRITTEN at the call; the same
      // invocation reached through a binding was not — the same authority and
      // the same invocation with opposite verdicts.
      appliedThroughABinding: {
        main: `${PIN}
          export function pinned(): unknown {
            const f = (): unknown => process.pid
            return f.call(null)
          }
          native(pinned)`,
        requirement: 'Host<"process">',
        path: ["main.sm#pinned", "main.sm#f"],
      },
      boundThroughABindingThenInvoked: {
        main: `${PIN}
          export function pinned(): unknown {
            const f = (): unknown => process.pid
            return f.bind(null)()
          }
          native(pinned)`,
        requirement: 'Host<"process">',
        path: ["main.sm#pinned", "main.sm#f"],
      },
      evalInsideACallableReachedThroughABinding: {
        main: `${PIN}
          export function pinned(): unknown {
            const f = (source: string): unknown => eval(source)
            return f("1")
          }
          native(pinned)`,
        requirement: "TypeScript",
        path: ["main.sm#pinned", "main.sm#f"],
      },
      // --- object-literal and class methods ---
      objectLiteralMethodAtItsLiteral: {
        main: `${PIN}
          export function pinned(): unknown { return ({ m(): unknown { return process.pid } }).m() }
          native(pinned)`,
        requirement: 'Host<"process">',
        path: ["main.sm#pinned", "main.sm#m"],
      },
      objectLiteralMethodThroughABinding: {
        main: `${PIN}
          export function pinned(): unknown {
            const holder = { m(): unknown { return process.pid } }
            return holder.m()
          }
          native(pinned)`,
        requirement: 'Host<"process">',
        path: ["main.sm#pinned", "main.sm#m"],
      },
      objectLiteralMethodInAModuleInitializer: {
        config: `const holder = { m(): unknown { return process.pid } }\nexport const value = holder.m()`,
        requirement: 'Host<"process">',
        path: ["main.sm#pinned", "config.sm#value", "config.sm#m", "process.pid"],
      },
      classStaticMethodInvoked: {
        main: `${PIN}
          export function pinned(): unknown {
            class C { static m(): unknown { return process.pid } }
            return C.m()
          }
          native(pinned)`,
        requirement: 'Host<"process">',
        path: ["main.sm#pinned", "main.sm#m"],
      },
      classInstanceMethodInvoked: {
        main: `${PIN}
          export function pinned(): unknown {
            class C { m(): unknown { return process.pid } }
            return new C().m()
          }
          native(pinned)`,
        requirement: 'Host<"process">',
        path: ["main.sm#pinned", "main.sm#m"],
      },
      // A getter looks like a field read and executes a body.
      getterReadByPropertyAccess: {
        main: `${PIN}
          export function pinned(): unknown {
            const holder = { get g(): unknown { return process.pid } }
            return holder.g
          }
          native(pinned)`,
        requirement: 'Host<"process">',
        path: ["main.sm#pinned", "main.sm#g"],
      },
      getterInAModuleInitializer: {
        config: `const holder = { get g(): unknown { return process.pid } }\nexport const value = holder.g`,
        requirement: 'Host<"process">',
        path: ["main.sm#pinned", "config.sm#value", "config.sm#g", "process.pid"],
      },
      importedGetterRead: {
        config: `export const holder = { get g(): unknown { return process.pid } }`,
        main: `import { holder } from "./config.sm"\n${PIN}
          export function pinned(): unknown { return holder.g }
          native(pinned)`,
        requirement: 'Host<"process">',
        path: ["main.sm#pinned", "config.sm#g"],
      },
    };
    for (const [name, form] of Object.entries(forms)) {
      const sources: Record<string, string> = { "main.sm": form.main ?? READER };
      if (form.config !== undefined) sources["config.sm"] = form.config;
      const result = analyzeCompatibilityProject(sources);
      const actual = rowOf(result);
      expect([name, actual.requirements]).toEqual([name, [form.requirement]]);
      expect([name, actual.paths[form.requirement]]).toEqual([name, form.path]);
      expect([name, actual.refused]).toEqual([name, [
        `native pin failed: ${form.requirement} is required through ${form.path.join(" -> ")}`,
      ]]);
    }
  });

  test("a call to an ANALYZED function still arrives through the call graph, not by inlining", () => {
    // The retained path is the one that names the callee function, and it must
    // not be replaced by a shorter one recorded a hop earlier. Three spellings
    // of the same call — direct, through a local alias, and through a namespace
    // — all report the callee, because the fix resolves the callee rather than
    // flattening it into the caller.
    const direct = analyzeCompatibilityProject({
      "main.sm": `${PIN}
        export function reads(): unknown { return process.pid }
        export function pinned(): unknown { return reads() }
        native(pinned)`,
    });
    expect(rowOf(direct).paths).toEqual({
      'Host<"process">': ["main.sm#pinned", "main.sm#reads"],
    });
    const aliased = analyzeCompatibilityProject({
      "main.sm": `${PIN}
        export function reads(): unknown { return process.pid }
        export function pinned(): unknown { const alias = reads; return alias() }
        native(pinned)`,
    });
    expect(rowOf(aliased).paths).toEqual(rowOf(direct).paths);
    const namespaced = analyzeCompatibilityProject({
      "reader.sm": `export function reads(): unknown { return process.pid }`,
      "main.sm": `import * as reader from "./reader.sm"\n${PIN}
        export function pinned(): unknown { return reader.reads() }
        native(pinned)`,
    });
    expect(rowOf(namespaced).paths).toEqual({
      'Host<"process">': ["main.sm#pinned", "reader.sm#reads"],
    });
  });

  test("a blocking requirement is never lost behind a non-blocking one through a call", () => {
    // C50's accumulation rule, carried through the new hops. `Clock` is reached
    // first and does not block; keeping only the first hit would grant the pin
    // the callee forbids.
    const both = analyzeCompatibilityProject({
      "config.sm": `
        function helper(): unknown { return { at: Date.now(), pid: process.pid } }
        export const value = helper()
      `,
      "main.sm": READER,
    });
    expect(rowOf(both).requirements).toEqual(["Clock", 'Host<"process">']);
    expect(rowOf(both).paths).toEqual({
      Clock: ["main.sm#pinned", "config.sm#value", "config.sm#helper", "Date.now"],
      'Host<"process">': ["main.sm#pinned", "config.sm#value", "config.sm#helper", "process.pid"],
    });
    expect(rowOf(both).refused).toEqual([
      'native pin failed: Host<"process"> is required through ' +
        "main.sm#pinned -> config.sm#value -> config.sm#helper -> process.pid",
    ]);

    // The same in a body, through a method: the non-blocking row is reported and
    // the blocking one still refuses.
    const inABody = analyzeCompatibilityProject({
      "main.sm": `${PIN}
        export function pinned(): unknown {
          const holder = { m(): unknown { return { at: Date.now(), pid: process.pid } } }
          return holder.m()
        }
        native(pinned)`,
    });
    expect(rowOf(inABody).requirements).toEqual(["Clock", 'Host<"process">']);
    expect(rowOf(inABody).refused).toEqual([
      'native pin failed: Host<"process"> is required through main.sm#pinned -> main.sm#m',
    ]);
  });

  test("the negative direction: naming, storing, and passing a callable stay ordinary", () => {
    // The direction this file has got wrong FIVE times. Every row must stay
    // requirement-free AND keep its pin. Written in the same block as the
    // refusals above, not bolted on afterwards.
    const ordinary: Readonly<Record<string, { config?: string; main?: string }>> = {
      // THE PROTECTED ASSERTION. If this row ever charges, the fix has become a
      // definition rule and is wrong.
      deferredClosure: {
        main: `${PIN}
          export function pinned(): unknown { const deferred = () => window.location; return deferred }
          native(pinned)`,
      },
      deferredInAnInitializer: { config: `export const value = () => process.pid` },
      // A callable NAMED but not called, in each of the shapes the resolution
      // above now reaches.
      methodNamedNotCalled: {
        main: `${PIN}
          export function pinned(): unknown {
            const holder = { m(): unknown { return process.pid } }
            return typeof holder.m
          }
          native(pinned)`,
      },
      methodPassedAsAnArgument: {
        main: `${PIN}
          function keep(callback: () => unknown): () => unknown { return callback }
          export function pinned(): unknown {
            const holder = { m(): unknown { return process.pid } }
            return keep(holder.m)
          }
          native(pinned)`,
      },
      objectLiteralMerelyBuilt: {
        main: `${PIN}
          export function pinned(): unknown { return { m(): unknown { return process.pid } } }
          native(pinned)`,
      },
      classMerelyDeclared: {
        main: `${PIN}
          export function pinned(): unknown { class C { m(): unknown { return process.pid } } return C }
          native(pinned)`,
      },
      getterMerelyDefined: {
        main: `${PIN}
          export function pinned(): unknown {
            const holder = { get g(): unknown { return process.pid } }
            return typeof holder
          }
          native(pinned)`,
      },
      // The higher-order pair: the factory RAN, the closure it returned did not.
      factoryCalledButClosureNotInvoked: {
        config: `const make = () => (): unknown => process.pid\nexport const value = make()`,
      },
      // The `.map`/`keep` symmetry, both halves, and it is still what draws the
      // boundary. `keep`'s VISIBLE BODY never invokes its parameter, so nothing
      // the caller handed it runs; `Array.prototype.map` has NO visible body, so
      // what it does with its argument is undecidable here. Neither charges, and
      // neither needs a rule about arguments — the twin that DOES charge
      // (`run(cb)`, whose body calls `cb()`) is asserted in the value-flow block
      // below, and the three are separated by what their bodies do rather than
      // by any host knowledge about `Array.prototype`.
      callbackKeptButNeverInvoked: {
        main: `${PIN}
          function keep(callback: () => unknown): () => unknown { return callback }
          export function pinned(): unknown { return keep(() => process.pid) }
          native(pinned)`,
      },
      callbackPassedToMap: {
        main: `${PIN}
          export function pinned(): unknown { return [1].map(() => process.pid) }
          native(pinned)`,
      },
      // A module-level call that touches nothing must not become a requirement
      // just because module-level calls are now followed.
      moduleLevelCallToAPureFunction: {
        config: `function helper(): number { return 4 * 1024 }\nexport const value = helper()`,
      },
      // A module-level function merely REFERENCED is not run.
      moduleLevelFunctionReference: {
        config: `function helper(): unknown { return process.pid }\nexport const value = helper`,
      },
      // The exemptions survive by construction inside an entered callable: this
      // is the analyzer's one ambient table applied at a new node.
      dateParseInsideAnEnteredCallable: {
        config: `function helper(): number { return Date.parse("2020-01-01") }\nexport const value = helper()`,
      },
      dateUtcInsideAnEnteredCallable: {
        main: `${PIN}
          export function pinned(): number { const f = () => Date.UTC(2020, 0); return f() }
          native(pinned)`,
      },
      deterministicMathInsideAnEnteredCallable: {
        main: `${PIN}
          export function pinned(): number { const f = () => Math.max(1, 2) + Math.PI; return f() }
          native(pinned)`,
      },
      deterministicDateInsideAnEnteredCallable: {
        main: `${PIN}
          export function pinned(): number { const f = () => new Date(0).getTime(); return f() }
          native(pinned)`,
      },
      lexicalShadowInsideAnEnteredCallable: {
        main: `${PIN}
          export function pinned(): unknown {
            const f = () => { const process = { pid: 7 }; return process.pid }
            return f()
          }
          native(pinned)`,
      },
      // `.bind` alone runs nothing, through a binding exactly as at a literal.
      boundThroughABindingButNeverInvoked: {
        main: `${PIN}
          export function pinned(): unknown { const f = () => process.pid; return f.bind(null) }
          native(pinned)`,
      },
      // --- the load graph's own negatives ---
      // A side-effect import of a CLEAN project module charges nothing, so the
      // load graph is not "any module edge anywhere".
      sideEffectImportOfACleanModule: {
        config: `export const value = 1`,
        main: `import "./config.sm"\n${INERT}`,
      },
      // Locked: a type-only import adds no runtime requirement, and it does not
      // evaluate the module either.
      typeOnlyImportOfALoadingModule: {
        config: `import "node:fs"\nexport type Marker = number`,
        main: `import type { Marker } from "./config.sm"\n${INERT}`,
      },
      // A compiler-owned virtual module has no load graph to follow.
      compilerOwnedSideEffectImport: { main: `import "smithers:comptime"\n${INERT}` },
      // NAME-DIRECTED, C41's precision: a module that re-exports `node:fs` does
      // not become foreign wholesale, because a re-export publishes an elidable
      // binding rather than evaluating anything the reader did not ask for.
      reExportOfAForeignModuleReadCleanly: {
        config: `
          export { readFileSync } from "node:fs"
          export function safe(): number { return 1 }
        `,
        main: `import { safe } from "./config.sm"\n${PIN}
          export function pinned(): number { return safe() }
          native(pinned)`,
      },
      // A BOUND foreign import nobody reads is elidable, and the analyzer has
      // always said so for a file's own imports; being stricter about another
      // module's unread binding than about your own would be incoherent in the
      // opposite direction.
      unreadBoundImportInALoadedModule: {
        config: `import { readFileSync } from "node:fs"\nexport const value = 1`,
        main: `import "./config.sm"\n${INERT}`,
      },
    };
    for (const [name, form] of Object.entries(ordinary)) {
      const sources: Record<string, string> = { "main.sm": form.main ?? READER };
      if (form.config !== undefined) sources["config.sm"] = form.config;
      const result = analyzeCompatibilityProject(sources);
      const actual = rowOf(result);
      expect([name, actual.requirements]).toEqual([name, []]);
      expect([name, actual.refused]).toEqual([name, []]);
      expect([name, result.functions["main.sm#pinned"]!.nativePinned]).toEqual([name, true]);
    }
  });

  test("the fix reaches the whole pipeline, and the frontend refuses it independently", () => {
    // End to end through `compileProject`, in both halves of the cluster. Two
    // independent components refuse each program, and the pin refuses on its OWN
    // evidence with the complete route — the property that survives either
    // component being relaxed.
    const loaded = compileProject(
      [
        { fileName: "loader.mod.sm", source: `import "node:fs"\n\nexport const marker = 1\n` },
        {
          fileName: "main.sm",
          source: `import "./loader.mod.sm"
import { native } from "smithers:native"

export function checksum(): number {
  return 7
}

native(checksum)
`,
        },
      ],
      { rootDir: "/smithers-load-e2e", outDir: "/smithers-load-e2e/out" },
    );
    expect(loaded.diagnostics.map((diagnostic) => diagnostic.code))
      .toEqual(["SMITHERS1510", "SMITHERS3001"]);
    expect(loaded.diagnostics.find((diagnostic) => diagnostic.code === "SMITHERS3001")?.message)
      .toBe(
        'native pin failed: Module<"node:fs"> is required through ' +
          "main.sm#checksum -> loader.mod.sm -> node:fs",
      );

    const called = compileProject(
      [
        {
          fileName: "config.mod.sm",
          source: `function readPid(): number {
  return process.pid
}

export const pid = readPid()
`,
        },
        {
          fileName: "main.sm",
          source: `import { pid } from "./config.mod.sm"
import { native } from "smithers:native"

export function hostBacked(): number {
  return pid
}

export function checksum(): number {
  return hostBacked()
}

native(checksum)
`,
        },
      ],
      { rootDir: "/smithers-call-e2e", outDir: "/smithers-call-e2e/out" },
    );
    expect(called.diagnostics.map((diagnostic) => diagnostic.code))
      .toEqual(["SMITHERS1601", "SMITHERS3001"]);
    expect(called.diagnostics.find((diagnostic) => diagnostic.code === "SMITHERS3001")?.message)
      .toBe(
        'native pin failed: Host<"process"> is required through ' +
          "main.sm#checksum -> main.sm#hostBacked -> config.mod.sm#pid -> config.mod.sm#readPid -> process.pid",
      );

    // The clean control still compiles with ZERO diagnostics, so the pipeline is
    // not simply refusing every side-effect import or every module-level call.
    const clean = compileProject(
      [
        { fileName: "loader.mod.sm", source: `export const marker = 1\n` },
        {
          fileName: "main.sm",
          source: `import "./loader.mod.sm"
import { native } from "smithers:native"

export function checksum(): number {
  return 7
}

native(checksum)
`,
        },
      ],
      { rootDir: "/smithers-load-e2e", outDir: "/smithers-load-e2e/out" },
    );
    expect(clean.diagnostics).toEqual([]);
  });
});

/**
 * The last two tractable fail-opens of the callable boundary.
 *
 * Both were entries in `classify.ts`'s hazard log with a `MEASURED:` verdict:
 * `Layer.provide(layer, () => process.pid)` charged nothing and kept its pin,
 * and so did every callable whose selected signature has no visible body but
 * whose VALUE the analyzer can follow. They are closed by two different
 * mechanisms because they are two different questions, and the difference is the
 * whole reason the `.map`/`keep` symmetry survives:
 *
 * - VALUE FLOW enters the callee's visible body and charges only what that body
 *   actually invokes. `run(cb)` charges because `run` calls `cb()`; `keep(cb)`
 *   does not because `keep` only returns it; `[1].map(cb)` stays undecidable
 *   because `lib.d.ts` has no body to read. No rule about arguments, and no
 *   table of host knowledge about `Array.prototype`.
 * - LAYER PROVISION is a Locked compiler recognition of one compiler-owned
 *   symbol ("Layer APIs are library-shaped; the compiler recognizes their effect
 *   on `R`"), so the callback runs and the layer's capabilities are subtracted.
 *   A user's own `Layer.provide` resolves to a different symbol and stays as
 *   ordinary as `keep`.
 */
describe("value flow into a callee's body, and Layer provision", () => {
  const PIN = `import { native } from "smithers:native"`;
  const CAPABILITY = `
    import { Context } from "smthrs/context"
    import { Layer } from "smthrs/provider"
    abstract class Config extends Context { abstract readonly retries: number }
    abstract class Other extends Context { abstract readonly n: number }
  `;

  const rowOf = (source: string, name = "pinned"): {
    requirements: string[];
    paths: Record<string, string[]>;
    refused: string[];
  } => {
    const result = analyzeCompatibility(source);
    return {
      requirements: result.functions[name]!.requirements,
      paths: result.functions[name]!.requirementPaths,
      refused: result.diagnostics.filter((diagnostic) => diagnostic.code === "SMITHERS3001")
        .map((diagnostic) => diagnostic.message),
    };
  };
  const pinKept = (source: string, name = "pinned"): boolean =>
    analyzeCompatibility(source).functions[name]!.nativePinned;

  test("the reproduction: three identical shapes, and only the one whose callee runs it charges", () => {
    // A/B/C control. The three call sites are syntactically the same — a
    // callable handed to a call — and the verdicts must differ ONLY by what the
    // callee's own body does with it.
    const invoked = `${PIN}
      function run(callback: () => unknown): unknown { return callback() }
      export function pinned(): unknown { return run(() => process.pid) }
      native(pinned)`;
    const kept = `${PIN}
      function keep(callback: () => unknown): () => unknown { return callback }
      export function pinned(): unknown { return keep(() => process.pid) }
      native(pinned)`;
    const mapped = `${PIN}
      export function pinned(): unknown { return [1].map(() => process.pid) }
      native(pinned)`;

    expect(rowOf(invoked)).toEqual({
      requirements: ['Host<"process">'],
      paths: { 'Host<"process">': ["pinned", "run"] },
      refused: ['native pin failed: Host<"process"> is required through pinned -> run'],
    });
    // The mandated negative, and its no-visible-body twin. Neither charges, and
    // the pin is GRANTED for both.
    expect(rowOf(kept)).toEqual({ requirements: [], paths: {}, refused: [] });
    expect(rowOf(mapped)).toEqual({ requirements: [], paths: {}, refused: [] });
    expect([pinKept(invoked), pinKept(kept), pinKept(mapped)]).toEqual([true, true, true]);

    // And the same read written directly, so the charged verdict is the one the
    // program really earns rather than an artefact of the new walk.
    const direct = `${PIN}
      export function pinned(): unknown { return process.pid }
      native(pinned)`;
    expect(rowOf(direct).requirements).toEqual(rowOf(invoked).requirements);
  });

  test("the reproduction: a Layer.provide callback certified a live host read", () => {
    // A/B control. The same expression inside a provide body and outside it.
    const provided = `${PIN}
      ${CAPABILITY}
      export function pinned(): unknown {
        const layer = Layer.succeed(Config, { retries: 1 })
        return Layer.provide(layer, () => process.pid)
      }
      native(pinned)`;
    const direct = `${PIN}
      export function pinned(): unknown { return process.pid }
      native(pinned)`;
    expect(rowOf(provided).requirements).toEqual(rowOf(direct).requirements);
    expect(rowOf(provided)).toEqual({
      requirements: ['Host<"process">'],
      paths: { 'Host<"process">': ["pinned"] },
      refused: ['native pin failed: Host<"process"> is required through pinned'],
    });

    // A user's own `Layer.provide` is NOT the compiler-owned one: recognition is
    // checker symbol identity, never the spelling, so this callback stays as
    // unentered as `keep`'s.
    const impostor = `${PIN}
      const Layer = { provide(layer: unknown, body: () => unknown): () => unknown { return body } }
      export function pinned(): unknown { return Layer.provide(1, () => process.pid) }
      native(pinned)`;
    expect(rowOf(impostor)).toEqual({ requirements: [], paths: {}, refused: [] });
    expect(pinKept(impostor)).toBe(true);
  });

  test("value flow charges exactly what the callee's visible body invokes", () => {
    const charging: Record<string, { source: string; requirement: string; path: string[] }> = {
      // The reported form.
      calleeInvokesItsParameter: {
        source: `function run(cb: () => unknown): unknown { return cb() }
          export function pinned(): unknown { return run(() => process.pid) }`,
        requirement: 'Host<"process">',
        path: ["pinned", "run"],
      },
      calleeInvokesItConditionally: {
        source: `function run(flag: boolean, cb: () => unknown): unknown { if (flag) { return cb() } return 0 }
          export function pinned(): unknown { return run(true, () => process.pid) }`,
        requirement: 'Host<"process">',
        path: ["pinned", "run"],
      },
      calleeInvokesItTwice: {
        source: `function run(cb: () => unknown): unknown { cb(); return cb() }
          export function pinned(): unknown { return run(() => process.pid) }`,
        requirement: 'Host<"process">',
        path: ["pinned", "run"],
      },
      // Two hops of value flow: the callee hands it on to another visible body.
      calleePassesItOn: {
        source: `function inner(cb: () => unknown): unknown { return cb() }
          function outer(cb: () => unknown): unknown { return inner(cb) }
          export function pinned(): unknown { return outer(() => process.pid) }`,
        requirement: 'Host<"process">',
        path: ["pinned", "outer", "inner"],
      },
      calleeStoresItInALocal: {
        source: `function run(cb: () => unknown): unknown { const g = cb; return g() }
          export function pinned(): unknown { return run(() => process.pid) }`,
        requirement: 'Host<"process">',
        path: ["pinned", "run"],
      },
      calleeInvokesItThroughCall: {
        source: `function run(cb: () => unknown): unknown { return cb.call(null) }
          export function pinned(): unknown { return run(() => process.pid) }`,
        requirement: 'Host<"process">',
        path: ["pinned", "run"],
      },
      calleeInvokesItOptionally: {
        source: `function run(cb?: () => unknown): unknown { return cb?.() }
          export function pinned(): unknown { return run(() => process.pid) }`,
        requirement: 'Host<"process">',
        path: ["pinned", "run"],
      },
      calleeIsAnArrowConst: {
        source: `const run = (cb: () => unknown): unknown => cb()
          export function pinned(): unknown { return run(() => process.pid) }`,
        requirement: 'Host<"process">',
        path: ["pinned", "run"],
      },
      calleeIsAnObjectMethod: {
        source: `const runner = { run(cb: () => unknown): unknown { return cb() } }
          export function pinned(): unknown { return runner.run(() => process.pid) }`,
        requirement: 'Host<"process">',
        path: ["pinned", "run"],
      },
      // The callback is a NAMED analyzed function, so it travels the call graph
      // and the route names it rather than the callee that ran it.
      callbackIsAnAnalyzedFunction: {
        source: `export function reads(): unknown { return process.pid }
          function run(cb: () => unknown): unknown { return cb() }
          export function pinned(): unknown { return run(reads) }`,
        requirement: 'Host<"process">',
        path: ["pinned", "reads"],
      },
      // The callback itself takes a callback: value flow through two frames.
      nestedValueFlow: {
        source: `function run(cb: (inner: () => unknown) => unknown): unknown { return cb(() => process.pid) }
          export function pinned(): unknown { return run((f) => f()) }`,
        requirement: 'Host<"process">',
        path: ["pinned", "run"],
      },
      // An OBJECT reaching a parameter is the same question about a different
      // value: which literal the method that ran belongs to.
      objectReachesAParameter: {
        source: `interface Reader { read(): unknown }
          function run(r: Reader): unknown { return r.read() }
          export function pinned(): unknown { return run({ read(): unknown { return process.pid } }) }`,
        requirement: 'Host<"process">',
        path: ["pinned", "run", "read"],
      },
      // The ANNOTATED binding: the checker selects `Reader.read`, which has no
      // body; the literal the binding holds does.
      annotatedBindingHoldsTheMethod: {
        source: `interface Reader { read(): unknown }
          export function pinned(): unknown {
            const holder: Reader = { read(): unknown { return process.pid } }
            return holder.read()
          }`,
        requirement: 'Host<"process">',
        path: ["pinned", "read"],
      },
      annotatedBindingHoldsAPropertyArrow: {
        source: `interface Reader { read: () => unknown }
          export function pinned(): unknown {
            const holder: Reader = { read: (): unknown => process.pid }
            return holder.read()
          }`,
        requirement: 'Host<"process">',
        path: ["pinned", "read"],
      },
      // `{ read }` publishes whatever the binding holds, so the shorthand is the
      // same question with the value written one line earlier.
      annotatedBindingHoldsAShorthandMember: {
        source: `interface Reader { read(): unknown }
          export function pinned(): unknown {
            const read = (): unknown => process.pid
            const holder: Reader = { read }
            return holder.read()
          }`,
        requirement: 'Host<"process">',
        path: ["pinned", "read"],
      },
      calleeBoxesItThenInvokesIt: {
        source: `function run(cb: () => unknown): unknown { const box = { cb }; return box.cb() }
          export function pinned(): unknown { return run(() => process.pid) }`,
        requirement: 'Host<"process">',
        path: ["pinned", "run"],
      },
      annotatedBindingReachesAModuleEdge: {
        source: `import { readFileSync } from "node:fs"
          interface Reader { read(): unknown }
          export function pinned(): unknown {
            const holder: Reader = { read(): unknown { return readFileSync("x") } }
            return holder.read()
          }`,
        requirement: 'Module<"node:fs">',
        path: ["pinned", "read"],
      },
      // A parameter DEFAULT that is a visible callable runs when the argument is
      // omitted, which is the same reason the default's own expression is
      // already part of this function's row.
      parameterDefaultIsAVisibleCallable: {
        source: `export function pinned(g: () => unknown = () => process.pid): unknown { return g() }`,
        requirement: 'Host<"process">',
        path: ["pinned"],
      },
    };

    for (const [name, form] of Object.entries(charging)) {
      const source = `${PIN}\n${form.source}\nnative(pinned)`;
      const row = rowOf(source);
      expect([name, row.requirements]).toEqual([name, [form.requirement]]);
      expect([name, row.paths[form.requirement]]).toEqual([name, form.path]);
      expect([name, row.refused]).toEqual([
        name,
        [`native pin failed: ${form.requirement} is required through ${form.path.join(" -> ")}`],
      ]);
    }
  });

  test("the negative direction: a callable a body never invokes stays ordinary", () => {
    const ordinary: Record<string, string> = {
      // The mandated negative, stated here as well as in the block above,
      // because it is the assertion that decides whether the rule is right.
      keptButNeverInvoked: `function keep(cb: () => unknown): () => unknown { return cb }
        export function pinned(): unknown { return keep(() => process.pid) }`,
      // Its no-visible-body twin, unchanged and still undecidable.
      passedToMap: `export function pinned(): unknown { return [1].map(() => process.pid) }`,
      returnedUninvoked: `function hand(cb: () => unknown): () => unknown { return cb }
        export function pinned(): unknown { return hand(() => process.pid) }`,
      storedOnAnObject: `function box(cb: () => unknown): unknown { return { cb } }
        export function pinned(): unknown { return box(() => process.pid) }`,
      // BUILDING a closure around it is not running it: the deferred rule holds
      // inside a callee's body exactly as it does in the pinned body.
      wrappedInAClosureTheCalleeReturns: `function later(cb: () => unknown): () => unknown { return () => cb() }
        export function pinned(): unknown { return later(() => process.pid) }`,
      // Mutual recursion that never invokes the parameter must terminate AND
      // stay ordinary; terminating by charging everything would prove nothing.
      mutuallyRecursiveButNeverInvoked: `function a(n: number, cb: () => unknown): unknown { if (n > 0) { b(n - 1, cb) } return 0 }
        function b(n: number, cb: () => unknown): unknown { if (n > 0) { a(n - 1, cb) } return 1 }
        export function pinned(): unknown { return a(2, () => process.pid) }`,
      // The parameter default is only a value until something invokes it.
      parameterDefaultNeverInvoked: `export function pinned(g: () => unknown = () => process.pid): unknown { return g }`,
      // An OPAQUE default resolves to no visible callable, so it stays exactly
      // where the no-visible-body boundary leaves it.
      parameterDefaultIsOpaque: `declare const opaque: () => unknown
        export function pinned(g: () => unknown = opaque): unknown { return g() }`,
      // A call RESULT is now followed to the callable its callee returns, so the
      // entry that used to sit here (`run(make())` asserted to require nothing)
      // was a recorded FAIL-OPEN rather than a negative — C55's own §7 listed it
      // as open residue R2. It has moved to the charging table of the block that
      // closed it. What belongs here is the boundary it stood next to: following
      // a factory's return is still not INVOKING what it returns.
      aCallResultNeverInvoked: `function make(): () => unknown { return () => process.pid }
        function keep(cb: () => unknown): () => unknown { return cb }
        export function pinned(): unknown { return keep(make()) }`,
      // Naming a method reached through an annotated binding is still not using
      // it, in the shape the new resolution now reaches.
      annotatedMethodNamedNotCalled: `interface Reader { read(): unknown }
        function keep(cb: () => unknown): () => unknown { return cb }
        export function pinned(): unknown {
          const holder: Reader = { read(): unknown { return process.pid } }
          return keep(holder.read)
        }`,
      annotatedBindingWithACleanMethod: `interface Reader { read(): number }
        export function pinned(): number {
          const holder: Reader = { read(): number { return 1 } }
          return holder.read()
        }`,
      // Every protected negative, re-asserted INSIDE a callee entered by value
      // flow: the walk moved, the classification did not.
      dateParseInsideAFlowedCallable: `function run(cb: () => number): number { return cb() }
        export function pinned(): number { return run(() => Date.parse("2020-01-01")) }`,
      dateUtcInsideAFlowedCallable: `function run(cb: () => number): number { return cb() }
        export function pinned(): number { return run(() => Date.UTC(2020, 0)) }`,
      newDateZeroInsideAFlowedCallable: `function run(cb: () => number): number { return cb() }
        export function pinned(): number { return run(() => new Date(0).getTime()) }`,
      mathMaxInsideAFlowedCallable: `function run(cb: () => number): number { return cb() }
        export function pinned(): number { return run(() => Math.max(1, 2)) }`,
      shadowInsideAFlowedCallable: `function run(cb: () => number): number { return cb() }
        export function pinned(): number { return run(() => { const process = { pid: 1 }; return process.pid }) }`,
      // A callable merely defined, merely stored, and merely bound: the
      // assertions a first attempt at the closure rule broke.
      deferredClosure: `export function pinned(): unknown { const deferred = () => window.location; return deferred }`,
      storedNeverCalled: `export function pinned(): unknown { const f = () => process.pid; return [f] }`,
      boundButNeverCalled: `export function pinned(): unknown { const f = () => process.pid; return f.bind(null) }`,
      // Layer negatives: a layer merely BUILT provides nothing to anybody, and a
      // provide whose callback touches nothing keeps its pin.
      layerMerelyBuilt: `${CAPABILITY}
        export function pinned(): unknown { return Layer.succeed(Config, { retries: 1 }) }`,
      provideOfACleanCallback: `${CAPABILITY}
        export function pinned(): number {
          const layer = Layer.succeed(Config, { retries: 1 })
          return Layer.provide(layer, () => 7)
        }`,
    };

    for (const [name, source] of Object.entries(ordinary)) {
      const program = `${PIN}\n${source}\nnative(pinned)`;
      expect([name, rowOf(program)]).toEqual([name, { requirements: [], paths: {}, refused: [] }]);
      expect([name, pinKept(program)]).toEqual([name, true]);
    }
  });

  test("Layer provision subtracts what the layer provides and reports what it does not", () => {
    // Locked, Satisfaction: "Providing a layer to a computation MUST remove
    // matching capabilities from the computation's unsatisfied requirement row."
    const satisfied = `${CAPABILITY}
      export function scoped(): number {
        const layer = Layer.succeed(Config, { retries: 1 })
        return Layer.provide(layer, () => Config.context().retries)
      }`;
    expect(rowOf(satisfied, "scoped").requirements).toEqual([]);
    // And the same body WITHOUT the provide keeps the requirement, so the empty
    // row above is subtraction rather than the callback being skipped.
    const unprovided = `${CAPABILITY}
      export function scoped(): number { return Config.context().retries }`;
    expect(rowOf(unprovided, "scoped").requirements).toEqual(["Config"]);

    // An UNSATISFIED nested row is now reported instead of vanishing with the
    // callback, and it is the row the frontend already computed.
    const unsatisfied = `${CAPABILITY}
      export function scoped(): number {
        const layer = Layer.succeed(Config, { retries: 1 })
        return Layer.provide(layer, () => Other.context().n)
      }`;
    expect(rowOf(unsatisfied, "scoped").requirements).toEqual(["Other"]);
    expect(frontendRequirements(unsatisfied, "scoped")).toEqual(["Other"]);

    // `Layer.merge` provides the union; a layer reached through a binding chain
    // resolves the same way the frontend's `resolveLayerExpression` resolves it.
    const merged = `${CAPABILITY}
      export function scoped(): number {
        const layer = Layer.merge(Layer.succeed(Config, { retries: 1 }), Layer.succeed(Other, { n: 2 }))
        const alias = layer
        return Layer.provide(alias, () => Config.context().retries + Other.context().n)
      }`;
    expect(rowOf(merged, "scoped").requirements).toEqual([]);
    expect(frontendRequirements(merged, "scoped")).toEqual([]);

    // Subtraction survives PROPAGATION: a call inside the callback is part of
    // the provided computation, so the callee's row is subtracted at that edge
    // and nowhere else.
    const throughACall = `${CAPABILITY}
      export function reads(): number { return Config.context().retries }
      export function scoped(): number {
        const layer = Layer.succeed(Config, { retries: 1 })
        return Layer.provide(layer, () => reads())
      }
      export function unscoped(): number { return reads() }`;
    expect(rowOf(throughACall, "scoped").requirements).toEqual([]);
    expect(rowOf(throughACall, "unscoped").requirements).toEqual(["Config"]);

    // Nested provides accumulate, and the inner scope does not lose the outer's.
    const nested = `${CAPABILITY}
      export function scoped(): number {
        const outer = Layer.succeed(Config, { retries: 1 })
        const inner = Layer.succeed(Other, { n: 2 })
        return Layer.provide(outer, () => Layer.provide(inner, () => Config.context().retries + Other.context().n))
      }`;
    expect(rowOf(nested, "scoped").requirements).toEqual([]);

    // An OPAQUE layer subtracts NOTHING. The frontend calls this SMITHERS2104,
    // "this POC cannot prove its provided capability closure"; refusing to
    // subtract what cannot be proved is the same answer in the row.
    const opaque = `${CAPABILITY}
      declare const mystery: import("smthrs/provider").Layer<typeof Config>
      export function scoped(): number { return Layer.provide(mystery, () => Config.context().retries) }`;
    expect(rowOf(opaque, "scoped").requirements).toEqual(["Config"]);
  });

  test("a layer never subtracts a requirement that blocks a native pin", () => {
    // A row name is only a class name, so a capability may be spelled
    // `TypeScript` — or `Host<"process">` reached inside a provided computation.
    // Neither is a nominal capability a layer can satisfy, and subtracting
    // either would grant a pin the specification forbids.
    const hostile = `${PIN}
      import { Context } from "smthrs/context"
      import { Layer } from "smthrs/provider"
      abstract class TypeScript extends Context { abstract readonly n: number }
      export function pinned(): unknown {
        const layer = Layer.succeed(TypeScript, { n: 1 })
        return Layer.provide(layer, () => eval("1"))
      }
      native(pinned)`;
    expect(rowOf(hostile)).toEqual({
      requirements: ["TypeScript"],
      paths: { TypeScript: ["pinned"] },
      refused: ["native pin failed: TypeScript is required through pinned"],
    });

    const hostRead = `${PIN}
      ${CAPABILITY}
      export function pinned(): unknown {
        const layer = Layer.succeed(Config, { retries: 1 })
        return Layer.provide(layer, () => [Config.context().retries, process.pid])
      }
      native(pinned)`;
    // The provided capability is gone; the host read that a layer cannot satisfy
    // is not.
    expect(rowOf(hostRead).requirements).toEqual(['Host<"process">']);
    expect(pinKept(hostRead)).toBe(true);
  });

  test("value flow and Layer provision terminate on cycles and still charge behind them", () => {
    // A recursive callee, keyed by (callee, bound callables), re-entered with
    // the SAME binding once and no more.
    const recursive = `${PIN}
      function run(n: number, cb: () => unknown): unknown { if (n > 0) { run(n - 1, cb) } return cb() }
      export function pinned(): unknown { return run(2, () => process.pid) }
      native(pinned)`;
    expect(rowOf(recursive).paths['Host<"process">']).toEqual(["pinned", "run"]);

    // Mutually recursive callees where the invocation is BEHIND the cycle: the
    // walk must terminate and must still find it.
    const mutual = `${PIN}
      function a(n: number, cb: () => unknown): unknown { if (n > 0) { b(n - 1, cb) } return 0 }
      function b(n: number, cb: () => unknown): unknown { if (n > 0) { a(n - 1, cb) } return cb() }
      export function pinned(): unknown { return a(2, () => process.pid) }
      native(pinned)`;
    expect(rowOf(mutual).paths['Host<"process">']).toEqual(["pinned", "a", "b"]);

    // A self-referential layer binding terminates and provides nothing, which
    // subtracts nothing.
    const cyclicLayer = `${CAPABILITY}
      export function scoped(): number {
        const layer: ReturnType<typeof Layer.succeed<typeof Config>> = layer
        return Layer.provide(layer, () => Config.context().retries)
      }`;
    expect(rowOf(cyclicLayer, "scoped").requirements).toEqual(["Config"]);

    // Two DIFFERENT callables through the SAME callee: keying the walk on the
    // callee alone would drop the second, which is the fail-open direction.
    const twoCallbacks = `${PIN}
      function run(cb: () => unknown): unknown { return cb() }
      export function pinned(): unknown { return [run(() => process.pid), run(() => window.location)] }
      native(pinned)`;
    expect(rowOf(twoCallbacks).requirements).toEqual(['Host<"process">', 'Host<"window">']);
  });

  test("a module-level Layer.provide runs its callback when the module loads", () => {
    // The module-initializer walk answers the same question about the same
    // symbol: the callback runs while the module is evaluated, so a binding that
    // holds its result carries what it read.
    const laundered = analyzeCompatibilityProject({
      "config.sm": `
        import { Context } from "smthrs/context"
        import { Layer } from "smthrs/provider"
        abstract class Config extends Context { abstract readonly retries: number }
        const layer = Layer.succeed(Config, { retries: 1 })
        export const value = Layer.provide(layer, () => process.pid)
      `,
      "main.sm": `
        import { value } from "./config.sm"
        ${PIN}
        export function pinned(): unknown { return value }
        native(pinned)
      `,
    });
    const row = laundered.functions["main.sm#pinned"]!;
    expect(row.requirements).toEqual(['Host<"process">']);
    expect(row.requirementPaths['Host<"process">'])
      .toEqual(["main.sm#pinned", "config.sm#value", "process.pid"]);

    // And the clean control: a module-level provide that touches nothing leaves
    // its reader requirement-free with the pin granted.
    const clean = analyzeCompatibilityProject({
      "config.sm": `
        import { Context } from "smthrs/context"
        import { Layer } from "smthrs/provider"
        abstract class Config extends Context { abstract readonly retries: number }
        const layer = Layer.succeed(Config, { retries: 1 })
        export const value = Layer.provide(layer, () => 7)
      `,
      "main.sm": `
        import { value } from "./config.sm"
        ${PIN}
        export function pinned(): unknown { return value }
        native(pinned)
      `,
    });
    expect(clean.functions["main.sm#pinned"]!.requirements).toEqual([]);
    expect(clean.functions["main.sm#pinned"]!.nativePinned).toBe(true);
  });

  test("end to end, both halves refuse and the clean control compiles silently", () => {
    const compiled = (source: string): string[] =>
      compileProject([{ fileName: "main.sm", source }], {
        rootDir: "/smithers-flow-e2e",
        outDir: "/smithers-flow-e2e/out",
      }).diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`);

    expect(compiled(`import { native } from "smithers:native"

function run(callback: () => number): number {
  return callback()
}

export function pinned(): number {
  return run(() => process.pid)
}

native(pinned)
`)).toEqual([
      "SMITHERS1601: ambient host global 'process' is unavailable; access it through a Context capability",
      'SMITHERS3001: native pin failed: Host<"process"> is required through main.sm#pinned -> main.sm#run',
    ]);

    expect(compiled(`import { Context } from "smthrs/context"
import { Layer } from "smthrs/provider"
import { native } from "smithers:native"

abstract class Config extends Context {
  abstract readonly retries: number
}

export function scoped(): number {
  const layer = Layer.succeed(Config, { retries: 1 })
  return Layer.provide(layer, () => process.pid)
}

native(scoped)
`)).toEqual([
      "SMITHERS1601: ambient host global 'process' is unavailable; access it through a Context capability",
      'SMITHERS3001: native pin failed: Host<"process"> is required through main.sm#scoped',
    ]);

    // Two independent components refuse each program, and the clean control —
    // the same shapes with nothing to charge — compiles with zero diagnostics.
    expect(compiled(`import { Context } from "smthrs/context"
import { Layer } from "smthrs/provider"
import { native } from "smithers:native"

abstract class Config extends Context {
  abstract readonly retries: number
}

function run(callback: () => number): number {
  return callback()
}

export function pinned(): number {
  const layer = Layer.succeed(Config, { retries: 1 })
  return Layer.provide(layer, () => run(() => Config.context().retries))
}

native(pinned)
`)).toEqual([]);
  });
});

describe("the argument half of value flow in a module-level initializer", () => {
  const PIN = `import { native } from "smithers:native"`;
  /** Reads a binding named `value` produced by `config.sm`'s initializer. */
  const READER = `
    import { value } from "./config.sm"
    ${PIN}
    export function pinned(): unknown { return value }
    native(pinned)
  `;
  /** The callee whose visible body actually invokes its parameter. */
  const RUN = `function run(cb: () => unknown): unknown { return cb() }`;

  const rowOf = (sources: Readonly<Record<string, string>>): {
    requirements: string[];
    paths: Record<string, string[]>;
    refused: string[];
  } => {
    const result = analyzeCompatibilityProject(sources);
    return {
      requirements: result.functions["main.sm#pinned"]!.requirements,
      paths: result.functions["main.sm#pinned"]!.requirementPaths,
      refused: result.diagnostics.filter((diagnostic) => diagnostic.code === "SMITHERS3001")
        .map((diagnostic) => diagnostic.message),
    };
  };
  const pinKept = (sources: Readonly<Record<string, string>>): boolean =>
    analyzeCompatibilityProject(sources).functions["main.sm#pinned"]!.nativePinned;
  /** The standard reader over a `config.sm` that publishes `value`. */
  const through = (config: string): Readonly<Record<string, string>> =>
    ({ "config.sm": config, "main.sm": READER });

  test("the reproduction: run, keep and .map at module level and in a body, side by side", () => {
    // THE REPORTED FORM. `run`'s visible body invokes its parameter, so the
    // callable really runs when `config.sm` loads and the host read is a real
    // dependency of every reader of `value`. MEASURED before this lane:
    // `requirements: []` with the pin GRANTED over a live `process.pid` read,
    // while the byte-identical shape inside an analyzed body was charged.
    const invoked = through(`${RUN}
      export const value = run(() => process.pid)`);
    expect(rowOf(invoked)).toEqual({
      requirements: ['Host<"process">'],
      // The route, not just the verdict: it names the binding whose initializer
      // ran, the callee whose body invoked the callback, and the expression to
      // delete.
      paths: {
        'Host<"process">': ["main.sm#pinned", "config.sm#value", "config.sm#run", "process.pid"],
      },
      refused: [
        'native pin failed: Host<"process"> is required through ' +
        "main.sm#pinned -> config.sm#value -> config.sm#run -> process.pid",
      ],
    });

    // THE A/B CONTROL. The same read written directly in the initializer, which
    // C50 already charged. Same verdict, so the charge is one the program really
    // earns rather than an artefact of the new walk.
    const direct = through(`export const value = process.pid`);
    expect(rowOf(direct).requirements).toEqual(rowOf(invoked).requirements);

    // THE HARD CONSTRAINT, asserted at MODULE level and in a BODY side by side.
    // `keep`'s visible body only RETURNS its parameter, so nothing runs it;
    // `Array.prototype.map` has no visible body at all, so nothing can be read
    // about it. The two are syntactically identical to `run(...)`, and the only
    // thing that separates all three is what the callee's body does — never a
    // rule about arguments and never a table of host knowledge.
    const keptAtModuleLevel = through(`
      function keep(cb: () => unknown): () => unknown { return cb }
      export const value = keep(() => process.pid)`);
    const mappedAtModuleLevel = through(`export const value = [1].map(() => process.pid)`);
    const keptInABody = {
      "main.sm": `${PIN}
        function keep(cb: () => unknown): () => unknown { return cb }
        export function pinned(): unknown { return keep(() => process.pid) }
        native(pinned)`,
    };
    const mappedInABody = {
      "main.sm": `${PIN}
        export function pinned(): unknown { return [1].map(() => process.pid) }
        native(pinned)`,
    };
    for (const negative of [keptAtModuleLevel, mappedAtModuleLevel, keptInABody, mappedInABody]) {
      expect(rowOf(negative)).toEqual({ requirements: [], paths: {}, refused: [] });
      expect(pinKept(negative)).toBe(true);
    }

    // And the body walk's answer for the charged shape is unchanged, so the two
    // walks now give the same verdict for the same program.
    const invokedInABody = {
      "main.sm": `${PIN}
        ${RUN}
        export function pinned(): unknown { return run(() => process.pid) }
        native(pinned)`,
    };
    expect(rowOf(invokedInABody)).toEqual({
      requirements: ['Host<"process">'],
      paths: { 'Host<"process">': ["main.sm#pinned", "main.sm#run"] },
      refused: [
        'native pin failed: Host<"process"> is required through main.sm#pinned -> main.sm#run',
      ],
    });
  });

  test("a module-level initializer charges exactly what the callee's visible body invokes", () => {
    // One table, one verdict per form, each asserting the requirement AND the
    // complete route. Every one of these charged NOTHING before this lane while
    // a live `process.pid` read ran at module load.
    const charging: Record<string, { config: string; path: string[] }> = {
      // The reported form, and the non-exported spelling of it.
      calleeInvokesItsParameter: {
        config: `${RUN}
          export const value = run(() => process.pid)`,
        path: ["main.sm#pinned", "config.sm#value", "config.sm#run", "process.pid"],
      },
      calleeInvokesItConditionally: {
        // No path analysis: a callee that MIGHT invoke it is charged, which is
        // the fail-closed direction and the same rule the body walk applies.
        config: `function run(cb: () => unknown): unknown {
            if (String(1) === "2") { return cb() }
            return 0
          }
          export const value = run(() => process.pid)`,
        path: ["main.sm#pinned", "config.sm#value", "config.sm#run", "process.pid"],
      },
      calleeInvokesItTwice: {
        config: `function run(cb: () => unknown): unknown { cb(); return cb() }
          export const value = run(() => process.pid)`,
        path: ["main.sm#pinned", "config.sm#value", "config.sm#run", "process.pid"],
      },
      twoHopsThroughASecondVisibleFunction: {
        config: `function inner(cb: () => unknown): unknown { return cb() }
          function outer(cb: () => unknown): unknown { return inner(cb) }
          export const value = outer(() => process.pid)`,
        path: ["main.sm#pinned", "config.sm#value", "config.sm#outer", "config.sm#inner", "process.pid"],
      },
      calleeStoresItInALocalThenInvokes: {
        config: `function run(cb: () => unknown): unknown { const f = cb; return f() }
          export const value = run(() => process.pid)`,
        path: ["main.sm#pinned", "config.sm#value", "config.sm#run", "process.pid"],
      },
      calleeInvokesItThroughCall: {
        config: `function run(cb: () => unknown): unknown { return cb.call(null) }
          export const value = run(() => process.pid)`,
        path: ["main.sm#pinned", "config.sm#value", "config.sm#run", "process.pid"],
      },
      calleeInvokesItOptionally: {
        config: `function run(cb?: () => unknown): unknown { return cb?.() }
          export const value = run(() => process.pid)`,
        path: ["main.sm#pinned", "config.sm#value", "config.sm#run", "process.pid"],
      },
      calleeInvokesItInAFinallyBlock: {
        config: `function run(cb: () => unknown): unknown { try { return 1 } finally { cb() } }
          export const value = run(() => process.pid)`,
        path: ["main.sm#pinned", "config.sm#value", "config.sm#run", "process.pid"],
      },
      calleeIsAnArrowConst: {
        config: `const run = (cb: () => unknown): unknown => cb()
          export const value = run(() => process.pid)`,
        path: ["main.sm#pinned", "config.sm#value", "config.sm#run", "process.pid"],
      },
      calleeIsAnObjectLiteralMethod: {
        config: `const host = { run(cb: () => unknown): unknown { return cb() } }
          export const value = host.run(() => process.pid)`,
        path: ["main.sm#pinned", "config.sm#value", "config.sm#run", "process.pid"],
      },
      calleeIsWrittenAtTheCall: {
        // An IIFE-shaped callee is walked where it stands, so it contributes no
        // hop of its own — the same rule C52 drew for the callable at the call.
        config: `export const value =
            (function (cb: () => unknown): unknown { return cb() })(() => process.pid)`,
        path: ["main.sm#pinned", "config.sm#value", "process.pid"],
      },
      calleeIsAConstructor: {
        config: `class Runner { constructor(cb: () => unknown) { cb() } }
          export const value = new Runner(() => process.pid)`,
        path: ["main.sm#pinned", "config.sm#value", "process.pid"],
      },
      theCallableIsAnIdentifierBoundElsewhere: {
        config: `${RUN}
          const reader = () => process.pid
          export const value = run(reader)`,
        path: [
          "main.sm#pinned", "config.sm#value", "config.sm#run", "config.sm#reader", "process.pid",
        ],
      },
      theCallableIsANamedAnalyzedFunction: {
        config: `${RUN}
          export function reads(): unknown { return process.pid }
          export const value = run(reads)`,
        path: [
          "main.sm#pinned", "config.sm#value", "config.sm#run", "config.sm#reads", "process.pid",
        ],
      },
      theCallableIsInsideAnObjectLiteralArgument: {
        config: `function run(o: { cb: () => unknown }): unknown { return o.cb() }
          export const value = run({ cb: () => process.pid })`,
        path: [
          "main.sm#pinned", "config.sm#value", "config.sm#run", "config.sm#cb", "process.pid",
        ],
      },
      anObjectLiteralArgumentWhoseMethodTheCalleeInvokes: {
        config: `interface Reader { read(): unknown }
          function run(r: Reader): unknown { return r.read() }
          export const value = run({ read() { return process.pid } })`,
        path: [
          "main.sm#pinned", "config.sm#value", "config.sm#run", "config.sm#read", "process.pid",
        ],
      },
      aShorthandMemberInAnObjectLiteralArgument: {
        config: `interface Reader { read(): unknown }
          const read = (): unknown => process.pid
          function run(r: Reader): unknown { return r.read() }
          export const value = run({ read })`,
        path: [
          "main.sm#pinned", "config.sm#value", "config.sm#run", "config.sm#read", "process.pid",
        ],
      },
      theCallableReachesTheParameterThroughASecondPosition: {
        config: `function run(n: number, cb: () => unknown): unknown { return cb() }
          export const value = run(1, () => process.pid)`,
        path: ["main.sm#pinned", "config.sm#value", "config.sm#run", "process.pid"],
      },
      theCalleePassesItToAnObjectItBuilds: {
        config: `function run(cb: () => unknown): unknown { const o = { go: cb }; return o.go() }
          export const value = run(() => process.pid)`,
        path: ["main.sm#pinned", "config.sm#value", "config.sm#run", "process.pid"],
      },
      theCallbackItselfTakesACallback: {
        config: `function run(cb: (inner: () => unknown) => unknown): unknown { return cb(() => 1) }
          export const value = run((inner) => { inner(); return process.pid })`,
        path: ["main.sm#pinned", "config.sm#value", "config.sm#run", "process.pid"],
      },
      anIifeInsideTheEnteredCallable: {
        // C52's rule, re-asserted INSIDE a callable this walk entered.
        config: `${RUN}
          export const value = run(() => (() => process.pid)())`,
        path: ["main.sm#pinned", "config.sm#value", "config.sm#run", "process.pid"],
      },
      theReassignedLetOverReportInsideTheEnteredCallable: {
        // The deliberate fail-CLOSED over-report, re-asserted inside a callable
        // this walk entered: the initializer is the evidence, an assignment is
        // not.
        config: `${RUN}
          export const value = run(() => { let f = () => process.pid; f = () => 1; return f() })`,
        path: [
          "main.sm#pinned", "config.sm#value", "config.sm#run", "config.sm#f", "process.pid",
        ],
      },
    };

    for (const [name, form] of Object.entries(charging)) {
      const sources = through(form.config);
      expect([name, rowOf(sources)]).toEqual([name, {
        requirements: ['Host<"process">'],
        paths: { 'Host<"process">': form.path },
        refused: [
          `native pin failed: Host<"process"> is required through ${form.path.join(" -> ")}`,
        ],
      }]);
    }

    // The non-exported spelling: the reader is in the same module, so the route
    // has no module hop, only the binding and the callee.
    expect(rowOf({
      "main.sm": `${PIN}
        ${RUN}
        const value = run(() => process.pid)
        export function pinned(): unknown { return value }
        native(pinned)`,
    })).toEqual({
      requirements: ['Host<"process">'],
      paths: {
        'Host<"process">': ["main.sm#pinned", "main.sm#value", "main.sm#run", "process.pid"],
      },
      refused: [
        'native pin failed: Host<"process"> is required through ' +
        "main.sm#pinned -> main.sm#value -> main.sm#run -> process.pid",
      ],
    });

    // A NON-BLOCKING row is reported and does NOT refuse the pin, and a blocking
    // one behind it is never lost — the accumulate-don't-short-circuit rule C50
    // established, now exercised through the argument half.
    expect(rowOf(through(`${RUN}
      export const value = run(() => Date.now())`))).toEqual({
      requirements: ["Clock"],
      paths: { Clock: ["main.sm#pinned", "config.sm#value", "config.sm#run", "Date.now"] },
      refused: [],
    });
    expect(rowOf(through(`${RUN}
      export const value = run(() => ({ at: Date.now(), pid: process.pid }))`))).toEqual({
      requirements: ["Clock", 'Host<"process">'],
      paths: {
        Clock: ["main.sm#pinned", "config.sm#value", "config.sm#run", "Date.now"],
        'Host<"process">': ["main.sm#pinned", "config.sm#value", "config.sm#run", "process.pid"],
      },
      refused: [
        'native pin failed: Host<"process"> is required through ' +
        "main.sm#pinned -> config.sm#value -> config.sm#run -> process.pid",
      ],
    });
  });

  test("the negative direction: a callable a module-level callee never invokes stays ordinary", () => {
    // Every one of these is a program the certification must still GRANT. The
    // table is the other half of the rule: entering a callee's body is only ever
    // allowed to charge what that body actually invokes.
    const ordinary: Record<string, Readonly<Record<string, string>>> = {
      // THE MANDATED NEGATIVE and its no-visible-body twin, at module level.
      keptButNeverInvoked: through(`
        function keep(cb: () => unknown): () => unknown { return cb }
        export const value = keep(() => process.pid)`),
      passedToMap: through(`export const value = [1].map(() => process.pid)`),
      // The same pair re-asserted INSIDE a callable this walk entered, so the
      // boundary holds one level deeper too.
      keptInsideAnEnteredCallable: through(`${RUN}
        function keep(cb: () => unknown): () => unknown { return cb }
        export const value = run(() => keep(() => process.pid))`),
      mappedInsideAnEnteredCallable: through(`${RUN}
        export const value = run(() => [1].map(() => process.pid))`),
      calleeIgnoresItEntirely: through(`
        function ignore(cb: () => unknown): number { return 1 }
        export const value = ignore(() => process.pid)`),
      calleeStoresItOnAnObjectButNeverCallsIt: through(`
        function run(cb: () => unknown): unknown { const o = { go: cb }; return 1 }
        export const value = run(() => process.pid)`),
      calleeWrapsItInAClosureItReturns: through(`
        function later(cb: () => unknown): () => unknown { return () => cb() }
        export const value = later(() => process.pid)`),
      calleeReturnsItInsideAnObjectItBuilds: through(`
        function run(cb: () => unknown): unknown { return { go: () => cb() } }
        export const value = run(() => process.pid)`),
      calleeOnlyNamesItWithTypeof: through(`
        function run(cb: () => unknown): unknown { return (typeof cb) }
        export const value = run(() => process.pid)`),
      calleeOnlyBindsIt: through(`
        function run(cb: () => unknown): unknown { return cb.bind(null) }
        export const value = run(() => process.pid)`),
      anObjectLiteralArgumentWhoseMethodIsNeverCalled: through(`
        interface Reader { read(): unknown }
        function ignore(r: Reader): number { return 1 }
        export const value = ignore({ read() { return process.pid } })`),
      // BUILDING a closure inside an entered callable is still not running it.
      aClosureMerelyDefinedInsideAnEnteredCallable: through(`${RUN}
        export const value = run(() => { const later = () => process.pid; return 1 })`),
      aCallableReturnedUninvokedFromAnEnteredCallable: through(`${RUN}
        export const value = run(() => () => process.pid)`),
      aCallableStoredInsideAnEnteredCallable: through(`${RUN}
        export const value = run(() => { const o = { go: () => process.pid }; return 1 })`),
      aBindWithNoCallInsideAnEnteredCallable: through(`${RUN}
        export const value = run(() => { const f = () => process.pid; return f.bind(null) })`),
      // The ambient exemptions, re-asserted INSIDE a callable this walk entered.
      // They hold because the classification is the analyzer's existing table
      // applied at a different node, never a second opinion.
      deterministicDateInsideAnEnteredCallable: through(`${RUN}
        export const value = run(() => Date.parse("2020-01-01") + Date.UTC(2020, 0, 1))`),
      epochDateAndMathMaxInsideAnEnteredCallable: through(`${RUN}
        export const value = run(() => new Date(0).getTime() + Math.max(1, 2))`),
      lexicalShadowInsideAnEnteredCallable: through(`${RUN}
        export const value = run(() => { const Date = { now: () => 1 }; return Date.now() })`),
      lexicalShadowAtModuleLevel: through(`
        const process = { pid: 1 }
        export const value = process.pid`),
      // C41's precision: a re-export publishes an ELIDABLE binding, so reading a
      // clean name through a laundering module inside an entered callable still
      // charges nothing.
      aCleanReExportedBindingInsideAnEnteredCallable: {
        "reexport.sm": `export { readFileSync } from "node:fs"\nexport const safe = 1`,
        "config.sm": `import { safe } from "./reexport.sm"
          ${RUN}
          export const value = run(() => safe)`,
        "main.sm": READER,
      },
      // Locked: a type-only edge adds no runtime requirement, even when the
      // module it names loads `node:fs`.
      aTypeOnlyImportInsideAnEnteredCallable: {
        "types.sm": `import "node:fs"\nexport interface T { n: number }`,
        "config.sm": `import type { T } from "./types.sm"
          ${RUN}
          export const value = run(() => { const t: T = { n: 1 }; return t.n })`,
        "main.sm": READER,
      },
      // A compiler-owned virtual module never becomes a foreign edge.
      aCompilerOwnedSpecifierInsideAnEnteredCallable: through(`
        import { native } from "smithers:native"
        ${RUN}
        export const value = run(() => typeof native)`),
      // C40's asset exemption, read inside a callable this walk entered.
      aCompileTimeAssetInsideAnEnteredCallable: {
        "main.sm": `import config from "./data.json" with { type: "json" }
          ${PIN}
          ${RUN}
          const value = run(() => config)
          export function pinned(): unknown { return value }
          native(pinned)`,
      },
      // These five entries used to hold the RESIDUE this table recorded: a rest
      // parameter, a destructured parameter, a call result, an array-literal
      // element and a tagged template, each asserted to require nothing while a
      // live `process.pid` read ran. They were recorded FAIL-OPENS rather than
      // negatives — C57's §7 listed all five as open — and every one of them is
      // now charged with a full route in the block that closed them. What
      // belongs here is the boundary each of them stood next to, which is the
      // same boundary as everywhere else in this table: reaching a callable
      // through one of those spellings is still not INVOKING it.
      aRestParameterNeverInvoked: through(`
        function keep(...cbs: Array<() => unknown>): () => unknown { return cbs[0]! }
        export const value = keep(() => process.pid)`),
      aDestructuredParameterNeverInvoked: through(`
        function keep({ cb }: { cb: () => unknown }): () => unknown { return cb }
        export const value = keep({ cb: () => process.pid })`),
      aCallResultNeverInvoked: through(`
        function make(): () => unknown { return () => process.pid }
        function keep(cb: () => unknown): () => unknown { return cb }
        export const value = keep(make())`),
      anArrayLiteralElementNeverInvoked: through(`
        function keep(list: Array<() => unknown>): () => unknown { return list[0]! }
        export const value = keep([() => process.pid])`),
      aTaggedTemplateSubstitutionNeverInvoked: through(`
        function tag(parts: TemplateStringsArray, cb: () => unknown): () => unknown { return cb }
        export const value = tag\`x\${() => process.pid}\``),
      // And the precision the tagged-template mapping has to have: a tag that
      // invokes only its FIRST substitution must not charge the second.
      aTaggedTemplateSubstitutionTheTagSkips: through(`
        function tag(parts: TemplateStringsArray, a: () => unknown, b: () => unknown): unknown { return a() }
        export const value = tag\`x\${() => 1}y\${() => process.pid}\``),
    };

    for (const [name, sources] of Object.entries(ordinary)) {
      expect([name, rowOf(sources)]).toEqual([name, { requirements: [], paths: {}, refused: [] }]);
      expect([name, pinKept(sources)]).toEqual([name, true]);
    }
  });

  test("the argument half terminates, and the key must include the bound callables", () => {
    // TERMINATION. `walk.followed` is keyed by the callee AND the callables
    // bound to its parameters, both drawn from the program's own syntax nodes,
    // so the key space is finite and a monotone set of keys terminates. These
    // assertions are the proof: each program has a cycle, each returns, and the
    // charged ones still charge what is BEHIND the cycle.
    expect(rowOf(through(`
      function run(cb: () => unknown, n: number): unknown { return n > 0 ? run(cb, n - 1) : cb() }
      export const value = run(() => process.pid, 3)`))).toEqual({
      requirements: ['Host<"process">'],
      paths: {
        'Host<"process">': ["main.sm#pinned", "config.sm#value", "config.sm#run", "process.pid"],
      },
      refused: [
        'native pin failed: Host<"process"> is required through ' +
        "main.sm#pinned -> config.sm#value -> config.sm#run -> process.pid",
      ],
    });
    expect(rowOf(through(`
      function a(cb: () => unknown, n: number): unknown { return n > 0 ? b(cb, n - 1) : cb() }
      function b(cb: () => unknown, n: number): unknown { return a(cb, n) }
      export const value = a(() => process.pid, 3)`))).toEqual({
      requirements: ['Host<"process">'],
      paths: {
        'Host<"process">': ["main.sm#pinned", "config.sm#value", "config.sm#a", "process.pid"],
      },
      refused: [
        'native pin failed: Host<"process"> is required through ' +
        "main.sm#pinned -> config.sm#value -> config.sm#a -> process.pid",
      ],
    });
    // The negative half of the same proof: terminating by charging EVERYTHING
    // would prove nothing, so a cycle that never invokes the parameter must
    // terminate AND stay ordinary.
    expect(rowOf(through(`
      function a(cb: () => unknown, n: number): unknown { return n > 0 ? b(cb, n - 1) : 0 }
      function b(cb: () => unknown, n: number): unknown { return a(cb, n) }
      export const value = a(() => process.pid, 3)`)))
      .toEqual({ requirements: [], paths: {}, refused: [] });
    // A self-referential binding terminates too.
    expect(rowOf(through(`${RUN}
      const self: unknown = run(() => self)
      export const value = self`)))
      .toEqual({ requirements: [], paths: {}, refused: [] });
    // And a binding CYCLE across two modules, with the argument half inside it.
    expect(rowOf({
      "a.sm": `import { other } from "./b.sm"
        ${RUN}
        export const seed: unknown = run(() => [other, process.pid])`,
      "b.sm": `import { seed } from "./a.sm"\nexport const other: unknown = seed`,
      "config.sm": `import { seed } from "./a.sm"\nexport const value = seed`,
      "main.sm": READER,
    })).toEqual({
      requirements: ['Host<"process">'],
      paths: {
        'Host<"process">': ["main.sm#pinned", "config.sm", "a.sm#seed", "a.sm#run", "process.pid"],
      },
      refused: [
        'native pin failed: Host<"process"> is required through ' +
        "main.sm#pinned -> config.sm -> a.sm#seed -> a.sm#run -> process.pid",
      ],
    });

    // WHY THE KEY MUST INCLUDE THE BOUND CALLABLES. Two call sites hand ONE
    // callee two DIFFERENT callables. Keying on the callee alone would follow
    // the first and drop the second, which is the fail-open direction — and the
    // dropped one here is the blocking requirement.
    expect(rowOf(through(`${RUN}
      function both(): unknown { return [run(() => process.pid), run(() => Date.now())] }
      export const value = both()`))).toEqual({
      requirements: ["Clock", 'Host<"process">'],
      paths: {
        Clock: ["main.sm#pinned", "config.sm#value", "config.sm#both", "config.sm#run", "Date.now"],
        'Host<"process">': [
          "main.sm#pinned", "config.sm#value", "config.sm#both", "config.sm#run", "process.pid",
        ],
      },
      refused: [
        'native pin failed: Host<"process"> is required through ' +
        "main.sm#pinned -> config.sm#value -> config.sm#both -> config.sm#run -> process.pid",
      ],
    });
    // The same, FORWARDED through a second visible function, so the recomputed
    // bindings at the nested call are keyed apart too.
    expect(rowOf(through(`${RUN}
      function pass(cb: () => unknown): unknown { return run(cb) }
      function both(): unknown { return [pass(() => process.pid), pass(() => Date.now())] }
      export const value = both()`))).toEqual({
      requirements: ["Clock", 'Host<"process">'],
      paths: {
        Clock: [
          "main.sm#pinned", "config.sm#value", "config.sm#both", "config.sm#pass", "config.sm#run",
          "Date.now",
        ],
        'Host<"process">': [
          "main.sm#pinned", "config.sm#value", "config.sm#both", "config.sm#pass", "config.sm#run",
          "process.pid",
        ],
      },
      refused: [
        'native pin failed: Host<"process"> is required through ' +
        "main.sm#pinned -> config.sm#value -> config.sm#both -> config.sm#pass -> " +
        "config.sm#run -> process.pid",
      ],
    });
    // `walk.entered` deliberately stays keyed by the callable NODE: entering one
    // callable twice can only re-derive what it already contributed, so the SAME
    // callable reached through two different callees is charged once, with the
    // route of the first reader that got there.
    expect(rowOf(through(`${RUN}
      function run2(cb: () => unknown): unknown { return cb() }
      const shared = () => process.pid
      export const value = [run(shared), run2(shared)]`))).toEqual({
      requirements: ['Host<"process">'],
      paths: {
        'Host<"process">': [
          "main.sm#pinned", "config.sm#value", "config.sm#run", "config.sm#shared", "process.pid",
        ],
      },
      refused: [
        'native pin failed: Host<"process"> is required through ' +
        "main.sm#pinned -> config.sm#value -> config.sm#run -> config.sm#shared -> process.pid",
      ],
    });
  });

  test("the argument half survives every hop the binding walk crosses", () => {
    // ONE MODULE AWAY, and further: the callee, the callable and the binding can
    // each live in a different module, and the route names every hop the reader
    // has to look at. The load-graph and re-export machinery C41/C53 built is
    // reused rather than re-implemented, so each of these is the same walk.
    const forms: Record<string, { sources: Record<string, string>; path: string[] }> = {
      theCalleeIsOneModuleAway: {
        sources: {
          "runner.sm": `export ${RUN}`,
          "config.sm": `import { run } from "./runner.sm"
            export const value = run(() => process.pid)`,
          "main.sm": READER,
        },
        path: ["main.sm#pinned", "config.sm#value", "runner.sm#run", "process.pid"],
      },
      theCallableIsOneModuleAway: {
        sources: {
          "cb.sm": `export const reader = () => process.pid`,
          "config.sm": `import { reader } from "./cb.sm"
            ${RUN}
            export const value = run(reader)`,
          "main.sm": READER,
        },
        path: [
          "main.sm#pinned", "config.sm#value", "config.sm#run", "cb.sm#reader", "process.pid",
        ],
      },
      theCalleeIsReachedThroughAReExportedBinding: {
        sources: {
          "runner.sm": `export ${RUN}`,
          "launder.sm": `export { run } from "./runner.sm"`,
          "config.sm": `import { run } from "./launder.sm"
            export const value = run(() => process.pid)`,
          "main.sm": READER,
        },
        // The route names the module that DECLARES the callee, not the one that
        // merely republished its name — C41's precision, unchanged.
        path: ["main.sm#pinned", "config.sm#value", "runner.sm#run", "process.pid"],
      },
      theWholeInitializerIsTwoModulesAway: {
        sources: {
          "a.sm": `${RUN}\nexport const seed = run(() => process.pid)`,
          "b.sm": `import { seed } from "./a.sm"\nexport const mid = seed`,
          "config.sm": `import { mid } from "./b.sm"\nexport const value = mid`,
          "main.sm": READER,
        },
        path: [
          "main.sm#pinned", "config.sm", "b.sm", "a.sm#seed", "a.sm#run", "process.pid",
        ],
      },
      reachedThroughAReExportChain: {
        sources: {
          "a.sm": `${RUN}\nexport const seed = run(() => process.pid)`,
          "b.sm": `export { seed } from "./a.sm"`,
          "config.sm": `import { seed } from "./b.sm"\nexport const value = seed`,
          "main.sm": READER,
        },
        path: [
          "main.sm#pinned", "config.sm", "b.sm", "a.sm#seed", "a.sm#run", "process.pid",
        ],
      },
      reachedThroughAStarReExport: {
        sources: {
          "a.sm": `${RUN}\nexport const seed = run(() => process.pid)`,
          "b.sm": `export * from "./a.sm"`,
          "config.sm": `import { seed } from "./b.sm"\nexport const value = seed`,
          "main.sm": READER,
        },
        path: [
          "main.sm#pinned", "config.sm", "b.sm", "a.sm#seed", "a.sm#run", "process.pid",
        ],
      },
      reachedThroughANamespaceRead: {
        sources: {
          "a.sm": `${RUN}
            export const seed = run(() => process.pid)
            export const safe = 1`,
          "config.sm": `import * as a from "./a.sm"\nexport const value = a.seed`,
          "main.sm": READER,
        },
        path: ["main.sm#pinned", "config.sm", "a.sm#seed", "a.sm#run", "process.pid"],
      },
    };

    for (const [name, form] of Object.entries(forms)) {
      expect([name, rowOf(form.sources)]).toEqual([name, {
        requirements: ['Host<"process">'],
        paths: { 'Host<"process">': form.path },
        refused: [
          `native pin failed: Host<"process"> is required through ${form.path.join(" -> ")}`,
        ],
      }]);
    }

    // THE NEGATIVE HALF of the same precision: reading the CLEAN export of that
    // very module charges nothing. A namespace binding is only as foreign as the
    // export actually read, and the argument half did not weaken that.
    const clean = {
      "a.sm": `${RUN}
        export const seed = run(() => process.pid)
        export const safe = 1`,
      "config.sm": `import * as a from "./a.sm"\nexport const value = a.safe`,
      "main.sm": READER,
    };
    expect(rowOf(clean)).toEqual({ requirements: [], paths: {}, refused: [] });
    expect(pinKept(clean)).toBe(true);

    // STILL OPEN, and the reason it is: an unread module-level STATEMENT is
    // invisible, because deciding it needs a purity judgement the specification
    // does not make. `a.sm` really does run `process.pid` when `config.sm` loads
    // it, and nobody is charged — this is the hazard-log entry that stays.
    const unread = {
      "a.sm": `${RUN}\nexport const seed = run(() => process.pid)`,
      "config.sm": `import "./a.sm"\nexport const value = 1`,
      "main.sm": READER,
    };
    expect(rowOf(unread)).toEqual({ requirements: [], paths: {}, refused: [] });
  });

  test("the fix reaches the whole pipeline, and the clean control compiles silently", () => {
    const compiled = (sources: Readonly<Record<string, string>>): string[] =>
      compileProject(
        Object.entries(sources).map(([fileName, source]) => ({ fileName, source })),
        { rootDir: "/smithers-module-flow", outDir: "/smithers-module-flow/out" },
      ).diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`);

    // Two independent components refuse the program: the frontend's ambient
    // check at the `process` read, and the pin over the propagated row.
    expect(compiled({
      "config.sm": `function run(cb: () => number): number { return cb() }
export const value = run(() => process.pid)
`,
      "main.sm": `import { value } from "./config.sm"
import { native } from "smithers:native"

export function pinned(): number {
  return value
}

native(pinned)
`,
    })).toEqual([
      "SMITHERS1601: ambient host global 'process' is unavailable; access it through a Context capability",
      'SMITHERS3001: native pin failed: Host<"process"> is required through ' +
      "main.sm#pinned -> config.sm#value -> config.sm#run -> process.pid",
    ]);

    // The clean control — the same shapes with nothing to charge — compiles with
    // zero diagnostics, so the walk is not simply refusing every callee.
    expect(compiled({
      "config.sm": `function run(cb: () => number): number { return cb() }
function keep(cb: () => number): () => number { return cb }
export const value = run(() => 1)
export const kept = keep(() => 2)
`,
      "main.sm": `import { value } from "./config.sm"
import { native } from "smithers:native"

export function pinned(): number {
  return value
}

native(pinned)
`,
    })).toEqual([]);
  });
});

describe("the values a call can be followed to: instances, results, lists and patterns", () => {
  const PIN = `import { native } from "smithers:native"`;
  /** Reads a binding named `value` produced by `config.sm`'s initializer. */
  const READER = `
    import { value } from "./config.sm"
    ${PIN}
    export function pinned(): unknown { return value }
    native(pinned)
  `;
  const READER_IFACE = `interface Reader { read(): unknown }`;
  /** The callee whose visible body invokes the method it was handed. */
  const RUN_READER = `function run(r: Reader): unknown { return r.read() }`;
  /** The mandated negative: a callee whose visible body only RETURNS. */
  const KEEP = `function keep(cb: () => unknown): () => unknown { return cb }`;

  const rowOf = (sources: Readonly<Record<string, string>>, name = "main.sm#pinned"): {
    requirements: string[];
    paths: Record<string, string[]>;
    refused: string[];
  } => {
    const result = analyzeCompatibilityProject(sources);
    return {
      requirements: result.functions[name]!.requirements,
      paths: result.functions[name]!.requirementPaths,
      refused: result.diagnostics.filter((diagnostic) => diagnostic.code === "SMITHERS3001")
        .map((diagnostic) => diagnostic.message),
    };
  };
  const pinKept = (sources: Readonly<Record<string, string>>, name = "main.sm#pinned"): boolean =>
    analyzeCompatibilityProject(sources).functions[name]!.nativePinned;
  /** A module-level form: `config.sm` publishes `value`, read by the pinned fn. */
  const through = (config: string): Readonly<Record<string, string>> =>
    ({ "config.sm": config, "main.sm": READER });
  /** A body form: the declarations, plus a pinned function that calls `probe()`. */
  const inABody = (declarations: string): Readonly<Record<string, string>> => ({
    "main.sm":
      `${PIN}\n${declarations}\nexport function pinned(): unknown { return probe() }\nnative(pinned)`,
  });

  test("the reproduction: five spellings the analyzer could follow, and the two it still cannot", () => {
    // Each of these ran a visible body and charged NOTHING while a live
    // `process.pid` read ran, with the pin GRANTED. Measured before this lane,
    // in a body and at module level alike. The second question — which value
    // reaches this call — always had an answer here; it was simply not asked.
    const closed: Record<string, { sources: Readonly<Record<string, string>>; path: string[] }> = {
      // A `new` expression is neither a callable nor an object literal, but the
      // CLASS is right there and so is the method body the callee reaches.
      aClassInstance: {
        sources: inABody(`${READER_IFACE}
          class Impl { read(): unknown { return process.pid } }
          ${RUN_READER}
          function probe(): unknown { return run(new Impl()) }`),
        path: ["main.sm#pinned", "main.sm#probe", "main.sm#run", "main.sm#read"],
      },
      // A call RESULT: `make`'s body is visible and returns a visible callable,
      // so this is the ordinary "enter the visible body" question asked about a
      // return instead of about a call.
      aCallResult: {
        sources: inABody(`function make(): () => unknown { return () => process.pid }
          function run(cb: () => unknown): unknown { return cb() }
          function probe(): unknown { return run(make()) }`),
        path: ["main.sm#pinned", "main.sm#probe", "main.sm#run"],
      },
      // An ARRAY literal element, visible in the initializer. The annotation is
      // what hid it: without one the checker resolves the element's own
      // signature, which is asserted as a control below.
      anArrayLiteralElement: {
        sources: inABody(`const fns: Array<() => unknown> = [() => process.pid]
          function probe(): unknown { return fns[0]!() }`),
        path: ["main.sm#pinned", "main.sm#probe"],
      },
      // A DESTRUCTURED parameter, where the caller passed a visible object
      // literal: the member the pattern names is what the binding holds.
      aDestructuredParameter: {
        sources: inABody(`function run({ cb }: { cb: () => unknown }): unknown { return cb() }
          function probe(): unknown { return run({ cb: () => process.pid }) }`),
        path: ["main.sm#pinned", "main.sm#probe", "main.sm#run", "main.sm#cb"],
      },
      // A REST parameter with visible literal arguments: the same positional
      // list an array literal produces, read back by index.
      aRestParameter: {
        sources: inABody(`function run(...cbs: Array<() => unknown>): unknown { return cbs[0]!() }
          function probe(): unknown { return run(() => process.pid) }`),
        path: ["main.sm#pinned", "main.sm#probe", "main.sm#run"],
      },
      // Every one of the five again at MODULE level, which is a separate walk a
      // prior lane had to close separately.
      aClassInstanceAtModuleLevel: {
        sources: through(`${READER_IFACE}
          class Impl { read(): unknown { return process.pid } }
          ${RUN_READER}
          export const value = run(new Impl())`),
        path: [
          "main.sm#pinned", "config.sm#value", "config.sm#run", "config.sm#read", "process.pid",
        ],
      },
      aCallResultAtModuleLevel: {
        sources: through(`function make(): () => unknown { return () => process.pid }
          function run(cb: () => unknown): unknown { return cb() }
          export const value = run(make())`),
        path: ["main.sm#pinned", "config.sm#value", "config.sm#run", "process.pid"],
      },
      anArrayLiteralElementAtModuleLevel: {
        sources: through(`const fns: Array<() => unknown> = [() => process.pid]
          export const value = fns[0]!()`),
        path: ["main.sm#pinned", "config.sm#value", "process.pid"],
      },
      aDestructuredParameterAtModuleLevel: {
        sources: through(`function run({ cb }: { cb: () => unknown }): unknown { return cb() }
          export const value = run({ cb: () => process.pid })`),
        path: [
          "main.sm#pinned", "config.sm#value", "config.sm#run", "config.sm#cb", "process.pid",
        ],
      },
      aRestParameterAtModuleLevel: {
        sources: through(`function run(...cbs: Array<() => unknown>): unknown { return cbs[0]!() }
          export const value = run(() => process.pid)`),
        path: ["main.sm#pinned", "config.sm#value", "config.sm#run", "process.pid"],
      },
    };

    for (const [name, form] of Object.entries(closed)) {
      expect([name, rowOf(form.sources)]).toEqual([name, {
        requirements: ['Host<"process">'],
        // The route is the contract: it names the value that was followed, the
        // body that invoked it, and the expression to delete.
        paths: { 'Host<"process">': form.path },
        refused: [
          `native pin failed: Host<"process"> is required through ${form.path.join(" -> ")}`,
        ],
      }]);
    }

    // THE A/B CONTROL. The same read written directly in the pinned body. Same
    // requirement, so each charge above is one the program really earns rather
    // than an artefact of a wider walk.
    const direct = inABody(`function probe(): unknown { return process.pid }`);
    expect(rowOf(direct).requirements).toEqual(['Host<"process">']);

    // THE HARD CONSTRAINT, in all three positions, side by side with the charges
    // above. `keep`'s visible body only RETURNS its parameter, so nothing runs
    // it. `Array.prototype.map` has no visible body at all, so nothing can be
    // read about it — and that reason does not depend on its callback, which is
    // why no rule about ARGUMENTS was added here and no table of host knowledge
    // about `Array.prototype` was consulted.
    const held: Record<string, Readonly<Record<string, string>>> = {
      keptAtModuleLevel: through(`${KEEP}
        export const value = keep(() => process.pid)`),
      mappedAtModuleLevel: through(`export const value = [1].map(() => process.pid)`),
      keptInABody: inABody(`${KEEP}
        function probe(): unknown { return keep(() => process.pid) }`),
      mappedInABody: inABody(`function probe(): unknown { return [1].map(() => process.pid) }`),
      // And one level deeper, INSIDE a callable each of the five new channels
      // entered — the position where a widened walk would show up first.
      keptAndMappedInsideAClassMethod: inABody(`${READER_IFACE}
        ${KEEP}
        class Impl {
          read(): unknown { keep(() => process.pid); return [1].map(() => process.pid) }
        }
        ${RUN_READER}
        function probe(): unknown { return run(new Impl()) }`),
      keptAndMappedInsideACallResult: inABody(`${KEEP}
        function make(): () => unknown {
          return () => { keep(() => process.pid); return [1].map(() => process.pid) }
        }
        function run(cb: () => unknown): unknown { return cb() }
        function probe(): unknown { return run(make()) }`),
      keptAndMappedInsideAnArrayElement: inABody(`${KEEP}
        const fns: Array<() => unknown> =
          [() => { keep(() => process.pid); return [1].map(() => process.pid) }]
        function probe(): unknown { return fns[0]!() }`),
      keptAndMappedInsideADestructuredParameter: inABody(`${KEEP}
        function run({ cb }: { cb: () => unknown }): unknown { return cb() }
        function probe(): unknown {
          return run({ cb: () => { keep(() => process.pid); return [1].map(() => process.pid) } })
        }`),
      keptAndMappedInsideARestParameter: inABody(`${KEEP}
        function run(...cbs: Array<() => unknown>): unknown { return cbs[0]!() }
        function probe(): unknown {
          return run(() => { keep(() => process.pid); return [1].map(() => process.pid) })
        }`),
      keptAndMappedInsideAModuleLevelEnteredCallable: through(`${KEEP}
        function run(cb: () => unknown): unknown { return cb() }
        export const value = run(() => { keep(() => process.pid); return [1].map(() => process.pid) })`),
    };
    for (const [name, sources] of Object.entries(held)) {
      expect([name, rowOf(sources)]).toEqual([name, { requirements: [], paths: {}, refused: [] }]);
      expect([name, pinKept(sources)]).toEqual([name, true]);
    }
  });

  test("a class instance carries the method bodies it owns and the ones it inherits", () => {
    const charged: Record<string, { sources: Readonly<Record<string, string>>; path: string[] }> = {
      inheritedFromABaseClass: {
        sources: inABody(`${READER_IFACE}
          class Base { read(): unknown { return process.pid } }
          class Impl extends Base {}
          ${RUN_READER}
          function probe(): unknown { return run(new Impl()) }`),
        path: ["main.sm#pinned", "main.sm#probe", "main.sm#run", "main.sm#read"],
      },
      // An OVERRIDE that adds a host read is charged...
      overridingACleanBase: {
        sources: inABody(`${READER_IFACE}
          class Base { read(): unknown { return 1 } }
          class Impl extends Base { read(): unknown { return process.pid } }
          ${RUN_READER}
          function probe(): unknown { return run(new Impl()) }`),
        path: ["main.sm#pinned", "main.sm#probe", "main.sm#run", "main.sm#read"],
      },
      inheritedThreeDeep: {
        sources: inABody(`${READER_IFACE}
          class A { read(): unknown { return process.pid } }
          class B extends A {}
          class C extends B {}
          ${RUN_READER}
          function probe(): unknown { return run(new C()) }`),
        path: ["main.sm#pinned", "main.sm#probe", "main.sm#run", "main.sm#read"],
      },
      // A class property holding an arrow is a method body by another spelling.
      aClassPropertyHoldingAnArrow: {
        sources: inABody(`${READER_IFACE}
          class Impl { read = (): unknown => process.pid }
          ${RUN_READER}
          function probe(): unknown { return run(new Impl()) }`),
        path: ["main.sm#pinned", "main.sm#probe", "main.sm#run", "main.sm#read"],
      },
      forwardedTwoHops: {
        sources: inABody(`${READER_IFACE}
          class Impl { read(): unknown { return process.pid } }
          function inner(r: Reader): unknown { return r.read() }
          function outer(r: Reader): unknown { return inner(r) }
          function probe(): unknown { return outer(new Impl()) }`),
        path: [
          "main.sm#pinned", "main.sm#probe", "main.sm#outer", "main.sm#inner", "main.sm#read",
        ],
      },
      // The route names the module that DECLARES the class, which is the file to
      // open.
      aClassInAnotherModule: {
        sources: {
          "impl.sm": `export class Impl { read(): unknown { return process.pid } }`,
          "main.sm": `${PIN}
            import { Impl } from "./impl.sm"
            ${READER_IFACE}
            ${RUN_READER}
            function probe(): unknown { return run(new Impl()) }
            export function pinned(): unknown { return probe() }
            native(pinned)`,
        },
        path: ["main.sm#pinned", "main.sm#probe", "main.sm#run", "impl.sm#read"],
      },
      // The instance reached through a BINDING, then handed on.
      anInstanceHeldByABindingThenPassed: {
        sources: inABody(`${READER_IFACE}
          class Impl { read(): unknown { return process.pid } }
          const impl = new Impl()
          ${RUN_READER}
          function probe(): unknown { return run(impl) }`),
        path: ["main.sm#pinned", "main.sm#probe", "main.sm#run", "main.sm#read"],
      },
      // A module edge travels the same channel as ambient authority.
      aModuleEdgeThroughAClassInstance: {
        sources: {
          "main.sm": `${PIN}
            import { readFileSync } from "node:fs"
            ${READER_IFACE}
            class Impl { read(): unknown { return readFileSync("x") } }
            ${RUN_READER}
            function probe(): unknown { return run(new Impl()) }
            export function pinned(): unknown { return probe() }
            native(pinned)`,
        },
        path: ["main.sm#pinned", "main.sm#probe", "main.sm#run", "main.sm#read"],
      },
    };

    for (const [name, form] of Object.entries(charged)) {
      const requirement = name === "aModuleEdgeThroughAClassInstance"
        ? 'Module<"node:fs">'
        : 'Host<"process">';
      expect([name, rowOf(form.sources)]).toEqual([name, {
        requirements: [requirement],
        paths: { [requirement]: form.path },
        refused: [
          `native pin failed: ${requirement} is required through ${form.path.join(" -> ")}`,
        ],
      }]);
    }

    // THE PRECISION THIS NEEDS, and it is a negative: an OWN member is looked at
    // first, so a CLEAN override of a host-reading base is clean. Charging the
    // base here would be an over-report that no reader could act on — the
    // program never runs that body.
    const overridden = inABody(`${READER_IFACE}
      class Base { read(): unknown { return process.pid } }
      class Impl extends Base { read(): unknown { return 1 } }
      ${RUN_READER}
      function probe(): unknown { return run(new Impl()) }`);
    expect(rowOf(overridden)).toEqual({ requirements: [], paths: {}, refused: [] });
    expect(pinKept(overridden)).toBe(true);

    // THE CONTROL that shows what was already right: an instance held by a
    // binding and called DIRECTLY was already charged, because the checker
    // resolves that call to the method itself. The gap was only where an
    // INTERFACE-typed parameter stood between the instance and the call.
    const directly = inABody(`class Impl { read(): unknown { return process.pid } }
      const impl = new Impl()
      function probe(): unknown { return impl.read() }`);
    expect(rowOf(directly).paths).toEqual({
      'Host<"process">': ["main.sm#pinned", "main.sm#probe", "main.sm#read"],
    });
  });

  test("a call result is the value its callee returns, and a factory chain is followed", () => {
    const charged: Record<string, { sources: Readonly<Record<string, string>>; path: string[] }> = {
      aTwoHopFactory: {
        sources: inABody(`function make(): () => unknown { return () => process.pid }
          function make2(): () => unknown { return make() }
          function run(cb: () => unknown): unknown { return cb() }
          function probe(): unknown { return run(make2()) }`),
        path: ["main.sm#pinned", "main.sm#probe", "main.sm#run"],
      },
      anArrowConstFactory: {
        sources: inABody(`const make = (): (() => unknown) => () => process.pid
          function run(cb: () => unknown): unknown { return cb() }
          function probe(): unknown { return run(make()) }`),
        path: ["main.sm#pinned", "main.sm#probe", "main.sm#run"],
      },
      aFactoryReturningAnObjectLiteral: {
        sources: inABody(`${READER_IFACE}
          function make(): Reader { return { read(): unknown { return process.pid } } }
          ${RUN_READER}
          function probe(): unknown { return run(make()) }`),
        path: ["main.sm#pinned", "main.sm#probe", "main.sm#run", "main.sm#read"],
      },
      aFactoryReturningAClassInstance: {
        sources: inABody(`${READER_IFACE}
          class Impl { read(): unknown { return process.pid } }
          function make(): Reader { return new Impl() }
          ${RUN_READER}
          function probe(): unknown { return run(make()) }`),
        path: ["main.sm#pinned", "main.sm#probe", "main.sm#run", "main.sm#read"],
      },
      // `make()()` and a stored result: the same question one step earlier.
      aResultInvokedImmediately: {
        sources: inABody(`function make(): () => unknown { return () => process.pid }
          function probe(): unknown { return make()() }`),
        path: ["main.sm#pinned", "main.sm#probe"],
      },
      aResultStoredThenInvoked: {
        sources: inABody(`function make(): () => unknown { return () => process.pid }
          const held = make()
          function probe(): unknown { return held() }`),
        path: ["main.sm#pinned", "main.sm#probe"],
      },
      aFactoryInAnotherModule: {
        sources: {
          "make.sm": `export function make(): () => unknown { return () => process.pid }`,
          "main.sm": `${PIN}
            import { make } from "./make.sm"
            function run(cb: () => unknown): unknown { return cb() }
            function probe(): unknown { return run(make()) }
            export function pinned(): unknown { return probe() }
            native(pinned)`,
        },
        path: ["main.sm#pinned", "main.sm#probe", "main.sm#run"],
      },
      // The returned callable's own call graph still travels, so the route ends
      // at the analyzed function rather than being inlined.
      aReturnedCallableThatCallsAnAnalyzedFunction: {
        sources: inABody(`export function reads(): unknown { return process.pid }
          function make(): () => unknown { return () => reads() }
          function run(cb: () => unknown): unknown { return cb() }
          function probe(): unknown { return run(make()) }`),
        path: ["main.sm#pinned", "main.sm#probe", "main.sm#reads"],
      },
    };

    for (const [name, form] of Object.entries(charged)) {
      expect([name, rowOf(form.sources)]).toEqual([name, {
        requirements: ['Host<"process">'],
        paths: { 'Host<"process">': form.path },
        refused: [
          `native pin failed: Host<"process"> is required through ${form.path.join(" -> ")}`,
        ],
      }]);
    }

    // THE CONTROL: an UNANNOTATED factory was already charged, because the
    // checker resolves `make()()` to the arrow's own signature. The annotation
    // is what erased it, which is the same shape C55 found for `const holder:
    // Reader`.
    const unannotated = inABody(`function make() { return () => process.pid }
      function probe(): unknown { return make()() }`);
    expect(rowOf(unannotated).requirements).toEqual(['Host<"process">']);
  });

  test("a positional list: an array literal's elements and a rest parameter's arguments", () => {
    const charged: Record<string, { sources: Readonly<Record<string, string>>; path: string[] }> = {
      theSecondArrayElement: {
        sources: inABody(`const fns: Array<() => unknown> = [() => 1, () => process.pid]
          function probe(): unknown { return fns[1]!() }`),
        path: ["main.sm#pinned", "main.sm#probe"],
      },
      anArrayElementPassedOnAsAnArgument: {
        sources: inABody(`const fns: Array<() => unknown> = [() => process.pid]
          function run(cb: () => unknown): unknown { return cb() }
          function probe(): unknown { return run(fns[0]!) }`),
        path: ["main.sm#pinned", "main.sm#probe", "main.sm#run"],
      },
      anArrayOfObjectLiteralsWhoseMethodIsInvoked: {
        sources: inABody(`${READER_IFACE}
          const rs: Reader[] = [{ read(): unknown { return process.pid } }]
          function probe(): unknown { return rs[0]!.read() }`),
        path: ["main.sm#pinned", "main.sm#probe", "main.sm#read"],
      },
      anArrayReachedThroughASecondBinding: {
        sources: inABody(`const fns: Array<() => unknown> = [() => process.pid]
          const same = fns
          function probe(): unknown { return same[0]!() }`),
        path: ["main.sm#pinned", "main.sm#probe"],
      },
      theSecondRestArgument: {
        sources: inABody(`function run(...cbs: Array<() => unknown>): unknown { return cbs[1]!() }
          function probe(): unknown { return run(() => 1, () => process.pid) }`),
        path: ["main.sm#pinned", "main.sm#probe", "main.sm#run"],
      },
      aRestParameterAfterAFixedOne: {
        sources: inABody(
          `function run(n: number, ...cbs: Array<() => unknown>): unknown { return cbs[0]!() }
          function probe(): unknown { return run(1, () => process.pid) }`,
        ),
        path: ["main.sm#pinned", "main.sm#probe", "main.sm#run"],
      },
      aRestArgumentTakenThroughALocal: {
        sources: inABody(
          `function run(...cbs: Array<() => unknown>): unknown { const first = cbs[0]!; return first() }
          function probe(): unknown { return run(() => process.pid) }`,
        ),
        path: ["main.sm#pinned", "main.sm#probe", "main.sm#run"],
      },
      aRestParameterOfObjectLiterals: {
        sources: inABody(`${READER_IFACE}
          function run(...rs: Reader[]): unknown { return rs[0]!.read() }
          function probe(): unknown { return run({ read(): unknown { return process.pid } }) }`),
        path: ["main.sm#pinned", "main.sm#probe", "main.sm#run", "main.sm#read"],
      },
      aModuleEdgeThroughARestParameterAtModuleLevel: {
        sources: through(`import { readFileSync } from "node:fs"
          function run(...cbs: Array<() => unknown>): unknown { return cbs[0]!() }
          export const value = run(() => readFileSync("x"))`),
        path: ["main.sm#pinned", "config.sm", "node:fs"],
      },
    };

    for (const [name, form] of Object.entries(charged)) {
      const requirement = name === "aModuleEdgeThroughARestParameterAtModuleLevel"
        ? 'Module<"node:fs">'
        : 'Host<"process">';
      expect([name, rowOf(form.sources)]).toEqual([name, {
        requirements: [requirement],
        paths: { [requirement]: form.path },
        refused: [
          `native pin failed: ${requirement} is required through ${form.path.join(" -> ")}`,
        ],
      }]);
    }

    // A member lookup by NAME on a list resolves to nothing, which is exactly
    // what keeps `.map` where it is now that an array literal is a value at all:
    // an array literal holds no `map` of its own.
    const mappedThroughABinding = inABody(`const fns: Array<() => unknown> = [() => process.pid]
      function probe(): unknown { return fns.map((f) => 1) }`);
    expect(rowOf(mappedThroughABinding)).toEqual({ requirements: [], paths: {}, refused: [] });
    expect(pinKept(mappedThroughABinding)).toBe(true);

    // An index past the end resolves to nothing rather than to some element.
    const outOfRange = inABody(`const fns: Array<() => unknown> = [() => process.pid]
      function probe(): unknown { return fns[3]!() }`);
    expect(rowOf(outOfRange)).toEqual({ requirements: [], paths: {}, refused: [] });

    // THE CONTROL: an UNANNOTATED array was already charged, because the checker
    // resolves the element's own signature. The annotation is what erased it.
    const unannotated = inABody(`const fns = [() => process.pid]
      function probe(): unknown { return fns[0]!() }`);
    expect(rowOf(unannotated).requirements).toEqual(['Host<"process">']);
  });

  test("a destructured parameter is bound member by member, a tagged template positionally", () => {
    const charged: Record<string, { sources: Readonly<Record<string, string>>; path: string[] }> = {
      aRenamedDestructuredParameter: {
        sources: inABody(`function run({ cb: g }: { cb: () => unknown }): unknown { return g() }
          function probe(): unknown { return run({ cb: () => process.pid }) }`),
        path: ["main.sm#pinned", "main.sm#probe", "main.sm#run", "main.sm#cb"],
      },
      // A default is only reached when the caller omitted the property...
      aDestructuredDefaultTheCallerOmitted: {
        sources: inABody(
          `function run({ cb = (): unknown => process.pid }: { cb?: () => unknown }): unknown { return cb() }
          function probe(): unknown { return run({}) }`,
        ),
        path: ["main.sm#pinned", "main.sm#probe", "main.sm#run"],
      },
      // ...and the property the caller DID pass is what wins otherwise.
      aDestructuredPropertyThatShadowsADefault: {
        sources: inABody(
          `function run({ cb = (): unknown => 1 }: { cb?: () => unknown }): unknown { return cb() }
          function probe(): unknown { return run({ cb: () => process.pid }) }`,
        ),
        path: ["main.sm#pinned", "main.sm#probe", "main.sm#run", "main.sm#cb"],
      },
      aNestedPattern: {
        sources: inABody(
          `function run({ o: { cb } }: { o: { cb: () => unknown } }): unknown { return cb() }
          function probe(): unknown { return run({ o: { cb: () => process.pid } }) }`,
        ),
        path: ["main.sm#pinned", "main.sm#probe", "main.sm#run", "main.sm#cb"],
      },
      anObjectReachedThroughABinding: {
        sources: inABody(`const arg = { cb: (): unknown => process.pid }
          function run({ cb }: { cb: () => unknown }): unknown { return cb() }
          function probe(): unknown { return run(arg) }`),
        path: ["main.sm#pinned", "main.sm#probe", "main.sm#run", "main.sm#cb"],
      },
      aDestructuredObjectWhoseMethodIsInvoked: {
        sources: inABody(`${READER_IFACE}
          function run({ r }: { r: Reader }): unknown { return r.read() }
          function probe(): unknown {
            return run({ r: { read(): unknown { return process.pid } } })
          }`),
        path: ["main.sm#pinned", "main.sm#probe", "main.sm#run", "main.sm#read"],
      },
      anArrayBindingPattern: {
        sources: inABody(`function run([cb]: Array<() => unknown>): unknown { return cb!() }
          function probe(): unknown { return run([() => process.pid]) }`),
        path: ["main.sm#pinned", "main.sm#probe", "main.sm#run"],
      },
      // The same rule where the destructuring is a LOCAL rather than a
      // parameter: the binding holds the MEMBER it names, not the whole object.
      aDestructuredLocalBinding: {
        sources: inABody(`${READER_IFACE}
          const holder: Reader = { read(): unknown { return process.pid } }
          const { read } = holder
          function probe(): unknown { return read() }`),
        path: ["main.sm#pinned", "main.sm#probe", "main.sm#read"],
      },
      // ECMAScript evaluates tag`a${x}b${y}` as tag(strings, x, y), so the
      // substitutions map to the parameters after the first, in source order.
      // The mapping is READ from that rule, not guessed at.
      aTaggedTemplateSubstitution: {
        sources: inABody(
          `function tag(parts: TemplateStringsArray, cb: () => unknown): unknown { return cb() }
          function probe(): unknown { return tag\`x\${() => process.pid}\` }`,
        ),
        path: ["main.sm#pinned", "main.sm#probe", "main.sm#tag"],
      },
      theSecondTaggedTemplateSubstitution: {
        sources: inABody(
          `function tag(parts: TemplateStringsArray, a: () => unknown, b: () => unknown): unknown { return b() }
          function probe(): unknown { return tag\`x\${() => 1}y\${() => process.pid}\` }`,
        ),
        path: ["main.sm#pinned", "main.sm#probe", "main.sm#tag"],
      },
      aTaggedTemplateWithARestParameter: {
        sources: inABody(
          `function tag(parts: TemplateStringsArray, ...cbs: Array<() => unknown>): unknown { return cbs[0]!() }
          function probe(): unknown { return tag\`x\${() => process.pid}\` }`,
        ),
        path: ["main.sm#pinned", "main.sm#probe", "main.sm#tag"],
      },
      aTaggedTemplateAtModuleLevel: {
        sources: through(
          `function tag(parts: TemplateStringsArray, cb: () => unknown): unknown { return cb() }
          export const value = tag\`x\${() => process.pid}\``,
        ),
        path: ["main.sm#pinned", "config.sm#value", "config.sm#tag", "process.pid"],
      },
    };

    for (const [name, form] of Object.entries(charged)) {
      expect([name, rowOf(form.sources)]).toEqual([name, {
        requirements: ['Host<"process">'],
        paths: { 'Host<"process">': form.path },
        refused: [
          `native pin failed: Host<"process"> is required through ${form.path.join(" -> ")}`,
        ],
      }]);
    }

    // THE PRECISION THE TAGGED-TEMPLATE MAPPING HAS TO HAVE, and it is the half
    // that proves the mapping is positional rather than "charge every
    // substitution": a tag that invokes only its FIRST substitution must not
    // charge the second.
    const skipped = inABody(
      `function tag(parts: TemplateStringsArray, a: () => unknown, b: () => unknown): unknown { return a() }
      function probe(): unknown { return tag\`x\${() => 1}y\${() => process.pid}\` }`,
    );
    expect(rowOf(skipped)).toEqual({ requirements: [], paths: {}, refused: [] });
    expect(pinKept(skipped)).toBe(true);
  });

  test("the negative direction: reaching a value is not running it, through every new channel", () => {
    // NOTE for the next lane: nothing in this table is a RESIDUE. A form that
    // charges nothing because the analyzer cannot see it belongs in the
    // hazard-log comment at the top of this file, never here — two prior lanes
    // recorded fail-opens as negatives in tables like this one, and both had to
    // be unpicked. Every row below is `[]` because the PROGRAM does not run the
    // body, not because the analyzer failed to look.
    const ordinary: Record<string, Readonly<Record<string, string>>> = {
      // Reached, but never invoked — once per channel.
      aClassMethodTheCalleeNeverCalls: inABody(`${READER_IFACE}
        class Impl { read(): unknown { return process.pid } }
        function ignore(r: Reader): Reader { return r }
        function probe(): unknown { return ignore(new Impl()) }`),
      aClassMerelyDefined: inABody(`class Impl { read(): unknown { return process.pid } }
        function probe(): unknown { return 1 }`),
      aClassMethodMerelyNamed: inABody(`${KEEP}
        class Impl { read(): unknown { return process.pid } }
        function probe(): unknown { return keep(new Impl().read) }`),
      aCallableStoredOnAClassInstance: inABody(`${READER_IFACE}
        class Impl { held = (): unknown => process.pid; read(): unknown { return 1 } }
        ${RUN_READER}
        function probe(): unknown { return run(new Impl()) }`),
      aCallableAClassMethodReturnsUninvoked: inABody(`interface Reader { read(): () => unknown }
        class Impl { read(): () => unknown { return () => process.pid } }
        function run(r: Reader): unknown { return r.read() }
        function probe(): unknown { return run(new Impl()) }`),
      aFactoryResultNeverInvoked: inABody(`${KEEP}
        function make(): () => unknown { return () => process.pid }
        function probe(): unknown { return keep(make()) }`),
      aFactoryResultHandedToMap: inABody(
        `function make(): (n: number) => unknown { return () => process.pid }
        function probe(): unknown { return [1].map(make()) }`,
      ),
      aCleanFactoryResultInvoked: inABody(`function make(): () => unknown { return () => 1 }
        function run(cb: () => unknown): unknown { return cb() }
        function probe(): unknown { return run(make()) }`),
      anArrayElementMerelyNamed: inABody(`${KEEP}
        const fns: Array<() => unknown> = [() => process.pid]
        function probe(): unknown { return keep(fns[0]!) }`),
      aRestArgumentNeverInvoked: inABody(
        `function keep(...cbs: Array<() => unknown>): () => unknown { return cbs[0]! }
        function probe(): unknown { return keep(() => process.pid) }`,
      ),
      aDestructuredMemberNeverInvoked: inABody(
        `function keep({ cb }: { cb: () => unknown }): () => unknown { return cb }
        function probe(): unknown { return keep({ cb: () => process.pid }) }`,
      ),
      aTaggedTemplateSubstitutionNeverInvoked: inABody(
        `function tag(parts: TemplateStringsArray, cb: () => unknown): () => unknown { return cb }
        function probe(): unknown { return tag\`x\${() => process.pid}\` }`,
      ),
      // The ambient exemptions, re-asserted inside a body each new channel
      // entered. They hold because the classification is the analyzer's existing
      // table applied at a different node, never a second opinion.
      dateParseAndDateUtcInsideAClassMethod: inABody(`${READER_IFACE}
        class Impl { read(): unknown { return Date.parse("2020-01-01") + Date.UTC(2020, 0) } }
        ${RUN_READER}
        function probe(): unknown { return run(new Impl()) }`),
      mathMaxAndEpochDateInsideAFactoryResult: inABody(
        `function make(): () => unknown { return () => Math.max(1, 2) + new Date(0).getTime() }
        function run(cb: () => unknown): unknown { return cb() }
        function probe(): unknown { return run(make()) }`,
      ),
      mathMaxThroughADestructuredParameter: inABody(
        `function run({ cb }: { cb: () => unknown }): unknown { return cb() }
        function probe(): unknown { return run({ cb: () => Math.max(1, 2) }) }`,
      ),
      aLexicalShadowInsideAClassMethod: inABody(`${READER_IFACE}
        class Impl { read(): unknown { const process = { pid: 1 }; return process.pid } }
        ${RUN_READER}
        function probe(): unknown { return run(new Impl()) }`),
      aLexicalShadowInsideAnArrayElement: inABody(
        `const fns: Array<() => unknown> = [() => { const process = { pid: 1 }; return process.pid }]
        function probe(): unknown { return fns[0]!() }`,
      ),
      // `new Date(0)` resolves to a declaration file, so the class channel
      // leaves it exactly where it was — no host knowledge required.
      aLibraryClassInstance: inABody(`function run(d: Date): unknown { return d.getTime() }
        function probe(): unknown { return run(new Date(0)) }`),
      // Locked: a type-only edge adds no runtime requirement, even when the
      // module it names loads `node:fs`.
      aTypeOnlyImportThroughAClassInstance: {
        "types.sm": `import "node:fs"\nexport interface T { n: number }`,
        "main.sm": `${PIN}
          import type { T } from "./types.sm"
          ${READER_IFACE}
          class Impl { read(): unknown { const t: T = { n: 1 }; return t.n } }
          ${RUN_READER}
          function probe(): unknown { return run(new Impl()) }
          export function pinned(): unknown { return probe() }
          native(pinned)`,
      },
      // C41's precision: a re-export publishes an ELIDABLE binding, so reading a
      // clean name through a laundering module inside one of the new channels
      // still charges nothing.
      aCleanReExportedBindingInsideAClassMethod: {
        "reexport.sm": `export { readFileSync } from "node:fs"\nexport const safe = 1`,
        "main.sm": `${PIN}
          import { safe } from "./reexport.sm"
          ${READER_IFACE}
          class Impl { read(): unknown { return safe } }
          ${RUN_READER}
          function probe(): unknown { return run(new Impl()) }
          export function pinned(): unknown { return probe() }
          native(pinned)`,
      },
      // A compiler-owned virtual module never becomes a foreign edge.
      aCompilerOwnedSpecifierInsideAFactoryResult: inABody(
        `function make(): () => unknown { return () => typeof native }
        function run(cb: () => unknown): unknown { return cb() }
        function probe(): unknown { return run(make()) }`,
      ),
    };

    for (const [name, sources] of Object.entries(ordinary)) {
      expect([name, rowOf(sources)]).toEqual([name, { requirements: [], paths: {}, refused: [] }]);
      expect([name, pinKept(sources)]).toEqual([name, true]);
    }

    // C40's asset exemption, read inside a callable reached through a rest
    // parameter: a compile-time asset import adds no runtime requirement.
    const asset = {
      "main.sm": `import config from "./data.json" with { type: "json" }
        ${PIN}
        function run(...cbs: Array<() => unknown>): unknown { return cbs[0]!() }
        const value = run(() => config)
        export function pinned(): unknown { return value }
        native(pinned)`,
    };
    expect(rowOf(asset)).toEqual({ requirements: [], paths: {}, refused: [] });
    expect(pinKept(asset)).toBe(true);

    // THE DELIBERATE OVER-REPORT, unchanged and still fail-CLOSED: a callable
    // reached through a reassigned `let` is entered on its initializer's
    // evidence, through the new channels as through the old ones.
    const reassigned = inABody(
      `function run(...cbs: Array<() => unknown>): unknown { return cbs[0]!() }
      function probe(): unknown {
        let f = (): unknown => process.pid
        f = (): unknown => 1
        return run(f)
      }`,
    );
    expect(rowOf(reassigned).requirements).toEqual(['Host<"process">']);
  });

  test("termination: the cycles classes and return-value analysis add", () => {
    // Every one of these terminates. The NEGATIVE half is asserted alongside the
    // positive one, because terminating by charging everything would prove
    // nothing.
    const terminates: Record<string, { sources: Readonly<Record<string, string>>; requirements: string[] }> = {
      // A method returning an instance of its OWN class, invoked twice.
      aClassMethodReturningItsOwnInstance: {
        sources: inABody(`${READER_IFACE}
          class Impl { self(): Impl { return new Impl() } read(): unknown { return process.pid } }
          ${RUN_READER}
          function probe(): unknown { return run(new Impl().self().self()) }`),
        requirements: ['Host<"process">'],
      },
      // Mutually recursive factories that never reach a value.
      mutuallyRecursiveFactories: {
        sources: inABody(`function a(): () => unknown { return b() }
          function b(): () => unknown { return a() }
          function run(cb: () => unknown): unknown { return cb() }
          function probe(): unknown { return run(a()) }`),
        requirements: [],
      },
      // Mutually recursive factories that DO reach one.
      mutuallyRecursiveFactoriesThatReachARead: {
        sources: inABody(
          `function a(n: number): () => unknown { if (n > 0) { return b(n - 1) } return () => process.pid }
          function b(n: number): () => unknown { return a(n - 1) }
          function run(cb: () => unknown): unknown { return cb() }
          function probe(): unknown { return run(a(2)) }`,
        ),
        requirements: ['Host<"process">'],
      },
      aSelfRecursiveFactory: {
        sources: inABody(`function make(): () => unknown { return make() }
          function run(cb: () => unknown): unknown { return cb() }
          function probe(): unknown { return run(make()) }`),
        requirements: [],
      },
      aSelfReferentialArrayBinding: {
        sources: inABody(`const fns: Array<() => unknown> = [() => fns[0]!()]
          function probe(): unknown { return fns[0]!() }`),
        requirements: [],
      },
      aDestructuredParameterForwardedToItself: {
        sources: inABody(`function run({ cb }: { cb: () => unknown }): unknown { return run({ cb }) }
          function probe(): unknown { return run({ cb: () => process.pid }) }`),
        requirements: [],
      },
      aClassReachedThroughAnAlias: {
        sources: inABody(`${READER_IFACE}
          class Impl { read(): unknown { return process.pid } }
          const Alias = Impl
          ${RUN_READER}
          function probe(): unknown { return run(new Alias()) }`),
        requirements: ['Host<"process">'],
      },
    };

    for (const [name, form] of Object.entries(terminates)) {
      expect([name, rowOf(form.sources).requirements]).toEqual([name, form.requirements]);
    }

    // THE CASE A CARELESS TERMINATION KEY DROPS, and it is why the key must
    // include the values bound to the callee's parameters rather than only the
    // callee: two call sites handing ONE callee two DIFFERENT values must both
    // be followed. Dropping the second is the fail-open direction, and here the
    // dropped one would be the BLOCKING requirement.
    const twoCallablesThroughOneRestCallee = inABody(
      `function run(...cbs: Array<() => unknown>): unknown { return cbs[0]!() }
      function both(): unknown { return [run(() => process.pid), run(() => Date.now())] }
      function probe(): unknown { return both() }`,
    );
    expect(rowOf(twoCallablesThroughOneRestCallee).requirements.slice().sort())
      .toEqual(["Clock", 'Host<"process">']);

    const twoClassesThroughOneCallee = inABody(`${READER_IFACE}
      class A { read(): unknown { return process.pid } }
      class B { read(): unknown { return Date.now() } }
      ${RUN_READER}
      function both(): unknown { return [run(new A()), run(new B())] }
      function probe(): unknown { return both() }`);
    expect(rowOf(twoClassesThroughOneCallee).requirements.slice().sort())
      .toEqual(["Clock", 'Host<"process">']);
  });

  test("the fix reaches the whole pipeline, and the clean control compiles silently", () => {
    const compiled = (sources: Readonly<Record<string, string>>): string[] =>
      compileProject(
        Object.entries(sources).map(([fileName, source]) => ({ fileName, source })),
        { rootDir: "/smithers-value-flow", outDir: "/smithers-value-flow/out" },
      ).diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`);

    // Two independent components refuse the program: the frontend's ambient
    // check at the `process` read, and the pin over the propagated row. That is
    // the property that survives either of them being relaxed.
    expect(compiled({
      "config.sm": `interface Reader { read(): number }
class Impl { read(): number { return process.pid } }
function run(r: Reader): number { return r.read() }
export const value = run(new Impl())
`,
      "main.sm": `import { value } from "./config.sm"
import { native } from "smithers:native"

export function pinned(): number {
  return value
}

native(pinned)
`,
    })).toEqual([
      "SMITHERS1601: ambient host global 'process' is unavailable; access it through a Context capability",
      'SMITHERS3001: native pin failed: Host<"process"> is required through ' +
      "main.sm#pinned -> config.sm#value -> config.sm#run -> config.sm#read -> process.pid",
    ]);

    // The clean control — the same five shapes with nothing to charge — compiles
    // with zero diagnostics, so the walk is not simply refusing every value it
    // can now follow.
    expect(compiled({
      "config.sm": `interface Reader { read(): number }
class Impl { read(): number { return 1 } }
function run(r: Reader): number { return r.read() }
function make(): () => number { return () => 2 }
function call(cb: () => number): number { return cb() }
function pick({ cb }: { cb: () => number }): number { return cb() }
function first(...cbs: Array<() => number>): number { return cbs[0]!() }
const fns: Array<() => number> = [() => 3]
export const value = run(new Impl()) + call(make()) + pick({ cb: () => 4 }) +
  first(() => 5) + fns[0]!()
`,
      "main.sm": `import { value } from "./config.sm"
import { native } from "smithers:native"

export function pinned(): number {
  return value
}

native(pinned)
`,
    })).toEqual([]);
  });
});

describe("the values a call can be followed to: getters, spreads and several at once", () => {
  const PIN = `import { native } from "smithers:native"`;
  /** Reads a binding named `value` produced by `config.sm`'s initializer. */
  const READER = `
    import { value } from "./config.sm"
    ${PIN}
    export function pinned(): unknown { return value }
    native(pinned)
  `;
  const READER_IFACE = `interface Reader { read(): unknown }`;
  /** The callee whose visible body invokes the method it was handed. */
  const RUN_READER = `function run(r: Reader): unknown { return r.read() }`;
  /** The callee whose visible body READS the property it was handed. */
  const READ_FIELD = `function run(r: { read: unknown }): unknown { return r.read }`;
  /** The mandated negative: a callee whose visible body only RETURNS. */
  const KEEP = `function keep(cb: () => unknown): () => unknown { return cb }`;

  const rowOf = (sources: Readonly<Record<string, string>>, name = "main.sm#pinned"): {
    requirements: string[];
    paths: Record<string, string[]>;
    refused: string[];
  } => {
    const result = analyzeCompatibilityProject(sources);
    return {
      requirements: result.functions[name]!.requirements,
      paths: result.functions[name]!.requirementPaths,
      refused: result.diagnostics.filter((diagnostic) => diagnostic.code === "SMITHERS3001")
        .map((diagnostic) => diagnostic.message),
    };
  };
  const pinKept = (sources: Readonly<Record<string, string>>, name = "main.sm#pinned"): boolean =>
    analyzeCompatibilityProject(sources).functions[name]!.nativePinned;
  /** A module-level form: `config.sm` publishes `value`, read by the pinned fn. */
  const through = (config: string): Readonly<Record<string, string>> =>
    ({ "config.sm": config, "main.sm": READER });
  /** A body form: the declarations, plus a pinned function that calls `probe()`. */
  const inABody = (declarations: string): Readonly<Record<string, string>> => ({
    "main.sm":
      `${PIN}\n${declarations}\nexport function pinned(): unknown { return probe() }\nnative(pinned)`,
  });

  test("the reproduction: four residues that had an answer, and the ones that still do not", () => {
    // Each of these ran a visible body and charged NOTHING while a live
    // `process.pid` read ran, with the pin GRANTED. Measured before this lane in
    // a body AND at module level, which are two separate walks.
    const closed: Record<string, { sources: Readonly<Record<string, string>>; path: string[] }> = {
      // A class GETTER reached through an instance. The accessor resolver asked
      // the CHECKER which symbol the name resolves to and stopped there, so it
      // answered only when the receiver's type already named the accessor.
      aGetterThroughAnInstance: {
        sources: inABody(`class Impl { get read(): unknown { return process.pid } }
          ${READ_FIELD}
          function probe(): unknown { return run(new Impl()) }`),
        path: ["main.sm#pinned", "main.sm#probe", "main.sm#run", "main.sm#read"],
      },
      // A SPREAD argument. An array literal is a positional list, so the values
      // a spread contributes are READ from that list rather than guessed at.
      aSpreadArgument: {
        sources: inABody(`function run(cb: () => unknown): unknown { return cb() }
          function probe(): unknown { return run(...[() => process.pid]) }`),
        path: ["main.sm#pinned", "main.sm#probe", "main.sm#run"],
      },
      // A rest parameter ITERATED with `for…of`. Iterating a list runs the body
      // for every element, so every element is what runs.
      anIteratedRestParameter: {
        sources: inABody(
          `function run(...cbs: Array<() => unknown>): unknown { for (const cb of cbs) { cb() } return 1 }
          function probe(): unknown { return run(() => process.pid) }`,
        ),
        path: ["main.sm#pinned", "main.sm#probe", "main.sm#run"],
      },
      // An OBJECT SPREAD of a visible literal: a spread republishes what it
      // spreads, and an object literal's members are own properties.
      anObjectSpread: {
        sources: inABody(`${READER_IFACE}
          const base = { read(): unknown { return process.pid } }
          ${RUN_READER}
          function probe(): unknown { return run({ ...base }) }`),
        path: ["main.sm#pinned", "main.sm#probe", "main.sm#run", "main.sm#read"],
      },
      // A factory with more than one resolvable return, where the reading one is
      // SECOND. The first-return rule made this an accident of source order:
      // the same program with its returns swapped was already charged.
      aFactoryWhoseSecondReturnReads: {
        sources: inABody(
          `function make(n: number): () => unknown { if (n) { return () => 1 } return () => process.pid }
          function run(cb: () => unknown): unknown { return cb() }
          function probe(): unknown { return run(make(1)) }`,
        ),
        path: ["main.sm#pinned", "main.sm#probe", "main.sm#run"],
      },
      // Every one of the five again at MODULE level, which is a separate walk.
      aGetterThroughAnInstanceAtModuleLevel: {
        sources: through(`class Impl { get read(): unknown { return process.pid } }
          ${READ_FIELD}
          export const value = run(new Impl())`),
        path: [
          "main.sm#pinned", "config.sm#value", "config.sm#run", "config.sm#read", "process.pid",
        ],
      },
      aSpreadArgumentAtModuleLevel: {
        sources: through(`function run(cb: () => unknown): unknown { return cb() }
          export const value = run(...[() => process.pid])`),
        path: ["main.sm#pinned", "config.sm#value", "config.sm#run", "process.pid"],
      },
      anIteratedRestParameterAtModuleLevel: {
        sources: through(
          `function run(...cbs: Array<() => unknown>): unknown { for (const cb of cbs) { cb() } return 1 }
          export const value = run(() => process.pid)`,
        ),
        path: ["main.sm#pinned", "config.sm#value", "config.sm#run", "process.pid"],
      },
      anObjectSpreadAtModuleLevel: {
        sources: through(`${READER_IFACE}
          const base = { read(): unknown { return process.pid } }
          ${RUN_READER}
          export const value = run({ ...base })`),
        path: [
          "main.sm#pinned", "config.sm#value", "config.sm#run", "config.sm#read", "process.pid",
        ],
      },
      aFactoryWhoseSecondReturnReadsAtModuleLevel: {
        sources: through(
          `function make(n: number): () => unknown { if (n) { return () => 1 } return () => process.pid }
          function run(cb: () => unknown): unknown { return cb() }
          export const value = run(make(1))`,
        ),
        path: ["main.sm#pinned", "config.sm#value", "config.sm#run", "process.pid"],
      },
    };

    for (const [name, form] of Object.entries(closed)) {
      expect([name, rowOf(form.sources)]).toEqual([name, {
        requirements: ['Host<"process">'],
        // The route is the contract: it names the value that was followed, the
        // body that ran it, and the expression to delete.
        paths: { 'Host<"process">': form.path },
        refused: [
          `native pin failed: Host<"process"> is required through ${form.path.join(" -> ")}`,
        ],
      }]);
    }

    // THE A/B CONTROL: the same read written directly in the pinned body. Same
    // requirement, so each charge above is one the program really earns.
    expect(rowOf(inABody(`function probe(): unknown { return process.pid }`)).requirements)
      .toEqual(['Host<"process">']);

    // THE HARD CONSTRAINT, in all three positions and one level deeper inside a
    // callable entered through EACH of this lane's channels as well as the six
    // the previous lane added. `keep`'s visible body only RETURNS its parameter,
    // so nothing runs it; `Array.prototype.map` has no visible body at all, so
    // nothing can be read about it — and that reason does not depend on its
    // callback, which is why no rule about ARGUMENTS was added and no table of
    // host knowledge about `Array.prototype` was consulted.
    const held: Record<string, Readonly<Record<string, string>>> = {
      keptAtModuleLevel: through(`${KEEP}
        export const value = keep(() => process.pid)`),
      mappedAtModuleLevel: through(`export const value = [1].map(() => process.pid)`),
      keptInABody: inABody(`${KEEP}
        function probe(): unknown { return keep(() => process.pid) }`),
      mappedInABody: inABody(`function probe(): unknown { return [1].map(() => process.pid) }`),
      keptAndMappedInsideAGetter: inABody(`${KEEP}
        class Impl {
          get read(): unknown { keep(() => process.pid); return [1].map(() => process.pid) }
        }
        ${READ_FIELD}
        function probe(): unknown { return run(new Impl()) }`),
      keptAndMappedInsideASpreadArgument: inABody(`${KEEP}
        function run(cb: () => unknown): unknown { return cb() }
        function probe(): unknown {
          return run(...[() => { keep(() => process.pid); return [1].map(() => process.pid) }])
        }`),
      keptAndMappedInsideAnIteratedRestParameter: inABody(`${KEEP}
        function run(...cbs: Array<() => unknown>): unknown { for (const cb of cbs) { cb() } return 1 }
        function probe(): unknown {
          return run(() => { keep(() => process.pid); return [1].map(() => process.pid) })
        }`),
      keptAndMappedInsideAnObjectSpread: inABody(`${READER_IFACE}
        ${KEEP}
        const base = {
          read(): unknown { keep(() => process.pid); return [1].map(() => process.pid) }
        }
        ${RUN_READER}
        function probe(): unknown { return run({ ...base }) }`),
      keptAndMappedInsideASecondReturn: inABody(`${KEEP}
        function make(n: number): () => unknown {
          if (n) { return () => 1 }
          return () => { keep(() => process.pid); return [1].map(() => process.pid) }
        }
        function run(cb: () => unknown): unknown { return cb() }
        function probe(): unknown { return run(make(1)) }`),
      // And the six channels the previous lane added, re-asserted rather than
      // inherited, because this lane changed how each of them resolves.
      keptAndMappedInsideAClassMethod: inABody(`${READER_IFACE}
        ${KEEP}
        class Impl {
          read(): unknown { keep(() => process.pid); return [1].map(() => process.pid) }
        }
        ${RUN_READER}
        function probe(): unknown { return run(new Impl()) }`),
      keptAndMappedInsideACallResult: inABody(`${KEEP}
        function make(): () => unknown {
          return () => { keep(() => process.pid); return [1].map(() => process.pid) }
        }
        function run(cb: () => unknown): unknown { return cb() }
        function probe(): unknown { return run(make()) }`),
      keptAndMappedInsideAnArrayElement: inABody(`${KEEP}
        const fns: Array<() => unknown> =
          [() => { keep(() => process.pid); return [1].map(() => process.pid) }]
        function probe(): unknown { return fns[0]!() }`),
      keptAndMappedInsideADestructuredParameter: inABody(`${KEEP}
        function run({ cb }: { cb: () => unknown }): unknown { return cb() }
        function probe(): unknown {
          return run({ cb: () => { keep(() => process.pid); return [1].map(() => process.pid) } })
        }`),
      keptAndMappedInsideARestParameter: inABody(`${KEEP}
        function run(...cbs: Array<() => unknown>): unknown { return cbs[0]!() }
        function probe(): unknown {
          return run(() => { keep(() => process.pid); return [1].map(() => process.pid) })
        }`),
      keptAndMappedInsideATaggedTemplate: inABody(`${KEEP}
        function tag(parts: TemplateStringsArray, cb: () => unknown): unknown { return cb() }
        function probe(): unknown {
          return tag\`x\${() => { keep(() => process.pid); return [1].map(() => process.pid) }}\`
        }`),
      keptAndMappedInsideAModuleLevelEnteredCallable: through(`${KEEP}
        function run(cb: () => unknown): unknown { return cb() }
        export const value = run(() => { keep(() => process.pid); return [1].map(() => process.pid) })`),
      // The two shapes that keep `.map` where it is, spelled on the values this
      // file CAN follow: a positional list answers a lookup by INDEX and never
      // by NAME, so neither a rest parameter nor an array-literal binding has a
      // `map` or a `forEach` of its own.
      mapOverARestParameter: inABody(
        `function run(...cbs: Array<() => unknown>): unknown { return cbs.map((cb) => cb()) }
        function probe(): unknown { return run(() => process.pid) }`,
      ),
      forEachOverARestParameter: inABody(
        `function run(...cbs: Array<() => unknown>): unknown { cbs.forEach((cb) => cb()); return 1 }
        function probe(): unknown { return run(() => process.pid) }`,
      ),
    };
    for (const [name, sources] of Object.entries(held)) {
      expect([name, rowOf(sources)]).toEqual([name, { requirements: [], paths: {}, refused: [] }]);
      expect([name, pinKept(sources)]).toEqual([name, true]);
    }
  });

  test("a getter is the value question asked about a property read", () => {
    const charged: Record<string, { sources: Readonly<Record<string, string>>; path: string[] }> = {
      // The accessor is INHERITED, so the lookup walks the `extends` chain the
      // same way a method lookup does.
      inheritedFromABaseClass: {
        sources: inABody(`class Base { get read(): unknown { return process.pid } }
          class Impl extends Base {}
          ${READ_FIELD}
          function probe(): unknown { return run(new Impl()) }`),
        path: ["main.sm#pinned", "main.sm#probe", "main.sm#run", "main.sm#read"],
      },
      threeClassesDeep: {
        sources: inABody(`class A { get read(): unknown { return process.pid } }
          class B extends A {}
          class C extends B {}
          ${READ_FIELD}
          function probe(): unknown { return run(new C()) }`),
        path: ["main.sm#pinned", "main.sm#probe", "main.sm#run", "main.sm#read"],
      },
      // An OBJECT LITERAL's getter reached the same way, so this is one question
      // and not a rule about classes.
      onAnObjectLiteralArgument: {
        sources: inABody(`${READ_FIELD}
          function probe(): unknown {
            return run({ get read(): unknown { return process.pid } })
          }`),
        path: ["main.sm#pinned", "main.sm#probe", "main.sm#run", "main.sm#read"],
      },
      onAnObjectLiteralThroughABinding: {
        sources: inABody(`const holder = { get read(): unknown { return process.pid } }
          ${READ_FIELD}
          function probe(): unknown { return run(holder) }`),
        path: ["main.sm#pinned", "main.sm#probe", "main.sm#run", "main.sm#read"],
      },
      // An ANNOTATED binding, which is the half the checker could not answer
      // even without a call in the way.
      throughAnAnnotatedBinding: {
        sources: inABody(`class Impl { get read(): unknown { return process.pid } }
          function probe(): unknown { const r: { read: unknown } = new Impl(); return r.read }`),
        path: ["main.sm#pinned", "main.sm#probe", "main.sm#read"],
      },
      twoHops: {
        sources: inABody(`class Impl { get read(): unknown { return process.pid } }
          function inner(r: { read: unknown }): unknown { return r.read }
          function outer(r: { read: unknown }): unknown { return inner(r) }
          function probe(): unknown { return outer(new Impl()) }`),
        path: ["main.sm#pinned", "main.sm#probe", "main.sm#outer", "main.sm#inner", "main.sm#read"],
      },
      throughAFactoryResult: {
        sources: inABody(`class Impl { get read(): unknown { return process.pid } }
          function make(): Impl { return new Impl() }
          ${READ_FIELD}
          function probe(): unknown { return run(make()) }`),
        path: ["main.sm#pinned", "main.sm#probe", "main.sm#run", "main.sm#read"],
      },
      inAnotherModule: {
        sources: {
          "impl.sm": `export class Impl { get read(): unknown { return process.pid } }`,
          "main.sm": `${PIN}
            import { Impl } from "./impl.sm"
            ${READ_FIELD}
            function probe(): unknown { return run(new Impl()) }
            export function pinned(): unknown { return probe() }
            native(pinned)`,
        },
        path: ["main.sm#pinned", "main.sm#probe", "main.sm#run", "impl.sm#read"],
      },
      // A MODULE edge behind a getter reached the same way.
      aModuleEdgeBehindAGetter: {
        sources: inABody(`import { readFileSync } from "node:fs"
          class Impl { get read(): unknown { return readFileSync("x") } }
          ${READ_FIELD}
          function probe(): unknown { return run(new Impl()) }`),
        path: ["main.sm#pinned", "main.sm#probe", "main.sm#run", "main.sm#read"],
      },
    };
    for (const [name, form] of Object.entries(charged)) {
      const row = rowOf(form.sources);
      expect([name, row.requirements.length]).toEqual([name, 1]);
      expect([name, row.paths[row.requirements[0]!]]).toEqual([name, form.path]);
    }

    // THE PRECISION, and it is what stops the next lane charging a base class a
    // program never runs: an OWN accessor shadows the base it replaces, so a
    // CLEAN override of a host-reading base is clean.
    const cleanOverride = inABody(`class Base { get read(): unknown { return process.pid } }
      class Impl extends Base { get read(): unknown { return 1 } }
      ${READ_FIELD}
      function probe(): unknown { return run(new Impl()) }`);
    expect(rowOf(cleanOverride)).toEqual({ requirements: [], paths: {}, refused: [] });
    expect(pinKept(cleanOverride)).toBe(true);

    // The concrete receiver kept the answer it always had, byte for byte.
    expect(rowOf(inABody(`class Impl { get read(): unknown { return process.pid } }
      function probe(): unknown { return new Impl().read }`)).paths['Host<"process">'])
      .toEqual(["main.sm#pinned", "main.sm#probe", "main.sm#read"]);
  });

  test("a spread argument is the list it spreads, read positionally", () => {
    const charged: Record<string, Readonly<Record<string, string>>> = {
      theSecondElementOfTheSpread: inABody(
        `function run(a: () => unknown, b: () => unknown): unknown { return b() }
        function probe(): unknown { return run(...[() => 1, () => process.pid]) }`,
      ),
      spreadAfterAFixedArgument: inABody(
        `function run(a: () => unknown, b: () => unknown): unknown { return b() }
        function probe(): unknown { return run(() => 1, ...[() => process.pid]) }`,
      ),
      spreadOfAnArrayLiteralBinding: inABody(
        `const fns: Array<() => unknown> = [() => process.pid]
        function run(cb: () => unknown): unknown { return cb() }
        function probe(): unknown { return run(...fns) }`,
      ),
      spreadIntoARestParameter: inABody(
        `function run(...cbs: Array<() => unknown>): unknown { return cbs[0]!() }
        function probe(): unknown { return run(...[() => process.pid]) }`,
      ),
      // An EMPTY spread contributes nothing, so what follows it keeps position 0
      // — the count comes from the list, not from the argument slot.
      anEmptySpreadShiftsNothing: inABody(
        `function run(cb: () => unknown): unknown { return cb() }
        function probe(): unknown { return run(...[], () => process.pid) }`,
      ),
      aRestParameterForwardedWithASpread: inABody(
        `function inner(cb: () => unknown): unknown { return cb() }
        function outer(...cbs: Array<() => unknown>): unknown { return inner(...cbs) }
        function probe(): unknown { return outer(() => process.pid) }`,
      ),
      aSpreadInsideAnArrayLiteral: inABody(
        `const fns: Array<() => unknown> = [() => process.pid]
        const all: Array<() => unknown> = [...fns]
        function probe(): unknown { return all[0]!() }`,
      ),
      aModuleEdgeThroughASpread: inABody(`import { readFileSync } from "node:fs"
        function run(cb: () => unknown): unknown { return cb() }
        function probe(): unknown { return run(...[() => readFileSync("x")]) }`),
    };
    for (const [name, sources] of Object.entries(charged)) {
      expect([name, rowOf(sources).requirements.length]).toEqual([name, 1]);
      expect([name, pinKept(sources)]).toEqual([name, true]);
    }

    // THE PRECISION: this is positional, not "charge every element of the
    // spread". The callee invokes only its FIRST parameter, so the SECOND
    // element of the spread is not charged.
    const onlyTheFirst = inABody(
      `function run(a: () => unknown, b: () => unknown): unknown { return a() }
      function probe(): unknown { return run(...[() => 1, () => process.pid]) }`,
    );
    expect(rowOf(onlyTheFirst)).toEqual({ requirements: [], paths: {}, refused: [] });
    expect(pinKept(onlyTheFirst)).toBe(true);

    // Both parameters invoked: both elements charged, each with its own row.
    expect(rowOf(inABody(
      `function run(a: () => unknown, b: () => unknown): unknown { return [a(), b()] }
      function probe(): unknown { return run(...[() => process.pid, () => Date.now()]) }`,
    )).requirements.slice().sort()).toEqual(["Clock", 'Host<"process">']);
  });

  test("a rest parameter iterated with for-of runs every element it collected", () => {
    const charged: Record<string, Readonly<Record<string, string>>> = {
      theFirstArgument: inABody(
        `function run(...cbs: Array<() => unknown>): unknown { for (const cb of cbs) { cb() } return 1 }
        function probe(): unknown { return run(() => process.pid) }`,
      ),
      // The SECOND argument, which the "first element" answer would have lost:
      // iterating runs every element, so every element is charged.
      theSecondArgument: inABody(
        `function run(...cbs: Array<() => unknown>): unknown { for (const cb of cbs) { cb() } return 1 }
        function probe(): unknown { return run(() => 1, () => process.pid) }`,
      ),
      anArrayLiteralBinding: inABody(
        `const fns: Array<() => unknown> = [() => process.pid]
        function probe(): unknown { for (const cb of fns) { cb() } return 1 }`,
      ),
      declaredWithLet: inABody(
        `function run(...cbs: Array<() => unknown>): unknown { for (let cb of cbs) { cb() } return 1 }
        function probe(): unknown { return run(() => process.pid) }`,
      ),
      throughALocalCopy: inABody(
        `function run(...cbs: Array<() => unknown>): unknown {
          const all = cbs; for (const cb of all) { cb() } return 1 }
        function probe(): unknown { return run(() => process.pid) }`,
      ),
      destructuredOutOfTheRestList: inABody(
        `function run(...cbs: Array<() => unknown>): unknown { const [first] = cbs; return first!() }
        function probe(): unknown { return run(() => process.pid) }`,
      ),
    };
    for (const [name, sources] of Object.entries(charged)) {
      expect([name, rowOf(sources).requirements]).toEqual([name, ['Host<"process">']]);
    }

    // BOTH elements, so the union is what the loop runs and not a choice of one.
    expect(rowOf(inABody(
      `function run(...cbs: Array<() => unknown>): unknown { for (const cb of cbs) { cb() } return 1 }
      function probe(): unknown { return run(() => process.pid, () => Date.now()) }`,
    )).requirements.slice().sort()).toEqual(["Clock", 'Host<"process">']);

    // THE NEGATIVE that makes the rule checkable: ITERATING is not INVOKING.
    const iteratedButNotCalled = inABody(
      `function run(...cbs: Array<() => unknown>): unknown { for (const cb of cbs) { void cb } return 1 }
      function probe(): unknown { return run(() => process.pid) }`,
    );
    expect(rowOf(iteratedButNotCalled)).toEqual({ requirements: [], paths: {}, refused: [] });
    expect(pinKept(iteratedButNotCalled)).toBe(true);
  });

  test("an object spread republishes exactly what a spread copies", () => {
    const charged: Record<string, Readonly<Record<string, string>>> = {
      ofAVisibleBinding: inABody(`${READER_IFACE}
        const base = { read(): unknown { return process.pid } }
        ${RUN_READER}
        function probe(): unknown { return run({ ...base }) }`),
      ofAnInlineLiteral: inABody(`${READER_IFACE}
        ${RUN_READER}
        function probe(): unknown {
          return run({ ...{ read(): unknown { return process.pid } } })
        }`),
      // Source order decides: a spread AFTER an explicit member replaces it.
      spreadAfterAnExplicitMember: inABody(`${READER_IFACE}
        const base = { read(): unknown { return process.pid } }
        ${RUN_READER}
        function probe(): unknown { return run({ read(): unknown { return 1 }, ...base }) }`),
      twoSpreadSources: inABody(`${READER_IFACE}
        const a = { other(): unknown { return 1 } }
        const b = { read(): unknown { return process.pid } }
        ${RUN_READER}
        function probe(): unknown { return run({ ...a, ...b }) }`),
      // A class's OWN instance property IS copied by a spread, so it is
      // republished — including one it inherits.
      ofAClassOwnProperty: inABody(`${READER_IFACE}
        class Impl { read = (): unknown => process.pid }
        ${RUN_READER}
        function probe(): unknown { return run({ ...new Impl() }) }`),
      ofAnInheritedClassProperty: inABody(`${READER_IFACE}
        class Base { read = (): unknown => process.pid }
        class Impl extends Base {}
        ${RUN_READER}
        function probe(): unknown { return run({ ...new Impl() }) }`),
      throughTwoHops: inABody(`${READER_IFACE}
        const base = { read(): unknown { return process.pid } }
        function inner(r: Reader): unknown { return r.read() }
        function outer(r: Reader): unknown { return inner(r) }
        function probe(): unknown { return outer({ ...base }) }`),
      // The LAST member of a name wins, which is ECMAScript's own rule.
      aDuplicateKeyTakesTheLast: inABody(`${READER_IFACE}
        ${RUN_READER}
        function probe(): unknown {
          return run({ read(): unknown { return 1 }, read(): unknown { return process.pid } })
        }`),
    };
    for (const [name, sources] of Object.entries(charged)) {
      expect([name, rowOf(sources).requirements]).toEqual([name, ['Host<"process">']]);
    }

    // THE PRECISION, three ways, and each one is a body the program never runs.
    const precise: Record<string, Readonly<Record<string, string>>> = {
      // An explicit member AFTER the spread replaces what it published.
      anExplicitMemberOverridesTheSpread: inABody(`${READER_IFACE}
        const base = { read(): unknown { return process.pid } }
        ${RUN_READER}
        function probe(): unknown { return run({ ...base, read(): unknown { return 1 } }) }`),
      // A class's METHODS live on its prototype, and a spread copies OWN
      // enumerable properties — so `{ ...new Impl() }.read` is `undefined` at
      // run time and claiming otherwise would put a body in the route the
      // program never reaches.
      aClassMethodIsNotSpread: inABody(`${READER_IFACE}
        class Impl { read(): unknown { return process.pid } }
        ${RUN_READER}
        function probe(): unknown { return run({ ...new Impl() } as Reader) }`),
      // A spread the analyzer cannot resolve republishes nothing rather than
      // guessing at what it might hold.
      anUnresolvableSpreadSource: inABody(`${READER_IFACE}
        declare const base: Reader
        ${RUN_READER}
        function probe(): unknown { return run({ ...base }) }`),
    };
    for (const [name, sources] of Object.entries(precise)) {
      expect([name, rowOf(sources)]).toEqual([name, { requirements: [], paths: {}, refused: [] }]);
      expect([name, pinKept(sources)]).toEqual([name, true]);
    }

    // A getter written after a spread SHADOWS what the spread published, and it
    // is the getter that runs: `Clock` from the accessor's own body, and the
    // spread's `Host<"process">` method NOT charged.
    expect(rowOf(inABody(`${READER_IFACE}
      const base = { read(): unknown { return process.pid } }
      ${RUN_READER}
      function probe(): unknown {
        return run({ ...base, get read(): () => unknown { void Date.now(); return () => 1 } })
      }`)).requirements).toEqual(["Clock"]);
  });

  test("every return a factory can take is followed, and the row is their union", () => {
    const charged: Record<string, { sources: Readonly<Record<string, string>>; requirements: string[] }> = {
      // The reading return is SECOND. The first-return rule made the verdict an
      // accident of source order.
      theSecondOfTwoReturns: {
        sources: inABody(
          `function make(n: number): () => unknown { if (n) { return () => 1 } return () => process.pid }
          function run(cb: () => unknown): unknown { return cb() }
          function probe(): unknown { return run(make(1)) }`,
        ),
        requirements: ['Host<"process">'],
      },
      theThirdOfThreeReturns: {
        sources: inABody(`function make(n: number): () => unknown {
            if (n === 1) { return () => 1 }
            if (n === 2) { return () => 2 }
            return () => process.pid }
          function run(cb: () => unknown): unknown { return cb() }
          function probe(): unknown { return run(make(1)) }`),
        requirements: ['Host<"process">'],
      },
      // Returns in DIFFERENT branches of a switch.
      returnsInDifferentBranches: {
        sources: inABody(`function make(n: number): () => unknown {
            switch (n) { case 1: return () => 1; case 2: return () => process.pid }
            return () => 2 }
          function run(cb: () => unknown): unknown { return cb() }
          function probe(): unknown { return run(make(1)) }`),
        requirements: ['Host<"process">'],
      },
      // ONE return whose expression is a conditional: the same several values in
      // a different spelling, decided the same way.
      aConditionalReturn: {
        sources: inABody(
          `function make(n: number): () => unknown { return n ? () => 1 : () => process.pid }
          function run(cb: () => unknown): unknown { return cb() }
          function probe(): unknown { return run(make(1)) }`,
        ),
        requirements: ['Host<"process">'],
      },
      aConditionalInsideAnArrayLiteral: {
        sources: inABody(`const fns: Array<() => unknown> = [1 ? () => 1 : () => process.pid]
          function probe(): unknown { return fns[0]!() }`),
        requirements: ['Host<"process">'],
      },
      // BOTH returns read: the row is the union, so a blocking requirement is
      // never lost behind a non-blocking one that happened to be written first.
      bothReturnsRead: {
        sources: inABody(`function make(n: number): () => unknown {
            if (n) { return () => Date.now() } return () => process.pid }
          function run(cb: () => unknown): unknown { return cb() }
          function probe(): unknown { return run(make(1)) }`),
        requirements: ["Clock", 'Host<"process">'],
      },
      // An IDENTITY return and a literal return in one factory: the argument
      // that reached the identity is followed as well as the literal.
      anIdentityReturnBesideALiteralOne: {
        sources: inABody(`function make(n: number, cb: () => unknown): () => unknown {
            if (n) { return cb } return () => process.pid }
          function run(cb: () => unknown): unknown { return cb() }
          function probe(): unknown { return run(make(1, () => Date.now())) }`),
        requirements: ["Clock", 'Host<"process">'],
      },
      // Object literals and class instances, not only callables.
      returnedObjectLiterals: {
        sources: inABody(`${READER_IFACE}
          function make(n: number): Reader {
            if (n) { return { read(): unknown { return 1 } } }
            return { read(): unknown { return process.pid } } }
          ${RUN_READER}
          function probe(): unknown { return run(make(1)) }`),
        requirements: ['Host<"process">'],
      },
      returnedClassInstances: {
        sources: inABody(`${READER_IFACE}
          class A { read(): unknown { return 1 } }
          class B { read(): unknown { return process.pid } }
          function make(n: number): Reader { if (n) { return new A() } return new B() }
          ${RUN_READER}
          function probe(): unknown { return run(make(1)) }`),
        requirements: ['Host<"process">'],
      },
      // The result invoked DIRECTLY, with no callee in between.
      theResultInvokedDirectly: {
        sources: inABody(
          `function make(n: number): () => unknown { if (n) { return () => 1 } return () => process.pid }
          function probe(): unknown { return make(1)() }`,
        ),
        requirements: ['Host<"process">'],
      },
      inAnotherModule: {
        sources: {
          "make.sm": `export function make(n: number): () => unknown {
            if (n) { return () => 1 } return () => process.pid }`,
          "main.sm": `${PIN}
            import { make } from "./make.sm"
            function run(cb: () => unknown): unknown { return cb() }
            function probe(): unknown { return run(make(1)) }
            export function pinned(): unknown { return probe() }
            native(pinned)`,
        },
        requirements: ['Host<"process">'],
      },
      // A chain of factories, each of which can take either of two returns.
      aChainOfMultiReturnFactories: {
        sources: inABody(`function m1(n: number): () => unknown { if (n) { return () => 1 } return () => 2 }
          function m2(n: number): () => unknown { if (n) { return m1(n) } return () => 3 }
          function m3(n: number): () => unknown { if (n) { return m2(n) } return () => process.pid }
          function run(cb: () => unknown): unknown { return cb() }
          function probe(): unknown { return run(m3(1)) }`),
        requirements: ['Host<"process">'],
      },
    };
    for (const [name, form] of Object.entries(charged)) {
      expect([name, rowOf(form.sources).requirements.slice().sort()])
        .toEqual([name, form.requirements.slice().sort()]);
    }

    // THE NEGATIVES: following a return is still not INVOKING what it returns,
    // and a factory with nothing to charge still charges nothing.
    const ordinary: Record<string, Readonly<Record<string, string>>> = {
      everyReturnClean: inABody(
        `function make(n: number): () => unknown { if (n) { return () => 1 } return () => 2 }
        function run(cb: () => unknown): unknown { return cb() }
        function probe(): unknown { return run(make(1)) }`,
      ),
      keptButNeverInvoked: inABody(`${KEEP}
        function make(n: number): () => unknown { if (n) { return () => 1 } return () => process.pid }
        function probe(): unknown { return keep(make(1)) }`),
      handedToMap: inABody(
        `function make(n: number): (v: number) => unknown {
          if (n) { return () => 1 } return () => process.pid }
        function probe(): unknown { return [1].map(make(1)) }`,
      ),
      // A `return` inside a NESTED callable belongs to that callable, not to the
      // factory, so it is not one of the factory's returns.
      aReturnInsideANestedCallable: inABody(`function make(): () => unknown {
          const inner = (): unknown => { return process.pid }
          return () => (typeof inner === "string" ? 1 : 2) }
        function run(cb: () => unknown): unknown { return cb() }
        function probe(): unknown { return run(make()) }`),
    };
    for (const [name, sources] of Object.entries(ordinary)) {
      expect([name, rowOf(sources)]).toEqual([name, { requirements: [], paths: {}, refused: [] }]);
      expect([name, pinKept(sources)]).toEqual([name, true]);
    }
  });

  test("the negative direction: reaching a value is still not running it", () => {
    // NOTE for the next lane: nothing in this table is a RESIDUE. A form that
    // charges nothing because the ANALYZER cannot see it belongs in the
    // hazard-log comment at the top of this file, never here. Every row below is
    // `[]` because the PROGRAM does not run the body.
    const ordinary: Record<string, Readonly<Record<string, string>>> = {
      // A getter that is DEFINED and never read.
      aGetterTheCalleeNeverReads: inABody(`class Impl { get read(): unknown { return process.pid } }
        function run(r: { read: unknown }): unknown { return 1 }
        function probe(): unknown { return run(new Impl()) }`),
      aGetterMerelyDefined: inABody(`const holder = { get g(): unknown { return process.pid } }
        function probe(): unknown { return typeof holder }`),
      // A callable merely defined, stored, returned uninvoked, or bound.
      aCallableMerelyDefined: inABody(`const deferred = () => process.pid
        function probe(): unknown { return typeof deferred }`),
      aCallableStoredNeverCalled: inABody(`const holder = { m: () => process.pid }
        function probe(): unknown { return typeof holder.m }`),
      aCallableReturnedUninvoked: inABody(
        `function later(cb: () => unknown): () => unknown { return () => cb() }
        function probe(): unknown { return later(() => process.pid) }`,
      ),
      aBoundCallableWithNoCall: inABody(`const f = () => process.pid
        function probe(): unknown { return f.bind(null) }`),
      aClassMethodNeverCalled: inABody(`class Impl { read(): unknown { return process.pid } }
        function probe(): unknown { return new Impl() }`),
      // A spread the callee never invokes, and one it only stores.
      aSpreadArgumentNeverInvoked: inABody(`${KEEP}
        function probe(): unknown { return keep(...[() => process.pid]) }`),
      // The ambient exemptions, re-asserted INSIDE a callable each new channel
      // entered. They hold because the classification is the analyzer's existing
      // table applied at a different node, never a second opinion.
      exemptionsInsideAGetter: inABody(`class Impl {
          get read(): unknown {
            const deferred = () => process.pid
            const shadowed = (): unknown => { const process = { pid: 1 }; return process.pid }
            return Date.parse("2020-01-01") + Date.UTC(2020, 0) + Math.max(1, 2) +
              new Date(0).getTime() + (typeof deferred === "string" ? 1 : 0) +
              (typeof shadowed === "string" ? 1 : 0) } }
        ${READ_FIELD}
        function probe(): unknown { return run(new Impl()) }`),
      exemptionsInsideASpreadArgument: inABody(
        `function run(cb: () => unknown): unknown { return cb() }
        function probe(): unknown {
          return run(...[() => {
            const deferred = () => process.pid
            return Date.parse("2020-01-01") + Math.max(1, 2) +
              (typeof deferred === "string" ? 1 : 0) }]) }`,
      ),
      exemptionsInsideAnIteratedRestParameter: inABody(
        `function run(...cbs: Array<() => unknown>): unknown { for (const cb of cbs) { cb() } return 1 }
        function probe(): unknown {
          return run(() => {
            const deferred = () => process.pid
            return Date.parse("2020-01-01") + Math.max(1, 2) +
              (typeof deferred === "string" ? 1 : 0) }) }`,
      ),
      exemptionsInsideAnObjectSpread: inABody(`${READER_IFACE}
        const base = { read(): unknown {
          const deferred = () => process.pid
          return Date.parse("2020-01-01") + Math.max(1, 2) +
            (typeof deferred === "string" ? 1 : 0) } }
        ${RUN_READER}
        function probe(): unknown { return run({ ...base }) }`),
      exemptionsInsideASecondReturn: inABody(`function make(n: number): () => unknown {
          if (n) { return () => 1 }
          return () => {
            const deferred = () => process.pid
            return Date.parse("2020-01-01") + Math.max(1, 2) +
              (typeof deferred === "string" ? 1 : 0) } }
        function run(cb: () => unknown): unknown { return cb() }
        function probe(): unknown { return run(make(1)) }`),
    };
    for (const [name, sources] of Object.entries(ordinary)) {
      expect([name, rowOf(sources)]).toEqual([name, { requirements: [], paths: {}, refused: [] }]);
      expect([name, pinKept(sources)]).toEqual([name, true]);
    }

    // The COMPILE-TIME asset exemption and the compiler-owned edges, re-asserted
    // against this lane's walk.
    expect(rowOf({
      "main.sm": `${PIN}
        import config from "./data.json" with { type: "json" }
        export function pinned(): unknown { return config }
        native(pinned)`,
      "data.json": `{"a":1}`,
    })).toEqual({ requirements: [], paths: {}, refused: [] });

    // C41's precision: a module that RE-EXPORTS a foreign binding but is read
    // for a clean one still charges nothing, while the laundered binding does.
    expect(rowOf({
      "reexport.sm": `export { readFileSync } from "node:fs"\nexport const clean = 1`,
      "main.sm": `${PIN}
        import { clean } from "./reexport.sm"
        export function pinned(): unknown { return clean }
        native(pinned)`,
    })).toEqual({ requirements: [], paths: {}, refused: [] });
    expect(rowOf({
      "reexport.sm": `export { readFileSync } from "node:fs"`,
      "main.sm": `${PIN}
        import { readFileSync } from "./reexport.sm"
        export function pinned(): unknown { return readFileSync("x") }
        native(pinned)`,
    }).paths['Module<"node:fs">']).toEqual(["main.sm#pinned", "reexport.sm", "node:fs"]);

    // The deliberate over-report stays fail-CLOSED and keeps its route.
    expect(rowOf(inABody(
      `function probe(): unknown { let f = () => process.pid; f = () => 1; return f() }`,
    )).paths['Host<"process">']).toEqual(["main.sm#pinned", "main.sm#probe", "main.sm#f"]);
  });

  test("termination: the cycles unions, getters and spreads add", () => {
    // Every one terminates. The NEGATIVE half is asserted alongside the positive
    // one, because terminating by charging everything would prove nothing.
    const terminates: Record<string, { sources: Readonly<Record<string, string>>; requirements: string[] }> = {
      aForOfOverASelfReferentialList: {
        sources: inABody(
          `const fns: Array<() => unknown> = [() => { for (const cb of fns) { cb() } return 1 }]
          function probe(): unknown { return fns[0]!() }`,
        ),
        requirements: [],
      },
      aRestParameterIteratedAndForwardedToItself: {
        sources: inABody(`function run(...cbs: Array<() => unknown>): unknown {
            for (const cb of cbs) { run(cb) } return 1 }
          function probe(): unknown { return run(() => process.pid) }`),
        requirements: [],
      },
      aGetterThatReadsItself: {
        sources: inABody(`class Impl { get read(): unknown { return new Impl().read } }
          ${READ_FIELD}
          function probe(): unknown { return run(new Impl()) }`),
        requirements: [],
      },
      aGetterThreeClassesDeep: {
        sources: inABody(`class A { get read(): unknown { return process.pid } }
          class B extends A {}
          class C extends B {}
          ${READ_FIELD}
          function probe(): unknown { return run(new C()) }`),
        requirements: ['Host<"process">'],
      },
      mutuallyRecursiveMultiReturnFactories: {
        sources: inABody(`function a(): () => unknown { return b() }
          function b(): () => unknown { return a() }
          function run(cb: () => unknown): unknown { return cb() }
          function probe(): unknown { return run(a()) }`),
        requirements: [],
      },
      aMultiReturnFactoryThatRecursesThenReads: {
        sources: inABody(
          `function make(n: number): () => unknown { if (n) { return make(n - 1) } return () => process.pid }
          function run(cb: () => unknown): unknown { return cb() }
          function probe(): unknown { return run(make(1)) }`,
        ),
        requirements: ['Host<"process">'],
      },
      aSelfReferentialListWithASecondElement: {
        sources: inABody(`const fns: Array<() => unknown> = [() => fns[0]!(), () => process.pid]
          function probe(): unknown { return fns[0]!() }`),
        requirements: [],
      },
    };
    for (const [name, form] of Object.entries(terminates)) {
      expect([name, rowOf(form.sources).requirements]).toEqual([name, form.requirements]);
    }

    // THE CASE A CARELESS TERMINATION KEY DROPS, once per new channel: two call
    // sites handing ONE callee two DIFFERENT values must both be followed, and
    // the dropped one here is the BLOCKING requirement. This is also why the key
    // for a union is STRUCTURAL — a union is rebuilt at every call, and keying it
    // by identity would never converge.
    const twoValuesThroughOneCallee: Record<string, Readonly<Record<string, string>>> = {
      throughAnIteratedRestParameter: inABody(
        `function run(...cbs: Array<() => unknown>): unknown { for (const cb of cbs) { cb() } return 1 }
        function both(): unknown { return [run(() => process.pid), run(() => Date.now())] }
        function probe(): unknown { return both() }`,
      ),
      throughASpreadArgument: inABody(
        `function run(cb: () => unknown): unknown { return cb() }
        function both(): unknown { return [run(...[() => process.pid]), run(...[() => Date.now()])] }
        function probe(): unknown { return both() }`,
      ),
      throughTwoMultiReturnFactories: inABody(
        `function makeA(n: number): () => unknown { if (n) { return () => 1 } return () => process.pid }
        function makeB(n: number): () => unknown { if (n) { return () => 2 } return () => Date.now() }
        function run(cb: () => unknown): unknown { return cb() }
        function both(): unknown { return [run(makeA(1)), run(makeB(1))] }
        function probe(): unknown { return both() }`,
      ),
      throughTwoGetters: inABody(`class A { get read(): unknown { return process.pid } }
        class B { get read(): unknown { return Date.now() } }
        ${READ_FIELD}
        function both(): unknown { return [run(new A()), run(new B())] }
        function probe(): unknown { return both() }`),
    };
    for (const [name, sources] of Object.entries(twoValuesThroughOneCallee)) {
      expect([name, rowOf(sources).requirements.slice().sort()])
        .toEqual([name, ["Clock", 'Host<"process">']]);
    }
  });

  test("the fix reaches the whole pipeline, and the clean control compiles silently", () => {
    const compiled = (sources: Readonly<Record<string, string>>): string[] =>
      compileProject(
        Object.entries(sources).map(([fileName, source]) => ({ fileName, source })),
        { rootDir: "/smithers-value-union", outDir: "/smithers-value-union/out" },
      ).diagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`);

    // Two independent components refuse the program: the frontend's ambient
    // check at the `process` read, and the pin over the propagated row.
    expect(compiled({
      "config.sm": `class Impl {
  get read(): number { return process.pid }
}
function run(r: { read: number }): number { return r.read }
export const value = run(new Impl())
`,
      "main.sm": `import { value } from "./config.sm"
import { native } from "smithers:native"

export function pinned(): number {
  return value
}

native(pinned)
`,
    })).toEqual([
      "SMITHERS1601: ambient host global 'process' is unavailable; access it through a Context capability",
      'SMITHERS3001: native pin failed: Host<"process"> is required through ' +
      "main.sm#pinned -> config.sm#value -> config.sm#run -> config.sm#read -> process.pid",
    ]);

    // The clean control — the same five shapes with nothing to charge — compiles
    // with ZERO diagnostics, so the walk is not simply refusing every value it
    // can now follow.
    expect(compiled({
      "config.sm": `interface Reader { read(): number }
class Impl { get field(): number { return 1 } }
function read(r: { field: number }): number { return r.field }
function call(cb: () => number): number { return cb() }
function each(...cbs: Array<() => number>): number {
  let total = 0
  for (const cb of cbs) { total = total + cb() }
  return total
}
function pick(r: Reader): number { return r.read() }
function make(n: number): () => number { if (n) { return () => 2 } return () => 3 }
const base = { read(): number { return 4 } }
export const value = read(new Impl()) + call(...[() => 5]) + each(() => 6, () => 7) +
  pick({ ...base }) + call(make(1))
`,
      "main.sm": `import { value } from "./config.sm"
import { native } from "smithers:native"

export function pinned(): number {
  return value
}

native(pinned)
`,
    })).toEqual([]);
  });
});
