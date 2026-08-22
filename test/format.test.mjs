import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

function run(args) {
  return spawnSync(process.execPath, ["bin/vibe.js", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

function json(result) {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new TypeError(`expected JSON on stdout, got ${JSON.stringify(result.stdout)}: ${error.message}`);
  }
}

function withWorkspace(body) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-format-")));
  try {
    return body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const UNFORMATTED = [
  "class   Missing extends Error{",
  "constructor(readonly key:string){super(`no entry for ${key}`)}",
  "}",
  "function lookup(key:string):string|null{return key===\"\"?null:key}",
  "export function require_(key:string):Result<string,Missing>{",
  "if(const found=lookup(key);found!==null){",
  "return found",
  "}",
  "throw new Missing(key)",
  "}",
  "export function classify(input:string):string{",
  "const kind=verdict:{",
  "if(input.length===0)break :verdict \"empty\"",
  "break:verdict   \"short\"",
  "}",
  "return kind",
  "}",
  "export function describe(kind:string):string{",
  "return switch(kind){",
  "case \"empty\":\"nothing\"",
  "case \"short\":\"brief\"",
  "default:\"other\"",
  "}",
  "}",
  "",
].join("\n");

const FORMATTED = [
  "class Missing extends Error {",
  "  constructor(readonly key: string) { super(`no entry for ${key}`) }",
  "}",
  "function lookup(key: string): string | null { return key === \"\" ? null : key }",
  "export function require_(key: string): Result<string, Missing> {",
  "  if (const found = lookup(key); found !== null) {",
  "    return found",
  "  }",
  "  throw new Missing(key)",
  "}",
  "export function classify(input: string): string {",
  "  const kind = verdict: {",
  "    if (input.length === 0) break :verdict \"empty\"",
  "    break :verdict \"short\"",
  "  }",
  "  return kind",
  "}",
  "export function describe(kind: string): string {",
  "  return switch (kind) {",
  "    case \"empty\": \"nothing\"",
  "    case \"short\": \"brief\"",
  "    default: \"other\"",
  "  }",
  "}",
  "",
].join("\n");

test("vibe format --check reports unformatted files and exits nonzero", () => {
  withWorkspace((root) => {
    const file = join(root, "app.vibe");
    writeFileSync(file, UNFORMATTED);
    const result = run(["format", file, "--check", "--format", "json"]);
    assert.equal(result.status, 1, result.stderr);
    const report = json(result);
    assert.equal(report.ok, false);
    assert.equal(report.mode, "check");
    assert.deepEqual(report.unformatted, [file]);
    assert.equal(readFileSync(file, "utf8"), UNFORMATTED, "--check must not write");
  });
});

test("vibe format rewrites in place, is idempotent, and restores VibeLang spellings", () => {
  withWorkspace((root) => {
    const file = join(root, "app.vibe");
    writeFileSync(file, UNFORMATTED);

    const first = run(["format", file, "--format", "json"]);
    assert.equal(first.status, 0, first.stderr);
    const firstReport = json(first);
    assert.equal(firstReport.ok, true);
    assert.deepEqual(firstReport.formatted, [file]);
    assert.equal(readFileSync(file, "utf8"), FORMATTED);

    const second = run(["format", file, "--format", "json"]);
    assert.equal(second.status, 0, second.stderr);
    const secondReport = json(second);
    assert.deepEqual(secondReport.formatted, []);
    assert.equal(secondReport.unchanged, 1);
    assert.equal(readFileSync(file, "utf8"), FORMATTED, "format(format(x)) must equal format(x)");

    const check = run(["format", file, "--check", "--format", "json"]);
    assert.equal(check.status, 0, check.stderr);
    assert.deepEqual(json(check).unformatted, []);
  });
});

test("vibe format --stdout prints raw source and leaves the file alone", () => {
  withWorkspace((root) => {
    const file = join(root, "app.vibe");
    writeFileSync(file, UNFORMATTED);
    const result = run(["format", file, "--stdout"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, FORMATTED, "raw --stdout output must be exactly the formatted source");
    assert.equal(readFileSync(file, "utf8"), UNFORMATTED);
  });
});

test("vibe format --stdout --format json keeps the machine-readable stream uncontaminated", () => {
  withWorkspace((root) => {
    const file = join(root, "app.vibe");
    writeFileSync(file, UNFORMATTED);
    const result = run(["format", file, "--stdout", "--format", "json"]);
    assert.equal(result.status, 0, result.stderr);
    const report = json(result);
    assert.equal(report.mode, "stdout");
    assert.equal(report.files[0].formatted, FORMATTED);
    assert.equal(readFileSync(file, "utf8"), UNFORMATTED);
  });
});

/**
 * The CLI's asset and portability pre-passes parse authored `.vibe` with stock
 * TypeScript, so the end-to-end acceptance comparison uses the subset those
 * passes accept. The recovered expression constructs above are covered by the
 * frontend suite (`poc/src/language/format.test.ts`), which compiles the
 * authored and formatted sources and compares rows and emitted JavaScript.
 */
const COMPILABLE_UNFORMATTED = [
  "class Missing extends Error{",
  "constructor(readonly key:string){super(`no entry for ${key}`)}",
  "}",
  "function lookup(key:string):string|null{return key===\"\"?null:key}",
  "export function require_(key:string):Result<string,Missing>{",
  "const found=lookup(key)",
  "     if(found===null)throw new Missing(key)",
  "return found",
  "}",
  "export function initials(key:string):Result<string,Missing>{",
  "const name=require_(key).unwrap()",
  "return name.slice(0,1)",
  "}",
  "",
].join("\n");

test("vibe format preserves checked rows and acceptance for the formatted module", () => {
  withWorkspace((root) => {
    const file = join(root, "app.vibe");
    writeFileSync(file, COMPILABLE_UNFORMATTED);

    const before = run(["inspect", file, "--format", "json"]);
    assert.equal(before.status, 0, before.stderr || before.stdout);
    const beforeRows = json(before).files[0].language.rows;

    const compiledBefore = join(root, "before");
    const compileBefore = run(["compile", file, "--outDir", compiledBefore, "--format", "json"]);
    assert.equal(compileBefore.status, 0, compileBefore.stderr || compileBefore.stdout);
    const emittedBefore = readFileSync(join(compiledBefore, "app.mjs"), "utf8");

    assert.equal(run(["format", file, "--format", "json"]).status, 0);

    const after = run(["inspect", file, "--format", "json"]);
    assert.equal(after.status, 0, after.stderr || after.stdout);
    assert.deepEqual(json(after).files[0].language.rows, beforeRows);

    const compiledAfter = join(root, "after");
    const compileAfter = run(["compile", file, "--outDir", compiledAfter, "--format", "json"]);
    assert.equal(compileAfter.status, 0, compileAfter.stderr || compileAfter.stdout);
    const emittedAfter = readFileSync(join(compiledAfter, "app.mjs"), "utf8");

    // Formatting moves authored text, so the emitted module's own layout may
    // move with it; nothing else about the emitted program may change.
    const identifiers = (code) => code.match(/[A-Za-z_$][A-Za-z0-9_$]*/g);
    assert.deepEqual(identifiers(emittedAfter), identifiers(emittedBefore));
  });
});

test("vibe format never rewrites a module it cannot format soundly", () => {
  withWorkspace((root) => {
    const file = join(root, "broken.vibe");
    const source = "export function broken(): number {\n  return (1 +\n}\n";
    writeFileSync(file, source);
    const result = run(["format", file, "--format", "json"]);
    assert.equal(result.status, 1, result.stderr);
    const report = json(result);
    assert.equal(report.ok, false);
    assert.equal(report.files[0].ok, false);
    assert.equal(report.files[0].diagnostics[0].code, "VIBE1901");
    assert.ok(report.files[0].diagnostics[0].line > 0);
    assert.equal(readFileSync(file, "utf8"), source, "an unformattable module must stay byte-identical");
  });
});

test("vibe format rejects unsupported inputs and contradictory flags", () => {
  withWorkspace((root) => {
    const jsx = join(root, "component.tsx");
    writeFileSync(jsx, "export const a = 1\n");
    const unsupported = run(["format", jsx, "--format", "json"]);
    assert.equal(unsupported.status, 2, unsupported.stderr);
    assert.match(unsupported.stdout + unsupported.stderr, /VIBE_FORMAT_ERROR/);

    const contradictory = run(["format", jsx, "--check", "--stdout", "--format", "json"]);
    assert.equal(contradictory.status, 2, contradictory.stderr);

    const empty = run(["format", "--format", "json"]);
    assert.equal(empty.status, 2, empty.stderr);
  });
});

test("vibe format also formats ordinary TypeScript sources", () => {
  withWorkspace((root) => {
    const file = join(root, "helper.ts");
    writeFileSync(file, "export function add(a:number,b:number):number{return a+b}\n");
    const result = run(["format", file, "--format", "json"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      readFileSync(file, "utf8"),
      "export function add(a: number, b: number): number { return a + b }\n",
    );
  });
});

test("vibe doctor reports the formatter and language server as implemented", () => {
  const result = run(["doctor", "--format", "json"]);
  assert.equal(result.status, 0, result.stderr);
  const report = json(result);
  assert.doesNotMatch(report.surfaces.formatter, /not implemented/);
  assert.doesNotMatch(report.surfaces.languageServer, /not implemented/);
});
