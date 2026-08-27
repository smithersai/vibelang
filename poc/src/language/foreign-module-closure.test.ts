/**
 * The module-initialization trust marker is asked of every foreign module
 * evaluation REACHES, not only of the ones the authored `.sm` happens to name.
 *
 * `specification/failures.mdx` §Foreign Exceptions (Locked) grants the opt-out
 * per module — "`@throws {never}` removes the default panic case" — and
 * `SMITHERS1510` exists because "a checked call boundary cannot observe an
 * exception thrown while ESM is linking/evaluating its static dependency
 * graph". Linking is transitive: importing a marked relay evaluates everything
 * that relay's own evaluation reaches, before any checked call boundary exists.
 * A claim that stopped at depth one would therefore be a claim about the wrong
 * set of modules — and until 2026-08-27 that is exactly what this compiler
 * checked, because `checkForeignModuleInitializers` read only
 * `sourceFile.statements` of the `.sm`.
 *
 * Measured before the closure walk landed, on BOTH backends, with a module-scope
 * oracle in the unmarked module: a properly marked relay doing
 * `export { config } from "./sneaky.ts"` conferred its own trust on a
 * `./sneaky.ts` carrying no marker at all, a miscased one, a `//` line comment,
 * a plain block comment and an NBSP-spelled one — at depth 2, at depth 3, around
 * a cycle and through a diamond. Every one compiled clean and the untrusted
 * initializer RAN. The shipped CLI refused all of them, because
 * `src/relative-runtime-graph.ts` has always walked the reached-module closure;
 * `compileProject` is a public API and the Go fork is invoked directly, so the
 * wrapper covering it is not the language having the rule.
 *
 * The NEGATIVE half of this file is not the load-bearing half on its own. A
 * closure walk is exactly the shape of change that over-refuses, so every rule
 * below is paired with the acceptance that proves it did not: a marked chain
 * still confers trust at every depth AND its initializers still run; a type-only
 * edge adds no runtime requirement; a genuinely deferred loader is still not an
 * initialization edge; and the compiler's own runtime seam is untouched.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { compileAndCheckProject } from "./index.ts";

const workspace = mkdtempSync(join(tmpdir(), "smithers-module-closure-"));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));

const RUNTIME = join(import.meta.dir, "../runtime/index.ts");
const MARK = "/** @module @throws {never} */\n";

let sequence = 0;

interface Compiled {
  readonly codes: readonly string[];
  readonly emitted: number;
  readonly code: string;
}

/** Write one foreign module into the workspace and return its `.sm` specifier. */
function foreign(name: string, text: string): string {
  writeFileSync(join(workspace, name), text);
  return `./${name}`;
}

function compile(source: string): Compiled {
  sequence += 1;
  const fileName = join(workspace, `case-${sequence}.sm`);
  const checked = compileAndCheckProject([{ fileName, source }], {
    rootDir: workspace,
    outDir: join(workspace, "out"),
    runtimeImport: RUNTIME,
  });
  const errors = checked.result.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  return {
    codes: errors.map((diagnostic) => `${diagnostic.code}@${diagnostic.line}:${diagnostic.column}`),
    emitted: checked.emitDiagnostics.length,
    code: Object.values(checked.result.files)[0]?.code ?? "",
  };
}

/**
 * Compile, emit and RUN one program, returning what each foreign module's
 * module scope announced, in evaluation order.
 *
 * This is the oracle the negative half is measured against: "the rule did not
 * fire" and "the untrusted initializer ran" are different claims, and only this
 * one can tell them apart.
 */
