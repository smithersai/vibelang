/**
 * The gate for the Smithers-authored Core Data slice.
 *
 * `poc/src/data/*.sm` is the standard library's Core Data package written in
 * Smithers rather than in TypeScript. A `.sm` source is invisible to
 * `bun run check` and to both poc tsconfigs (they include `src/**\/*.ts` only),
 * so nothing else in the repository will ever look at these files. This test is
 * therefore the build step as well as the test.
 *
 * It proves four things, in increasing order of strength:
 *
 * 1. **Acceptance.** The seven-module project compiles with zero language and zero
 *    emitted-TypeScript diagnostics.
 * 2. **Seam-only equality.** Each `.sm` source differs from the TypeScript
 *    original it replaces *only* in the module seam — `../runtime/panic.ts`
 *    becomes `smithers:exceptions` and `./x.ts` becomes `./x.sm`. Nothing else
 *    may drift, so no behaviour can change silently between the two.
 * 3. **Plain contracts.** Every exported member carries an empty failure row.
 *    These modules panic on a forgery in ~60 places and none of those panics
 *    reaches `E`, which is what specification/failures.mdx, "Panic Does Not
 *    Widen a Return Type", requires: a panic in `E` is a panic that
 *    `unwrapOr`/`recover`/`match` can swallow.
 * 4. **Behavioural equivalence, executed.** The seven *original* TypeScript test
 *    suites are replayed unmodified against the emitted `.sm` build, against the
 *    real runtime. They are the module's existing contract, so passing them
 *    unchanged is the equivalence proof.
 *
 * **What it does not prove.** This directory holds *eight* modules, not seven.
 * `standard-library.mdx` lists `Array Chunk HashMap HashSet Result Data Match`
 * and `./index.ts` exports `Match` from this same package, but `match.ts` has no
 * `.sm` twin: applying `seam()` to it produces ten language errors, so it cannot
 * be admitted without changing something outside this directory. A gate that
 * quietly covered 7 of 8 would read as complete while its one real failure sat
 * outside the list, so the exclusion is named in `UNCOVERED` below, its blocker
 * is asserted rather than described, and the module set is derived from disk so
 * a *new* uncovered module fails this gate instead of joining the silence.
 */

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { compileAndCheckProject, emitProjectDeclarations, readDeclarationEffects } from "../language/index.ts";

/**
 * Load order matters: each module registers its structural rule when it loads.
 * `array-shape` registers nothing and is the leaf every other module's array
 * walks go through, so it loads first.
 */
const MODULES = ["array-shape", "equivalence", "hash", "data", "chunk", "hash-map", "hash-set"] as const;

/**
 * Core Data modules this gate knowingly does not cover, with the blocker that
 * keeps each one out. Every entry is asserted below: if a blocker stops
 * reproducing, this gate fails and asks for the module to be promoted into
 * `MODULES` rather than letting the exclusion outlive its reason.
 *
 * `match.ts` imports `../runtime/errors.ts` and `../runtime/result.ts`, which
 * `seam()` does not rewrite and which carry no trusted `@module` +
 * `@throws {never}` marker. `errorIs(...)` and `Result.match({...})` are
 * therefore untrusted foreign calls in authored `.sm`. Admitting it needs a seam
 * entry or a trusted marker in `poc/src/runtime/**`, which is outside this
 * package.
 */
const UNCOVERED = {
  // `SMITHERS1604` is here for a reason worth stating, because it is an
  // over-refusal and it was accepted on purpose. `match.ts`'s `safeInstanceOf`
  // reads `Function.prototype[Symbol.hasInstance]` — deliberately, since that
  // spelling resists a forgeable user-defined `Symbol.hasInstance` — and that
  // read cannot run a string as code, so the rule is stricter than the hazard
  // here. Exempting it, though, means ruling `Symbol.hasInstance` safe while
  // `constructor` stays an escape: a property-level allowlist over a namespace
  // the host may extend. That is the shape this repository already inverted an
  // allowlist to get away from, so the narrower rule would be the more
  // dangerous one. Recorded as an uncovered code rather than carved out.
  //
  // `SMITHERS1507` LEFT THIS LIST on 2026-08-30 and its absence is now part of
  // what the row asserts. The rule had two branches, and this module only ever
  // tripped the second: a checked foreign result USED AS A VALUE. That branch
  // was a placement constraint of the hoisted `Result.try(...)` wrapper, not a
  // provenance fact, and it was deleted with the statement-walk that justified
  // it (`docs/DECISIONS.md` §Typed failures). The surviving branch — a foreign
  // callee that is not a stable reference — does not fire here, so the module's
  // blockers are one code shorter. It is still uncovered for the other five.
  match: ["SMITHERS1510", "SMITHERS1303", "SMITHERS1301", "SMITHERS1509", "SMITHERS1604"],
} as const;

