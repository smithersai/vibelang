/**
 * The gate for the VibeLang-authored slice of `poc/src/platform/**`.
 *
 * A `.vibe` source is invisible to `bun run check` and to both poc tsconfigs
 * (they include `src/**\/*.ts` only), so nothing else in the repository will
 * ever look at these files. This test is therefore the build step as well as
 * the test.
 *
 * **What is under test, and what is deliberately not.** `platform/**` differs
 * from `data/**` in the two ways that make it harder, and both are visible in
 * which modules appear below:
 *
 * - **8 of its modules declare nominal errors** (30 identities, all spelled
 *   `vibelang:<Name>@1`): `config`, `file-errors`, `http`, `instant`, `path`,
 *   `process`, `socket`, `terminal`. The compiler owns nominal identity and
 *   derives it from the source path, so porting one changes its transported
 *   identity. Whether an author may control that identity is an open
 *   specification question, so every error-declaring module is deliberately
 *   absent here — and so is every module that imports one, which is why
 *   `clock` (→ `instant`), `filesystem` (→ `file-errors`), `schedule`
 *   (→ `clock`), `layers` and `index` are absent too.
 * - **Its live implementations reach host globals**, which authored `.vibe` may
 *   not name. The route is the module boundary: the capability and its
 *   implementation are authored in `.vibe`, and the host read lives in `./host.ts`,
 *   a trusted TypeScript binding. That is the pattern `environment`, `random`
 *   and `console` use, and it is what test 1 and the host-write differential
 *   prove together.
 * - **`duration` is authored, complete, and refused, so it is not in the gate.**
 *   Its `Duration.codec` reaches the runtime's foreign `ValueCodec` interface
 *   through ./wire-adapter.ts, and freezing a namespace that carries that value
 *   is `VIBE1508` on both backends, in both spellings. That is an open
 *   decision, not a defect in the module, so the module is parked rather than
 *   routed around: the blocked tests below pin both contract diagnostics and
 *   require the compiler to publish no executable artifact for the refusal.
 *
 * The proofs, in increasing order of strength:
 *
 * 1. **Acceptance.** The project compiles with zero language and zero
 *    emitted-TypeScript diagnostics.
 * 2. **Plain contracts.** Every exported member carries an empty failure row.
 *    `random.vibe` panics in six places on a contract violation and none of those
 *    panics reaches `E`, which is what specification/failures.mdx, "Panic Does
 *    Not Widen a Return Type", requires: a panic in `E` is a panic that
 *    `unwrapOr`/`recover`/`match` can swallow.
 * 3. **No host global is named in authored `.vibe`.** The whole point of the
 *    module boundary is that the prohibition still binds on the `.vibe` side.
 * 4. **The public API did not change.** The exported names of each `.vibe` module
 *    are exactly those of the TypeScript module it replaces.
 * 5. **Behavioural equivalence, executed.** The *original* TypeScript suites are
 *    replayed unmodified against the emitted `.vibe` build, against the real
 *    runtime. They are the modules' existing contract, so passing them unchanged
 *    is the equivalence proof.
 */

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { compileAndCheckProject, emitProjectDeclarations, readDeclarationEffects } from "../language/index.ts";

/** The platform modules that are authored in VibeLang *and accepted* today. */
const MODULES = ["environment", "random", "console"] as const;

/**
 * Authored in VibeLang but refused on unresolved contracts, so deliberately
 * absent from `MODULES` above. Its TypeScript counterpart still has direct
 * behavior tests; those do not certify the rejected `.vibe` port.
 */
const BLOCKED = ["duration"] as const;

const DIR = import.meta.dir;
const RUNTIME_IMPORT = resolve(DIR, "../runtime/index.ts");

function compile(overrides: Readonly<Record<string, string>> = {}) {
  const sources = MODULES.map((name) => ({
    fileName: join(DIR, `${name}.vibe`),
    source: overrides[name] ?? readFileSync(join(DIR, `${name}.vibe`), "utf8"),
  }));
  return compileAndCheckProject(sources, {
    rootDir: DIR,
    outDir: join(DIR, "__sm_out__"),
    runtimeImport: RUNTIME_IMPORT,
  });
}

