import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

/**
 * Project mode (`-p` / `--project` without explicit entries) and the package
 * seams `vibe run` / `vibe test` stage for a program that lives outside an
 * installed consumer.
 *
 * Discovery itself is the native compiler's `discoverProject` operation; this
 * file pins the command-line behaviour built on it.
 *
 * Measured 2026-09-10 before the fix: `vibe check -p tsconfig.json` on a
 * project containing a `.vibe` file with a dropped Result exited 0 and printed
 * nothing, a configuration that weakened a mandatory option passed the same
 * way, a project of nothing but `.vibe` files was refused with TS18003, and
 * `vibe run` on a program that derived a schema died with ERR_MODULE_NOT_FOUND
 * unless a `node_modules/vibelang` happened to sit above the source.
 */

const cli = resolve("bin/vibe.js");

function invoke(cwd, args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });
}

function scaffold(prefix) {
  const project = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  const init = invoke(project, ["init", "--format", "json"]);
  assert.equal(init.status, 0, init.stderr || init.stdout);
  return project;
}

const DROPPED_RESULT = [
  "class NotFound extends Error {}",
  "",
  "function getUser(id: string): Result<string, NotFound> {",
  '  if (id !== "1") throw new NotFound(id)',
  '  return "Ada"',
  "}",
  "",
  "export function main(): number {",
  '  getUser("1")',
  "  return 1",
  "}",
  "",
].join("\n");