const DIR = import.meta.dir;
const RUNTIME_IMPORT = resolve(DIR, "../runtime/index.ts");

/**
 * The whole `.ts` -> `.sm` delta, as executable code rather than prose. Applying
 * it to the TypeScript original must reproduce the `.sm` source byte for byte.
 */
function seam(text: string): string {
  return text
    .replace(/import \{ panic \} from "\.\.\/runtime\/panic\.ts";/g, `import { panic } from "smithers:exceptions";`)
    .replace(/from "\.\/([a-z-]+)\.ts"/g, `from "./$1.sm"`);
}

function compile() {
  const sources = MODULES.map((name) => ({
    fileName: join(DIR, `${name}.sm`),
    source: readFileSync(join(DIR, `${name}.sm`), "utf8"),
  }));
  return compileAndCheckProject(sources, {
    rootDir: DIR,
    outDir: join(DIR, "__sm_out__"),
    runtimeImport: RUNTIME_IMPORT,
  });
}

/** Every Core Data implementation module on disk, tests and barrel excluded. */
function coreDataModules(): readonly string[] {
  return readdirSync(DIR)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts") && name !== "index.ts")
    .map((name) => name.slice(0, -".ts".length))
    .sort();
}

describe("data/** authored in Smithers", () => {
  test("the gate accounts for every Core Data module, covered or excluded", () => {
    // Derived from disk, not restated, so adding a module without a `.sm` twin
    // fails here instead of silently enlarging the uncovered set.
    const accounted = [...MODULES, ...Object.keys(UNCOVERED)].sort();
    expect(coreDataModules()).toEqual(accounted);
    // And the barrel agrees these are one package: an excluded module is still
    // shipped to users, which is exactly why the exclusion has to be visible.
    const barrel = readFileSync(join(DIR, "index.ts"), "utf8");
    for (const name of Object.keys(UNCOVERED)) {
      expect([name, barrel.includes(`from "./${name}.ts"`)]).toEqual([name, true]);
    }
  });

  test.each(Object.entries(UNCOVERED))(
    "the recorded blocker for the excluded module %s still reproduces",
    (name, expectedCodes) => {
      const seamed = seam(readFileSync(join(DIR, `${name}.ts`), "utf8"));
      const checked = compileAndCheckProject(
        [
          ...MODULES.map((module) => ({
            fileName: join(DIR, `${module}.sm`),
            source: readFileSync(join(DIR, `${module}.sm`), "utf8"),
          })),
          { fileName: join(DIR, `${name}.sm`), source: seamed },
        ],
        { rootDir: DIR, outDir: join(DIR, "__sm_excluded_out__"), runtimeImport: RUNTIME_IMPORT },
      );
      const errors = checked.result.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
      // If this ever passes, the exclusion has outlived its reason: move the
      // module into MODULES, add its suite to the replay, and delete it here.
      expect([name, checked.ok, errors.length > 0]).toEqual([name, false, true]);
      expect([...new Set(errors.map((diagnostic) => diagnostic.code))].sort())
        .toEqual([...expectedCodes].sort());
    },
  );

  test("the .sm project satisfies the acceptance rule with no diagnostics", () => {
    const checked = compile();
    const errors = checked.result.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
    expect(errors).toEqual([]);
    expect(checked.emitDiagnostics).toEqual([]);
    expect(checked.ok).toBe(true);
  });

  test("each .sm source differs from its TypeScript original only in the module seam", () => {
    for (const name of MODULES) {
      const typescript = readFileSync(join(DIR, `${name}.ts`), "utf8");
      const smithers = readFileSync(join(DIR, `${name}.sm`), "utf8");
      expect(seam(typescript)).toBe(smithers);
    }
  });

  test("no .sm source names a compiler-owned lowering hook in code", () => {
    // Comments are excluded: `equivalence.sm` legitimately *discusses*
    // `__vsResultSuccess` in its module docstring, as the example of a hook the
    // runtime keeps out of its public namespace.
    const withoutComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const name of MODULES) {
      const code = withoutComments(readFileSync(join(DIR, `${name}.sm`), "utf8"));
      for (const hook of ["__vsInspectResult", "__vsResultSuccess", "__vsResultFailure", "__vsPanicValue"]) {
        expect([name, code.includes(hook)]).toEqual([name, false]);
      }
    }
  });

  test("panic lowers to the compiler-owned hook in every module that panics", () => {
    const files = Object.values(compile().result.files);
    for (const file of files) {
      // `hash-set` delegates rather than panicking directly in some builds; the
      // rule under test is that a panic never lowers to anything else.
      const authoredPanics = (readFileSync(file.absoluteFileName, "utf8").match(/\bpanic\(/g) ?? []).length;
      const loweredPanics = (file.code.match(/__vsPanicValue\(/g) ?? []).length;
      expect(loweredPanics).toBe(authoredPanics);
    }
  });

  test("every exported member keeps a plain contract: panic never reaches the failure row", () => {
    let members = 0;
    for (const file of Object.values(compile().result.files)) {
      const rows = file.analysis.rows as Record<string, { failures: readonly string[] }>;
      for (const [name, row] of Object.entries(rows)) {
        members += 1;
        expect([name, row.failures]).toEqual([name, []]);
      }
    }
    // A guard against the rows silently becoming empty because nothing was read.
    expect(members).toBeGreaterThan(100);
  });

  test("declaration emit succeeds and publishes a panic-free public contract", () => {
    const checked = compile();
    const declarations = emitProjectDeclarations(
      Object.values(checked.result.files).map((file) => ({
        fileName: file.outputFileName,
        code: file.code,
        effects: file.analysis.rows,
      })),
    );
    expect(declarations.diagnostics.filter((diagnostic) => diagnostic.category === 1)).toEqual([]);
    expect(declarations.ok).toBe(true);
    expect(declarations.outputs.length).toBe(MODULES.length);
    for (const output of declarations.outputs) {
      // The shipped `.d.ts` must not advertise a Panic channel: a consumer that
      // sees one would be entitled to `recover` from it.
      expect([output.fileName, output.code.includes("Panic")]).toEqual([output.fileName, false]);
      const effects = readDeclarationEffects(output.code);
      for (const row of Object.values(effects)) expect(row.failures).toEqual([]);
    }
  });

  test("the original TypeScript suites pass unmodified against the executed .sm build", () => {
    const checked = compile();
    expect(checked.ok).toBe(true);

    const root = mkdtempSync(join(tmpdir(), "smithers-data-sm-"));
    try {
      for (const file of Object.values(checked.result.files)) {
        writeFileSync(join(root, `${file.outputFileName.split("/").pop()}`), file.code);
      }
      // The suites are copied byte for byte except for their import specifiers:
      // sibling `./x.ts` now names the emitted `.sm` output, and everything
      // outside this directory is pinned to the one real runtime instance so
      // `isPanic` compares against the same brand the emitted code throws.
      for (const name of MODULES) {
        const suite = readFileSync(join(DIR, `${name}.test.ts`), "utf8")
          .replace(/from "\.\.\/([a-z-]+)\/([a-z-]+)\.ts"/g, `from "${resolve(DIR, "..")}/$1/$2.ts"`);
        writeFileSync(join(root, `${name}.replay.test.ts`), suite);
      }

      const run = spawnSync(process.execPath, ["test", root], { cwd: root, encoding: "utf8" });
      const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
      const summary = /(\d+) pass[\s\S]*?(\d+) fail/.exec(output);
      // 107 is the seven covered suites. The excluded modules' suites are not
      // replayed at all, so this count is a floor on Core Data, not its total.
      expect(summary === null ? output : `${summary[1]} pass / ${summary[2]} fail`).toBe("107 pass / 0 fail");
      expect(run.status).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
