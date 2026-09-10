/**
 * The gate for `internal.vibe`, the one `poc/src/platform` module that can be
 * authored in VibeLang today.
 *
 * `platform/**` is the floor of the capability system, and almost none of it is
 * portable: a capability's *implementation* must read an ambient host global
 * (`process`, `Date.now`), which `.vibe` forbids and offers no opt-out from, and
 * every module that declares its own `Error` needs a payload codec that `.vibe`
 * has no seam to register. `internal.ts` does neither — it is pure host-detail
 * inspection over `unknown` — so it compiles as `.vibe` with no transform at all.
 *
 * A `.vibe` source is invisible to `bun run check` and to both poc tsconfigs, so
 * this test is the build step as well as the test: it compiles the module,
 * asserts the acceptance rule, executes the emitted code, and compares every
 * verdict against the TypeScript original across a sample matrix.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { compileAndCheckVibeLang } from "../language/index.ts";
import { causeDetail as typeScriptCauseDetail, errnoCode as typeScriptErrnoCode } from "./internal.ts";

const SOURCE_FILE = resolve(import.meta.dir, "internal.vibe");
const RUNTIME_IMPORT = resolve(import.meta.dir, "../runtime/index.ts");

function compile() {
  return compileAndCheckVibeLang(readFileSync(SOURCE_FILE, "utf8"), {
    fileName: SOURCE_FILE,
    outputFileName: resolve(import.meta.dir, "internal.vibe.generated.ts"),
    runtimeImport: RUNTIME_IMPORT,
    sourceName: "internal.vibe",
  });
}

interface SmModule {
  errnoCode(cause: unknown): string | undefined;
  causeDetail(cause: unknown): string;
}

let cached: Promise<{ module: SmModule; dispose: () => void }> | undefined;

function load(): Promise<{ module: SmModule; dispose: () => void }> {
  cached ??= (async () => {
    const checked = compile();
    if (!checked.ok) throw new TypeError("internal.vibe did not compile");
    const root = mkdtempSync(join(tmpdir(), "vibelang-platform-internal-sm-"));
    const entry = join(root, "internal.ts");
    writeFileSync(entry, checked.result.code);
    const module = await import(pathToFileURL(entry).href) as SmModule;
    return { module, dispose: () => rmSync(root, { recursive: true, force: true }) };
  })();
  return cached;
}

/** Every documented shape of an errno-carrying rejection, plus the near misses. */
const SAMPLES: readonly unknown[] = [
  undefined,
  null,
  0,
  -0,
  Number.NaN,
  "",
  "a string cause",
  true,
  false,
  Symbol("s"),
  10n,
  {},
  { code: "ENOENT" },
  { code: "" },
  { code: 42 },
  { code: null },
  { code: Symbol("ENOENT") },
  Object.create(null),
  Object.assign(Object.create(null), { code: "EACCES" }),
  [],
  ["ENOENT"],
  Object.assign([], { code: "EPERM" }),
  new Error(""),
  new Error("boom"),
  new TypeError("wrong type"),
  Object.assign(new Error("with code"), { code: "EEXIST" }),
  new Error("outer", { cause: new Error("inner") }),
  () => undefined,
  Object.assign(() => undefined, { code: "EPIPE" }),
  new Date(0),
  new Map(),
  Promise.resolve(),
];

describe("platform/internal authored in VibeLang", () => {
  test("the .vibe source satisfies the acceptance rule with no diagnostics", () => {
    const checked = compile();
    expect(checked.result.analysis.diagnostics).toEqual([]);
    expect(checked.emitDiagnostics).toEqual([]);
    expect(checked.ok).toBe(true);
  });

  test("both members keep a plain contract with an empty failure row", () => {
    expect(compile().result.analysis.rows).toEqual({
      errnoCode: { failures: [], requirements: [] },
      causeDetail: { failures: [], requirements: [] },
    });
  });

  test("the module needs no lowering at all: the emitted code is the authored source", () => {
    // `internal.ts` has no `panic`, no `throw`, and no Result, so the compiler
    // has nothing to lower. This is the cheapest possible port and the proof
    // that plain TypeScript in the VibeLang idiom passes through untouched.
    const checked = compile();
    expect(checked.result.code).toBe(readFileSync(SOURCE_FILE, "utf8"));
    for (const hook of ["__vsInspectResult", "__vsResultSuccess", "__vsResultFailure", "__vsPanicValue"]) {
      expect(checked.result.code).not.toContain(hook);
    }
  });

  test("the .vibe source is identical to the TypeScript original it replaces", () => {
    expect(readFileSync(SOURCE_FILE, "utf8")).toBe(readFileSync(resolve(import.meta.dir, "internal.ts"), "utf8"));
  });

  test("errnoCode agrees with the TypeScript original on every sample", async () => {
    const { module } = await load();
    SAMPLES.forEach((sample, index) => {
      expect([index, module.errnoCode(sample)]).toEqual([index, typeScriptErrnoCode(sample)]);
    });
  });

  test("causeDetail agrees with the TypeScript original on every sample", async () => {
    const { module } = await load();
    SAMPLES.forEach((sample, index) => {
      expect([index, module.causeDetail(sample)]).toEqual([index, typeScriptCauseDetail(sample)]);
    });
  });

  test("the documented policies hold in the executed .vibe build", async () => {
    const { module, dispose } = await load();
    try {
      // errnoCode reports only a non-empty string `code`, and nothing else.
      expect(module.errnoCode({ code: "ENOENT" })).toBe("ENOENT");
      expect(module.errnoCode({ code: "" })).toBeUndefined();
      expect(module.errnoCode({ code: 42 })).toBeUndefined();
      expect(module.errnoCode("ENOENT")).toBeUndefined();
      expect(module.errnoCode(null)).toBeUndefined();
      // A prototype-less carrier still works: the read is a plain property get.
      expect(module.errnoCode(Object.assign(Object.create(null), { code: "EACCES" }))).toBe("EACCES");
      // causeDetail prefers an Error message, then a string, then the fallback.
      expect(module.causeDetail(new Error("boom"))).toBe("boom");
      expect(module.causeDetail(new Error(""))).toBe("unknown cause");
      expect(module.causeDetail("plain")).toBe("plain");
      expect(module.causeDetail("")).toBe("unknown cause");
      expect(module.causeDetail({ message: "not an Error" })).toBe("unknown cause");
    } finally {
      dispose();
      cached = undefined;
    }
  });
});