test("check -p expands the configuration's .vibe inputs and refuses the broken one", () => {
  const project = scaffold("vibelang-project-mode-");
  try {
    writeFileSync(join(project, "broken.vibe"), DROPPED_RESULT);
    const checked = invoke(project, ["check", "-p", "tsconfig.json", "--format", "json"]);
    assert.equal(checked.status, 1, checked.stderr || checked.stdout);
    const report = JSON.parse(checked.stdout);
    assert.equal(report.ok, false);
    const inputs = report.files.map((file) => file.input).sort();
    assert.deepEqual(inputs, [join(project, "broken.vibe"), join(project, "main.vibe")]);
    const broken = report.files.find((file) => file.input.endsWith("broken.vibe"));
    assert.deepEqual(broken.diagnostics.map((diagnostic) => diagnostic.code), ["VIBE1301"]);
    const main = report.files.find((file) => file.input.endsWith("main.vibe"));
    assert.deepEqual(main.diagnostics, []);

    // The same project with the defect removed is accepted, still through the
    // checked frontend: the report carries the rows only that frontend computes.
    rmSync(join(project, "broken.vibe"));
    const clean = invoke(project, ["check", "-p", "tsconfig.json", "--format", "json"]);
    assert.equal(clean.status, 0, clean.stderr || clean.stdout);
    const cleanReport = JSON.parse(clean.stdout);
    assert.equal(cleanReport.ok, true);
    assert.deepEqual(cleanReport.files.map((file) => file.input), [join(project, "main.vibe")]);
    assert.deepEqual(cleanReport.files[0].rows.greeting.failures, ["NotFound"]);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("check -p refuses a configuration that weakens a mandatory option before opening any source", () => {
  const project = scaffold("vibelang-project-mode-weak-");
  try {
    const tsconfig = readFileSync(join(project, "tsconfig.json"), "utf8");
    assert.match(tsconfig, /"noUncheckedIndexedAccess": true/);
    writeFileSync(join(project, "weak.json"), tsconfig.replace('"noUncheckedIndexedAccess": true', '"noUncheckedIndexedAccess": false'));
    const checked = invoke(project, ["check", "-p", "weak.json", "--format", "json"]);
    assert.equal(checked.status, 1, checked.stderr || checked.stdout);
    const report = JSON.parse(checked.stdout);
    assert.equal(report.ok, false);
    assert.deepEqual(report.files.map((file) => file.input), [join(project, "weak.json")]);
    assert.deepEqual(report.files[0].diagnostics.map((diagnostic) => diagnostic.code), ["VIBE6001"]);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("check -p accepts a project made of nothing but .vibe files", () => {
  const project = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-project-mode-only-")));
  try {
    writeFileSync(join(project, "tsconfig.json"), JSON.stringify({
      compilerOptions: {
        target: "esnext", module: "esnext", moduleResolution: "bundler", strict: true,
        noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true, isolatedModules: true,
        verbatimModuleSyntax: true, useDefineForClassFields: true, allowImportingTsExtensions: true,
        noEmit: true, skipLibCheck: true,
      },
      // A comment and a trailing comma are legal in tsconfig.json.
      include: ["src/**/*.vibe"],
    }, null, 2).replace('"include"', '// entries\n  "include"').replace("]\n}", "],\n}"));
    mkdirSync(join(project, "src", "nested"), { recursive: true });
    writeFileSync(join(project, "src", "only.vibe"), "export function only(): number {\n  return 1\n}\n");
    writeFileSync(join(project, "src", "nested", "deep.vibe"), "export function deep(): number {\n  return 2\n}\n");
    // Outside the include set: never opened, never reported.
    writeFileSync(join(project, "stray.vibe"), DROPPED_RESULT);
    const checked = invoke(project, ["check", "-p", "tsconfig.json", "--format", "json"]);
    assert.equal(checked.status, 0, checked.stderr || checked.stdout);
    const report = JSON.parse(checked.stdout);
    assert.equal(report.ok, true);
    assert.deepEqual(report.files.map((file) => file.input).sort(), [
      join(project, "src", "nested", "deep.vibe"),
      join(project, "src", "only.vibe"),
    ]);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("compile -p emits every configured .vibe file, honouring the configuration's outDir and noEmit", () => {
  const project = scaffold("vibelang-project-mode-compile-");
  try {
    // The scaffold's tsconfig says noEmit, and project mode keeps tsc's meaning of it.
    const suppressed = invoke(project, ["compile", "-p", "tsconfig.json", "--outDir", "out", "--format", "json"]);
    assert.equal(suppressed.status, 0, suppressed.stderr || suppressed.stdout);
    assert.equal(JSON.parse(suppressed.stdout).ok, true);
    assert.ok(!existsSync(join(project, "out")), "a noEmit configuration emits nothing");

    const tsconfig = JSON.parse(readFileSync(join(project, "tsconfig.json"), "utf8"));
    delete tsconfig.compilerOptions.noEmit;
    writeFileSync(join(project, "tsconfig.json"), JSON.stringify(tsconfig, null, 2));
    const explicit = invoke(project, ["compile", "-p", "tsconfig.json", "--outDir", "out", "--format", "json"]);
    assert.equal(explicit.status, 0, explicit.stderr || explicit.stdout);
    assert.equal(JSON.parse(explicit.stdout).ok, true);
    assert.ok(existsSync(join(project, "out", "main.mjs")), "main.mjs is emitted into --outDir");

    tsconfig.compilerOptions.outDir = "build";
    writeFileSync(join(project, "tsconfig.json"), JSON.stringify(tsconfig, null, 2));
    const configured = invoke(project, ["compile", "-p", "tsconfig.json", "--format", "json"]);
    assert.equal(configured.status, 0, configured.stderr || configured.stdout);
    assert.ok(existsSync(join(project, "build", "main.mjs")), "main.mjs is emitted into compilerOptions.outDir");
    assert.ok(!existsSync(join(project, "main.mjs")), "nothing is emitted beside the source when outDir is configured");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("check -p still forwards a project without .vibe files to the TypeScript compiler", () => {
  const project = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-project-mode-ts-")));
  try {
    writeFileSync(join(project, "tsconfig.json"), JSON.stringify({
      compilerOptions: { target: "esnext", module: "esnext", moduleResolution: "bundler", strict: true, noEmit: true, skipLibCheck: true },
      include: ["**/*.ts"],
    }));
    writeFileSync(join(project, "good.ts"), "export const answer: number = 42\n");
    const good = invoke(project, ["check", "-p", "tsconfig.json"]);
    assert.equal(good.status, 0, good.stderr || good.stdout);

    writeFileSync(join(project, "bad.ts"), 'export const wrong: number = "oops"\n');
    const bad = invoke(project, ["check", "-p", "tsconfig.json"]);
    assert.notEqual(bad.status, 0, "a TypeScript type error must still fail project mode");
    assert.match(bad.stdout + bad.stderr, /TS2322/);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

const TRUSTED_STDOUT = [
  "/**",
  " * @module",
  " * @throws {never}",
  " */",
  "/** @throws {never} */",
  "export function writeLine(text: string): void {",
  "  console.log(text)",
  "}",
  "",
].join("\n");

const SCHEMA_PROGRAM = [
  'import { comptime } from "vibelang:comptime"',
  'import { Schema } from "vibelang:schema"',
  'import { writeLine } from "./stdout.ts"',
  "",
  "type Row = { name: string; count: number }",
  "",
  "export const RowSchema = comptime(Schema.derive<Row>())",
  "",
  'const good = RowSchema.parse({ name: "row", count: 2 })',
  'const bad = RowSchema.parse({ name: "row", count: "two" })',
  "",
  "writeLine(`${good.isOk()} ${bad.isOk()}`)",
  "",
].join("\n");

test("vibe run resolves the derived-schema runtime without an installed package above the source", () => {
  const project = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-run-schema-")));
  try {
    writeFileSync(join(project, "stdout.ts"), TRUSTED_STDOUT);
    writeFileSync(join(project, "main.vibe"), SCHEMA_PROGRAM);
    assert.ok(!existsSync(join(project, "node_modules")), "the scratch project has no node_modules");
    const ran = invoke(project, ["run", "main.vibe", "--format", "json"]);
    assert.equal(ran.status, 0, ran.stderr || ran.stdout);
    const report = JSON.parse(ran.stdout);
    assert.equal(report.ok, true, report.errorOutput);
    assert.equal(report.output, "true false\n");
    assert.ok(!existsSync(join(project, "node_modules")), "run leaves no node_modules behind in the project");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("vibe test resolves the derived-schema runtime without an installed package above the source", () => {
  const project = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-test-schema-")));
  try {
    writeFileSync(join(project, "schema.vibe"), [
      'import { comptime } from "vibelang:comptime"',
      'import { Schema } from "vibelang:schema"',
      "",
      "type Row = { name: string; count: number }",
      "class Rejected extends Error {}",
      "",
      "const RowSchema = comptime(Schema.derive<Row>())",
      "",
      "export function testSchemaAcceptsARow(): Result<number, Rejected> {",
      '  if (!RowSchema.parse({ name: "row", count: 2 }).isOk()) throw new Rejected("row")',
      "  return 1",
      "}",
      "",
    ].join("\n"));
    const tested = invoke(project, ["test", "schema.vibe", "--format", "json"]);
    assert.equal(tested.status, 0, tested.stderr || tested.stdout);
    assert.equal(JSON.parse(tested.stdout).summary, "1 passed, 0 failed");
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