/** The codes the host-global rule reports: VIBE1601/1602/1603. */
const HOST_RULE_CODES: ReadonlySet<string> = new Set(["VIBE1601", "VIBE1602", "VIBE1603"]);

function hostRuleRefusals(checked: ReturnType<typeof compile>): string[] {
  return checked.result.diagnostics
    .filter((diagnostic) => HOST_RULE_CODES.has(diagnostic.code))
    .map((diagnostic) => `${basename(diagnostic.fileName)}:${diagnostic.line}:${diagnostic.column} ${diagnostic.code}`)
    .sort();
}

/** Exported names, read from source text rather than by importing a `.vibe`. */
function exportedNames(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(/^export (?:abstract )?(?:class|function|const|interface|type|enum) ([A-Za-z0-9_$]+)/gm)) {
    names.add(match[1] as string);
  }
  for (const match of text.matchAll(/^export (?:type )?\{([^}]*)\}/gm)) {
    for (const part of (match[1] as string).split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) names.add(name);
    }
  }
  return [...names].sort();
}

/**
 * Copy one trusted TypeScript binding into a replay tree, pinning its own
 * `../runtime/*` imports to the one real runtime instance — the tree is not
 * under `poc/src/`, so a relative specifier would not resolve there.
 */
function copyBinding(name: string, root: string): void {
  const text = readFileSync(join(DIR, name), "utf8")
    .replace(/from "\.\.\/([a-z-]+)\/([a-z-]+)\.ts"/g, `from "${resolve(DIR, "..")}/$1/$2.ts"`);
  writeFileSync(join(root, name), text);
}

