// SMITHERS6001 / SMITHERS6002 / SMITHERS6003 — the tsconfig compiler-options
// gate, pinned on the route a user actually reaches it through.
//
// WHY THIS FILE EXISTS, AND WHY IT IS NOT A CORPUS CASE.
//
// These three codes validate a `tsconfig.json`. The conformance corpus cannot
// express one, and that is structural rather than an oversight. Three layers,
// each checked rather than assumed:
//
//   1. The expectation schema has no field for it.
//      `conformance/runner/corpus.mjs` KNOWN_FIELDS is
//      {title, expect, stdout, diagnostics, modules, typescript, assets, entry,
//      xfail, notes} and `validate()` THROWS on any other key. A case's staged
//      files are only `smithers` / `typescript` / `asset`. There is no way to
//      write "and here is the project's tsconfig".
//   2. The reference driver never sends one. `conformance/runner/backend-js.mjs`
//      builds the whole payload (rootDir, comptimeTarget, runtimeImport,
//      sources, typeScriptSources, assets, expectsOutput) and there is no config
//      field; `validateSmithersTsconfig` is imported by exactly two files in the
//      repository, `poc/src/language/index.ts` and `src/cli.ts`, and the runner
//      is neither.
//   3. The fork driver never sends one either, and the fork short-circuits when
//      it is absent. `conformance/runner/backend-go.mjs` sends
//      `options: { comptimeTarget }` and no `configFile`, and
//      `compiler/forkbridge/main.go.txt:1422` opens
//      `func validateSmithersConfigFile(config *configFile) []diagnostic {
//      if config == nil { return nil }` — so the entire 600x gate returns nil on
//      every corpus request.
//
// So no `.sm` case can declare these codes, and COVERAGE.md counting them among
// "rules both implementations have and no case probes" is true but misleading:
// no case COULD probe them.
//
// WHAT WAS ALREADY PINNED, AND WHAT WAS NOT. Both backends already hold a
// deletion-sensitive unit test on the VALIDATOR:
// `poc/src/language/compiler-options.test.ts` (bun gate) and
// `compiler/fork_compiler_options_test.go` (go gate). Measured, not assumed:
// each of the three arms was deleted from `poc/src/language/compiler-options.ts`
// in turn and the bun test went red every time (6001: 2 failures, 6002: 2,
// 6003: 1), with the file restored and sha256-compared byte-identical after
// each.
//
// What NOTHING pinned is the two things the corpus exists to provide and cannot
// here:
//
//   * THE DELIVERED ROUTE. A user reaches this rule through
//     `smithers check -p <tsconfig> <file>.sm`, via
//     `readSmithersProjectConfig` (`src/cli.ts:1586`). No test in the repository
//     exercised that path. A validator that is correct and unreachable refuses
//     nothing.
//   * THE DIFFERENTIAL. Nothing checked that the two backends report the SAME
//     codes at the SAME positions for the same tsconfig — which is the one
//     question this whole harness exists to ask, and the corpus is blind to it
//     for these three codes specifically.
//
// This file pins both, through the shipped binary, on both backends.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "bin/smithers.js");

// One tsconfig carrying one instance of each rule, so a single run measures all
// three and their ORDER. `strict: false` is the sharp spelling of the mandatory
// rule: present, and wrong, rather than absent — a validator that only checked
// for presence would pass it.
const TSCONFIG = JSON.stringify(
  {
    compilerOptions: {
      strict: false,
      experimentalDecorators: true,
      notAnOptionAtAll: true,
    },
  },
  undefined,
  2,
);

/**
 * Every diagnostic this tsconfig must draw, in order.
 *
 * 6002 and 6003 run over what the AUTHOR WROTE, in written order, and land on
 * the option NAME. 6001 runs over the mandatory TABLE afterwards, which is why
 * every one of them comes last even though `strict` is written first — and why
 * `strict` lands on the option it can point at (3:5) while the five options that
 * are simply ABSENT land on the `compilerOptions` object (2:22), there being no
 * syntax to point at for something nobody wrote.
 *
 * All six mandatory options are listed rather than just the interesting one:
 * the count is the difference between "the table is enforced" and "the first row
 * of the table is enforced", and only the full list can tell them apart.
 */