async function run(source: string): Promise<readonly string[]> {
  sequence += 1;
  const stamp = `run-${sequence}`;
  const fileName = join(workspace, `${stamp}.sm`);
  const checked = compileAndCheckProject([{ fileName, source }], {
    rootDir: workspace,
    outDir: join(workspace, `${stamp}-out`),
    runtimeImport: pathToFileURL(RUNTIME).href,
  });
  expect(checked.result.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  expect(checked.emitDiagnostics).toEqual([]);

  const bag = globalThis as unknown as { __closureOracle?: string[] };
  bag.__closureOracle = [];
  const file = Object.values(checked.result.files)[0]!;
  const javascript = new Bun.Transpiler({ loader: "ts", target: "bun" }).transformSync(file.code);
  const modulePath = join(workspace, `${stamp}.mjs`);
  writeFileSync(modulePath, javascript.replaceAll(`from "../`, `from "./`));
  const module = await import(pathToFileURL(modulePath).href) as { main(): string };
  module.main();
  return [...(bag.__closureOracle ?? [])];
}

/** A reached module that announces its own initialization when it evaluates. */
function announcing(label: string, marker: string): string {
  return `${marker}const bag = globalThis as unknown as { __closureOracle?: string[] };\n` +
    `bag.__closureOracle ??= [];\nbag.__closureOracle.push(${JSON.stringify(label)});\n` +
    "export interface Config { readonly retries: number }\n" +
    "export const config: Config = { retries: 3 };\n";
}

describe("the trust marker is asked of every module initialization reaches", () => {
  test("a marked relay does not lend its claim to the module behind it", () => {
    // The reproduction, at the position every other SMITHERS1510 case in the
    // corpus declares: the authored import specifier, which is the only text in
    // the `.sm` its author can change. The relay's own claim is honest; the
    // module behind it has made none.
    foreign("relay-plain.ts", `${MARK}export { config } from "./sneaky-plain.ts";\n`);
    foreign("sneaky-plain.ts", announcing("sneaky-plain", ""));
    expect(compile(`import { config } from "./relay-plain.ts"
export function main(): string { return typeof config }
`).codes).toEqual(["SMITHERS1510@1:24"]);
  });

  test("depth is not a bound: two hops and three hops are the same rule", () => {
    foreign("relay-d3.ts", `${MARK}export { config } from "./middle-d3.ts";\n`);
    foreign("middle-d3.ts", `${MARK}export { config } from "./sneaky-d3.ts";\n`);
    foreign("sneaky-d3.ts", announcing("sneaky-d3", ""));
    expect(compile(`import { config } from "./relay-d3.ts"
export function main(): string { return typeof config }
`).codes).toEqual(["SMITHERS1510@1:24"]);
  });

  test("every near-miss spelling is a near miss at depth two as well as at depth one", () => {
    // The marker predicate is shared with the depth-one check by construction —
    // `hasLeadingModuleNoThrowMarker` is called from one place for both — so this
    // is not a second implementation to keep in step. It is the assertion that
    // the closure ASKS, which is the half that was missing: before the walk
    // landed all five of these compiled clean and their initializers ran.
    const nearMisses: readonly (readonly [string, string])[] = [
      ["absent", ""],
      ["miscased", "/** @MODULE @throws {never} */\n"],
      ["line-comment", "// /** @module @throws {never} */\n"],
      ["block-comment", "/* @module @throws {never} */\n"],
      ["nbsp", "/** @module @throws {\u00A0never\u00A0} */\n"],
    ];
    const observed: Record<string, readonly string[]> = {};
    const expected: Record<string, readonly string[]> = {};
    for (const [name, marker] of nearMisses) {
      foreign(`relay-${name}.ts`, `${MARK}export { config } from "./sneaky-${name}.ts";\n`);
      foreign(`sneaky-${name}.ts`, announcing(`sneaky-${name}`, marker));
      observed[name] = compile(`import { config } from "./relay-${name}.ts"
export function main(): string { return typeof config }
`).codes;
      expected[name] = ["SMITHERS1510@1:24"];
    }
    expect(observed).toEqual(expected);
  });

  test("a cycle terminates, and a diamond reports the shared module once", () => {
    // Both shapes exist to prove the walk answers each module once rather than
    // once per path: a cycle would not terminate otherwise, and the diamond
    // would report `SMITHERS1510` twice for one missing marker.
    foreign("cycle-a.ts", `${MARK}import { ping } from "./cycle-b.ts";
export { config } from "./cycle-sneaky.ts";
export function pong(): number { return ping(); }
`);
    foreign("cycle-b.ts", `${MARK}import { pong } from "./cycle-a.ts";
export function ping(): number { return 1; }
export function echo(): number { return pong(); }
`);
    foreign("cycle-sneaky.ts", announcing("cycle-sneaky", ""));
    expect(compile(`import { config } from "./cycle-a.ts"
export function main(): string { return typeof config }
`).codes).toEqual(["SMITHERS1510@1:24"]);

    foreign("diamond-left.ts", `${MARK}export { config } from "./diamond-sneaky.ts";\n`);
    foreign("diamond-right.ts", `${MARK}export { config as other } from "./diamond-sneaky.ts";\n`);
    foreign("diamond-sneaky.ts", announcing("diamond-sneaky", ""));
    expect(compile(`import { config } from "./diamond-left.ts"
import { other } from "./diamond-right.ts"
export function main(): string { return typeof config + typeof other }
`).codes).toEqual(["SMITHERS1510@1:24"]);
  });

  test("an untrusted module at depth one is refused once, not cascaded into", () => {
    // The program is already rejected at the edge the author wrote. Reporting
    // its dependencies' markers as well would bury the one line that can be
    // fixed under diagnostics about files the author may not own.
    foreign("untrusted-head.ts", `export { config } from "./untrusted-tail.ts";\n`);
    foreign("untrusted-tail.ts", announcing("untrusted-tail", ""));
    expect(compile(`import { config } from "./untrusted-head.ts"
export function main(): string { return typeof config }
`).codes).toEqual(["SMITHERS1510@1:24"]);
  });
});

describe("the closure follows module evaluation, and only module evaluation", () => {
  test("a dynamic import at a foreign module's own scope is an initialization edge", () => {
    // `moduleInitializationClassifier` defaults to "initialization"; "deferred"
    // is what must be proven. Awaiting an import at module scope is the load,
    // and there is no checked call boundary anywhere near it.
    foreign("dyn-relay.ts", `${MARK}const loaded = await import("./dyn-sneaky.ts");
export const config = loaded.config;
`);
    foreign("dyn-sneaky.ts", announcing("dyn-sneaky", ""));
    expect(compile(`import { config } from "./dyn-relay.ts"
export function main(): string { return typeof config }
`).codes).toEqual(["SMITHERS1510@1:24"]);

    // Not awaited, and not even read: the module still evaluates.
    foreign("dyn-void-relay.ts", `${MARK}const pending = import("./dyn-void-sneaky.ts");
void pending;
export const config = { retries: 3 };
`);
    foreign("dyn-void-sneaky.ts", announcing("dyn-void-sneaky", ""));
    expect(compile(`import { config } from "./dyn-void-relay.ts"
export function main(): string { return typeof config }
`).codes).toEqual(["SMITHERS1510@1:24"]);
  });

  test("an exported loader module scope also calls is an initialization edge", () => {
    // The deferral proof is "module-scope code cannot get hold of the function
    // value at all". Calling it one line down is the counterexample the proof
    // exists to catch, and being exported does not defer anything on its own.
    foreign("eager-relay.ts", `${MARK}export async function load() { return (await import("./eager-sneaky.ts")).config; }
export const eager = await load();
export const config = { retries: 3 };
`);
    foreign("eager-sneaky.ts", announcing("eager-sneaky", ""));
    expect(compile(`import { config } from "./eager-relay.ts"
export function main(): string { return typeof config }
`).codes).toEqual(["SMITHERS1510@1:24"]);
  });

  test("a genuinely deferred exported loader is not an initialization edge", () => {
    // The keep-green the rule is most likely to break. Nothing at module scope
    // mentions `load`, so module evaluation cannot reach the import, and the
    // reached module is never asked for a marker — it does not have one.
    foreign("lazy-relay.ts", `${MARK}export async function load() { return (await import("./lazy-sneaky.ts")).config; }
export const config = { retries: 3 };
`);
    foreign("lazy-sneaky.ts", announcing("lazy-sneaky", ""));
    expect(compile(`import { config } from "./lazy-relay.ts"
export function main(): string { return typeof config }
`).codes).toEqual([]);
  });

  test("a type-only edge adds no runtime requirement in any of its three spellings", () => {
    // An erased edge has no runtime at all, so there is nothing to initialize
    // and nothing to claim. All three spellings the language recognises are
    // checked, because the whole-clause form and the per-binding form are
    // separate tests in the code that reads them.
    const spellings: readonly (readonly [string, string])[] = [
      ["import-type", `import type { Config } from "./type-sneaky.ts";\nexport const config: Config = { retries: 3 };\n`],
      ["inline-type", `import { type Config } from "./type-sneaky.ts";\nexport const config: Config = { retries: 3 };\n`],
      ["export-type", `export type { Config } from "./type-sneaky.ts";\nexport const config = { retries: 3 };\n`],
    ];
    foreign("type-sneaky.ts", announcing("type-sneaky", ""));
    const observed: Record<string, readonly string[]> = {};
    const expected: Record<string, readonly string[]> = {};
    for (const [name, body] of spellings) {
      foreign(`type-relay-${name}.ts`, `${MARK}${body}`);
      observed[name] = compile(`import { config } from "./type-relay-${name}.ts"
export function main(): string { return typeof config }
`).codes;
      expected[name] = [];
    }
    expect(observed).toEqual(expected);
  });

  test("a non-relative depth-one edge is still checked, but seeds no closure", () => {
    // The closure IS the relative runtime graph, and a specifier this
    // compilation does not resolve, place or emit is outside it — the same
    // boundary `src/relative-runtime-graph.ts` draws, where a non-relative edge
    // comes back with no target and never becomes a root.
    //
    // This is the boundary that keeps the compiler's own runtime out of the
    // rule. `runtime/introspection.ts` carries the module claim so authored
    // `.sm` may call the brand seam; `runtime/result.ts` and `runtime/panic.ts`
    // deliberately carry none, because trusting them would put a `Result`
    // constructor one import away from authored `.sm`. That is the forgery
    // guarantee recorded in `runtime/introspection.ts`'s own header, and
    // `capability-seams.test.ts` SEAM 3 is the case that would break.
    const introspection = join(import.meta.dir, "../runtime/introspection.ts");
    expect(compile(`import { isResult } from ${JSON.stringify(introspection)}
export function main(): string { return isResult(1) ? "yes" : "no" }
`).codes).toEqual([]);

    // The depth-one claim itself is NOT relaxed by that: an unmarked module
    // named by an absolute path is refused exactly as a relative one is.
    const unmarked = join(workspace, "absolute-unmarked.ts");
    writeFileSync(unmarked, announcing("absolute-unmarked", ""));
    expect(compile(`import { config } from ${JSON.stringify(unmarked)}
export function main(): string { return typeof config }
`).codes).toEqual([`SMITHERS1510@1:24`]);
  });
});

describe("a marked chain still confers trust, and its initializers still run", () => {
  test("three marked hops compile clean and evaluate in dependency order", async () => {
    // The accepting half, observed by EXECUTION rather than by a clean compile:
    // a refusal and a silently dropped edge look identical to a diagnostics
    // assertion, and only one of them is the rule working.
    foreign("ok-relay.ts", `${MARK}export { config } from "./ok-middle.ts";\n`);
    foreign("ok-middle.ts", `${MARK}export { config } from "./ok-deep.ts";\n`);
    foreign("ok-deep.ts", announcing("ok-deep", MARK));
    expect(await run(`import { config } from "./ok-relay.ts"
export function main(): string { return typeof config }
`)).toEqual(["ok-deep"]);
  });

  test("the deferred loader's module is not loaded, which is why it needs no marker", async () => {
    // The other side of the deferral proof, and the only assertion that can tell
    // "correctly deferred" from "wrongly dropped": if module evaluation reached
    // `lazy-run-sneaky.ts` at all, its label would be in the list.
    foreign("lazy-run-relay.ts", `${MARK}const bag = globalThis as unknown as { __closureOracle?: string[] };
bag.__closureOracle ??= [];
bag.__closureOracle.push("lazy-run-relay");
export async function load() { return (await import("./lazy-run-sneaky.ts")).config; }
export const config = { retries: 3 };
`);
    foreign("lazy-run-sneaky.ts", announcing("lazy-run-sneaky", ""));
    expect(await run(`import { config } from "./lazy-run-relay.ts"
export function main(): string { return typeof config }
`)).toEqual(["lazy-run-relay"]);
  });
});