describe("platform/** authored in VibeLang", () => {
  test("the .vibe project satisfies the acceptance rule with no diagnostics", () => {
    const checked = compile();
    const errors = checked.result.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
    expect(errors).toEqual([]);
    expect(checked.emitDiagnostics).toEqual([]);
    expect(checked.ok).toBe(true);
  });

  test("panic never reaches a failure row, and the only declared failure is the one that should be there", () => {
    // Two separate claims, because they are different obligations.
    //
    // 1. `Panic` appears in NO row. specification/failures.mdx, "Panic Does Not
    //    Widen a Return Type": a panic inside `E` is one that `unwrapOr`,
    //    `recover`, and `match` consume as an ordinary failure.
    // 2. The set of members that declare ANY failure is pinned BY NAME rather
    //    than merely required to be empty, so that a newly fallible member shows
    //    up as a change rather than as a number that still passes a bound. It is
    //    empty only because `duration.vibe` — whose module-private `decodeMillis`
    //    legitimately answers `Result<number, TypeError>` for a malformed wire
    //    payload — is parked; the pin is the mechanism, not the emptiness.
    let members = 0;
    const declared: string[] = [];
    for (const file of Object.values(compile().result.files)) {
      const rows = file.analysis.rows as Record<string, { failures: readonly string[]; requirements: readonly string[] }>;
      for (const [name, row] of Object.entries(rows)) {
        members += 1;
        expect([name, row.failures.includes("Panic")]).toEqual([name, false]);
        if (row.failures.length > 0) declared.push(`${basename(file.fileName)}:${name} ${row.failures.join("|")}`);
      }
    }
    expect(declared).toEqual([]);
    expect(members).toBeGreaterThan(20);
  });

  test("panic lowers to the compiler-owned hook, and nothing else", () => {
    for (const file of Object.values(compile().result.files)) {
      const authored = (readFileSync(file.absoluteFileName, "utf8").match(/\bpanic\(/g) ?? []).length;
      const lowered = (file.code.match(/throw new __vsPanicType(?:_\d+)?\(/g) ?? []).length;
      expect([file.fileName, lowered]).toEqual([file.fileName, authored]);
      if (authored > 0) {
        expect(file.code).toMatch(/import \{ Panic as __vsPanicType(?:_\d+)? \} from/);
      }
    }
  });

  test("no authored .vibe names a host global: the compiler's own rule is the authority, not a spelling scan", () => {
    // specification/compatibility.mdx, "Host Globals". The live implementations
    // below DO reach the host — through ./host.ts, which is ordinary TypeScript
    // and keeps its own semantics. None of that leaks back into the `.vibe`.
    //
    // This test used to scan each module's text for seven literal strings
    // ("process.", "globalThis", "Date.now", "performance.", "crypto.",
    // "webcrypto", "Math.random"). That reproduced the compiler's own denylist
    // INSIDE the test, so the two could only ever agree: while the compiler's
    // rule was an eight-name denylist, a module naming `navigator`, `Buffer`,
    // `setTimeout`, `fetch`, `document`, `require`, `new Date()`, or
    // `Intl.DateTimeFormat` passed both. A gate that restates the rule it is
    // gating cannot catch the rule being wrong.
    //
    // So the rule decides: a module names a host global exactly when the
    // host-global rule reports on it.
    expect(hostRuleRefusals(compile())).toEqual([]);
  });

  test("...and that prohibition is live over these modules, not vacuous", () => {
    // An assertion that something does not happen is worth exactly as much as
    // the proof that it could. Each probe is one class of host authority,
    // spliced into a real module and compiled through the real pipeline; every
    // one of them must be refused by the host-global rule. If the rule is
    // deleted, narrowed, or stops running over `platform/**`, this list empties
    // and the test above becomes a tautology — which is what this catches.
    //
    // The probes are deliberately NOT the compiler's own name tables. They are
    // authorities named by the specification ("filesystem, and network", "clock
    // and random access") plus the aliasing and spread routes that reach them,
    // written the way an author would write them.
    const probes: readonly (readonly [string, string])[] = [
      ["a globalThis alias", "self"],
      ["a frame alias", "top"],
      ["host identity", "navigator.userAgent"],
      ["host-persistent state", "localStorage"],
      ["network", "new WebSocket(\"wss://example.invalid\")"],
      ["a legacy network client", "XMLHttpRequest"],
      ["threads", "Worker"],
      ["a Node-only ambient", "process.platform"],
      ["scheduling", "setTimeout"],
      ["structured clone", "structuredClone"],
      ["the wall clock", "new Date()"],
      ["the wall clock through a spread", "new Date(...([] as unknown as [number]))"],
      ["the wall clock through Intl", "new Intl.DateTimeFormat(\"en\").format()"],
      ["the monotonic clock", "performance.now()"],
      ["randomness", "Math.random()"],
    ];
    const host = MODULES[0];
    const original = readFileSync(join(DIR, `${host}.vibe`), "utf8");
    for (const [description, expression] of probes) {
      const spliced = `${original}\n\nexport function __hostAuthorityProbe(): unknown {\n  return ${expression}\n}\n`;
      const refusals = hostRuleRefusals(compile({ [host]: spliced }));
      expect([description, refusals.length > 0]).toEqual([description, true]);
    }
  });

  test("the public API did not change: exported names match the TypeScript originals", () => {
    for (const name of MODULES) {
      const typescript = exportedNames(readFileSync(join(DIR, `${name}.ts`), "utf8"));
      const vibelang = exportedNames(readFileSync(join(DIR, `${name}.vibe`), "utf8"));
      expect([name, vibelang]).toEqual([name, typescript]);
    }
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
    expect(declarations.diagnostics.filter((diagnostic) => diagnostic.category === "error")).toEqual([]);
    expect(declarations.ok).toBe(true);
    expect(declarations.outputs.length).toBe(MODULES.length);
    for (const output of declarations.outputs) {
      // A consumer that saw a Panic channel would be entitled to `recover` from it.
      expect([output.fileName, output.code.includes("Panic")]).toEqual([output.fileName, false]);
      for (const row of Object.values(readDeclarationEffects(output.code))) {
        expect(row.failures).toEqual([]);
      }
    }
  });

  test("the original TypeScript suites pass unmodified against the executed .vibe build", () => {
    const checked = compile();
    expect(checked.ok).toBe(true);

    const root = mkdtempSync(join(tmpdir(), "vibelang-platform-sm-"));
    try {
      // The emitted modules live in `outDir`, which is one level below the
      // authored sources, so the compiler rewrote the authored `./host.ts` to
      // `../host.ts`. The replay tree reproduces that layout rather than
      // flattening it: emitted modules and suites in `out/`, the trusted binding
      // at the position the emitted specifier actually names.
      const out = join(root, "out");
      mkdirSync(out, { recursive: true });
      for (const file of Object.values(checked.result.files)) {
        writeFileSync(join(out, basename(file.outputFileName)), file.code);
      }
      // The trusted TypeScript binding is the other half of every module below,
      // so the replay uses the real one rather than a substitute: the real
      // `process.env`, the real host CSPRNG, and the real standard streams.
      copyBinding("host.ts", root);
      // The suites are copied byte for byte except for their import specifiers:
      // sibling `./x.ts` now names the emitted `.vibe` output, and everything
      // outside this directory is pinned to the one real runtime instance so the
      // Context/Layer and Panic brands are the same objects the emitted code uses.
      for (const name of MODULES) {
        const suite = readFileSync(join(DIR, `${name}.test.ts`), "utf8")
          .replace(/from "\.\.\/([a-z-]+)\/([a-z-]+)\.ts"/g, `from "${resolve(DIR, "..")}/$1/$2.ts"`);
        writeFileSync(join(out, `${name}.replay.test.ts`), suite);
      }

      const run = spawnSync(process.execPath, ["test", out], { cwd: out, encoding: "utf8" });
      const output = `${run.stdout ?? ""}${run.stderr ?? ""}`;
      const summary = /(\d+) pass[\s\S]*?(\d+) fail/.exec(output);
      // 14 = environment 5 + random 5 + console 4. It was 24 while `duration`
      // was in the gate. The TypeScript Duration suite still runs directly,
      // but the refused `.vibe` port has no executable output to replay. The
      // blocked tests below preserve its contract gaps without waiving them.
      expect(summary === null ? output : `${summary[1]} pass / ${summary[2]} fail`).toBe("14 pass / 0 fail");
      expect(run.status).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("BLOCKED: duration.vibe reports both contract gaps, independent of property spelling", () => {
    // This replaces a pin that has been retired because what it pinned is
    // fixed. The retired test was "RESIDUAL WALL: duration.vibe is accepted only
    // by the JS reference, and only via the shorthand property", and it
    // asserted `Object.freeze({ codec })` was ACCEPTED here while
    // `Object.freeze({ codec: codec })` was refused. Those are the same
    // program. The reference was losing foreign provenance through the ES2015
    // shorthand — a fail-open, with the Go fork the correct backend — and the
    // pin existed to make closing it show up as a deliberate change. It has.
    //
    // What is asserted now, and what is deliberately NOT.
    //
    // ASSERTED: the two spellings are one program and get one verdict, at
    // byte-identical positions. A test that named only one
    // spelling could be satisfied by loosening both halves; asserting the two
    // are EQUAL cannot be.
    //
    // ASSERTED: the refusal discriminates by *provenance*, not by spelling and
    // not by `Object.freeze`. Drop the `codec` member and the identical frozen
    // namespace — whose other members `parse` and `isDuration` are themselves
    // shorthand properties — loses only its foreign-provenance diagnostic.
    // The separate callback-completion diagnostic remains at the adapter.
    // "Refuse shorthand properties" and "refuse Object.freeze" are therefore
    // both excluded as explanations.
    //
    // NOT ASSERTED: that refusing this program is the right end state. Whether
    // a universal, provably non-invoking global like `Object.freeze` launders
    // provenance at all is an open decision (SEAM §1.3, S5's F2). The fix above did not
    // create that decision and did not settle it; it made both backends and
    // both spellings agree about it, so it can now be settled once. Settling it
    // EITHER WAY should turn this test red on purpose. The stronger callable
    // completion relation also exposes a real second gap: wire-adapter.ts's
    // foreign runtime Result type is not the checker-owned Result channel.
    // Do not suppress that diagnostic or call this port "one refusal away".
    const authored = readFileSync(join(DIR, "duration.vibe"), "utf8");
    expect(authored).toContain("\n  codec,\n});");

    const check = (source: string) =>
      compileAndCheckProject([{ fileName: join(DIR, "duration.vibe"), source }], {
        rootDir: DIR,
        outDir: join(DIR, "__sm_out__"),
        runtimeImport: RUNTIME_IMPORT,
      }).result.diagnostics
        .filter((diagnostic) => diagnostic.severity === "error")
        .map((diagnostic) => `${diagnostic.code}@${diagnostic.line}:${diagnostic.column}`);

    const shorthand = check(authored);
    const longhand = check(authored.replace("\n  codec,\n});", "\n  codec: codec,\n});"));
    // These are authored positions: the Result callback and the frozen
    // namespace respectively. Neither depends on shorthand vs longhand.
    expect(shorthand).toEqual(["VIBE1303@273:3", "VIBE1508@286:39"]);
    expect(longhand).toEqual(shorthand);
    // Removing the foreign member must remove ONLY that provenance error.
    expect(check(authored.replace("\n  codec,\n});", "\n});"))).toEqual(["VIBE1303@273:3"]);
    expect(authored).toContain("\n  parse,\n");
  });

  test("BLOCKED: the refused duration.vibe port publishes no executable artifact", () => {
    // The removed JS emitter returned code even on refusal. Native delivery
    // must not publish rejected programs. Keep the contract diagnostics and
    // assert output absence, including maps, instead of executing refused code.
    // The 13 direct tests in duration.test.ts still cover duration.ts; they are
    // not evidence that this `.vibe` port is accepted or executable.
    const sources = BLOCKED.map((name) => ({
      fileName: join(DIR, `${name}.vibe`),
      source: readFileSync(join(DIR, `${name}.vibe`), "utf8"),
    }));
    const checked = compileAndCheckProject(sources, {
      rootDir: DIR,
      outDir: join(DIR, "__sm_out__"),
      runtimeImport: RUNTIME_IMPORT,
    });
    expect(checked.ok).toBe(false);
    expect(checked.emitDiagnostics).toEqual([]);
    expect(checked.result.diagnostics.filter((diagnostic) => diagnostic.severity === "error")
      .map((diagnostic) => `${diagnostic.code}@${diagnostic.line}:${diagnostic.column}`))
      .toEqual(["VIBE1303@273:3", "VIBE1508@286:39"]);
    const files = Object.values(checked.result.files);
    expect(files).toHaveLength(BLOCKED.length);
    for (const file of files) {
      expect(file.code).toBe("");
      expect(file.sourceMap).toBeUndefined();
    }
  });

  test("the host-write seam is differentially identical to the TypeScript original", () => {
    // `console.test.ts` constructs `SystemConsole.make()` and then only checks
    // that it is a Console — the default-stream path, which is exactly the seam
    // this port moved, is never written through. Replaying that suite therefore
    // cannot see a regression in it, so this drives the real streams in a
    // subprocess and compares the two builds byte for byte.
    const checked = compile();
    expect(checked.ok).toBe(true);

    const root = mkdtempSync(join(tmpdir(), "vibelang-console-seam-"));
    try {
      const out = join(root, "out");
      mkdirSync(out, { recursive: true });
      for (const file of Object.values(checked.result.files)) {
        writeFileSync(join(out, basename(file.outputFileName)), file.code);
      }
      copyBinding("host.ts", root);

      // One driver, two module specifiers: the emitted `.vibe` build and the
      // TypeScript original. Both write through `SystemConsole.make()` with no
      // options, so both take the default host streams.
      const driver = (specifier: string) => `
        import { SystemConsole } from ${JSON.stringify(specifier)};
        const console = SystemConsole.make();
        console.info("info line");
        console.warn("warn line");
        console.error("error line");
        // The empty-options path takes the same defaults, and the stream's own
        // backpressure signal must still reach the caller.
        const second = SystemConsole.make({});
        process.stdout.write(String(second.info("second line")) + "\\n");
      `;
      const smDriver = join(out, "seam-sm.mjs");
      const tsDriver = join(out, "seam-ts.mjs");
      writeFileSync(smDriver, driver(join(out, "console.ts")));
      writeFileSync(tsDriver, driver(join(DIR, "console.ts")));

      const capture = (script: string) => {
        const run = spawnSync(process.execPath, [script], { cwd: out, encoding: "utf8" });
        return { status: run.status, stdout: run.stdout ?? "", stderr: run.stderr ?? "" };
      };
      const vibelang = capture(smDriver);
      const typescript = capture(tsDriver);

      expect(typescript).toEqual({
        status: 0,
        stdout: "info line\nsecond line\nundefined\n",
        stderr: "warn line\nerror line\n",
      });
      expect(vibelang).toEqual(typescript);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