const EXPECTED = [
  { code: "SMITHERS6002", line: 4, column: 5, contains: "'experimentalDecorators' is a forbidden compiler option in a Smithers project and MUST be removed rather than set to a value" },
  { code: "SMITHERS6003", line: 5, column: 5, contains: "unsupported compiler option 'notAnOptionAtAll' in a Smithers project" },
  { code: "SMITHERS6001", line: 3, column: 5, contains: "a Smithers project MUST set 'strict: true'" },
  { code: "SMITHERS6001", line: 2, column: 22, contains: "a Smithers project MUST set 'noUncheckedIndexedAccess: true'" },
  { code: "SMITHERS6001", line: 2, column: 22, contains: "a Smithers project MUST set 'exactOptionalPropertyTypes: true'" },
  { code: "SMITHERS6001", line: 2, column: 22, contains: "a Smithers project MUST set 'isolatedModules: true'" },
  { code: "SMITHERS6001", line: 2, column: 22, contains: "a Smithers project MUST set 'verbatimModuleSyntax: true'" },
  { code: "SMITHERS6001", line: 2, column: 22, contains: "a Smithers project MUST set 'useDefineForClassFields: true'" },
];

function runCheck(backend) {
  const workspace = mkdtempSync(path.join(tmpdir(), "smithers-options-route-"));
  try {
    writeFileSync(path.join(workspace, "tsconfig.json"), TSCONFIG + "\n");
    writeFileSync(path.join(workspace, "main.sm"), 'export function main(): string[] {\n  return ["ok"]\n}\n');
    const args = ["check", "-p", path.join(workspace, "tsconfig.json"), path.join(workspace, "main.sm"), "--format", "json"];
    if (backend !== undefined) args.push("--backend", backend);
    let stdout;
    try {
      stdout = execFileSync(process.execPath, [CLI, ...args], { encoding: "utf8", cwd: ROOT });
    } catch (error) {
      // A refusal exits non-zero, which is the whole point; the payload is on
      // stdout either way. Only a missing payload is a real failure.
      stdout = error.stdout ?? "";
      if (stdout.trim() === "") throw error;
    }
    const report = JSON.parse(stdout);
    return (report.files ?? []).flatMap((file) => file.diagnostics ?? []);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

const key = (d) => `${d.code}@${d.line}:${d.column}`;

test("the delivered CLI route reports all three compiler-option rules on the reference", () => {
  const diagnostics = runCheck(undefined).filter((d) => d.code.startsWith("SMITHERS600"));
  assert.deepEqual(diagnostics.map(key), EXPECTED.map(key));
  for (const [index, expected] of EXPECTED.entries()) {
    // The sentence is part of the promise: 6001 must name WHICH option, and 6002
    // must say the option has to be REMOVED rather than set to another value.
    assert.ok(
      diagnostics[index].message.includes(expected.contains),
      `${expected.code} lost its sentence: ${JSON.stringify(diagnostics[index].message)}`,
    );
    assert.equal(diagnostics[index].severity, "error");
  }
});

test("the tsconfig is refused BEFORE the program is compiled", () => {
  // `main.sm` is a valid program. If the config gate ever moved after
  // compilation, a project with a forbidden option would be type-checked under
  // the wrong options first — which is the fail-open the ordering prevents, and
  // it is invisible to any assertion about the diagnostics alone.
  const diagnostics = runCheck(undefined);
  assert.ok(diagnostics.length > 0);
  assert.ok(
    diagnostics.every((d) => d.code.startsWith("SMITHERS600")),
    `the run reported something other than the config gate: ${JSON.stringify(diagnostics.map((d) => d.code))}`,
  );
});

test("both backends answer the same tsconfig identically", () => {
  const reference = runCheck("js").filter((d) => d.code.startsWith("SMITHERS600"));
  let fork;
  try {
    fork = runCheck("go").filter((d) => d.code.startsWith("SMITHERS600"));
  } catch (error) {
    // The fork checkout is an external prerequisite. Not measuring it is
    // reported, never silently passed over, and never a skip — the reference
    // half above still gated.
    assert.fail(
      "the Go backend could not be driven, so this run is NOT a measurement of the fork. " +
        "Set SMITHERS_TYPESCRIPT_FORK to the pinned checkout (see scripts/prepare-typescript-fork.mjs). " +
        `Underlying error: ${error.message}`,
    );
  }

  // Measured, not hoped for: the two backends agree on this tsconfig down to the
  // message text and the ORDER, so the comparison is the strongest one available
  // rather than a set comparison that would tolerate a backend emitting the six
  // mandatory rows in a different sequence or with a different sentence. If a
  // legitimate difference in wording ever appears, weaken this to code@position
  // and say why here — do not delete it.
  assert.deepEqual(
    fork.map((d) => `${key(d)} ${d.message}`),
    reference.map((d) => `${key(d)} ${d.message}`),
  );
  assert.deepEqual(reference.map(key), EXPECTED.map(key));
});
