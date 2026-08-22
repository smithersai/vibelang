import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

function run(file, args) {
  return spawnSync(process.execPath, [file, ...args], { cwd: process.cwd(), encoding: "utf8" });
}

/**
 * Give the compiled project a `node_modules/vibelang` so the emitted
 * `vibelang/schema-runtime` edge resolves exactly the way it does for an
 * installed consumer. The CLI deliberately does not redirect that specifier at
 * a local path: a resolvable file would make the frontend read `__vsSchema` as
 * an untrusted foreign module.
 */
function linkInstalledPackage(root) {
  mkdirSync(join(root, "node_modules"), { recursive: true });
  symlinkSync(resolve("."), join(root, "node_modules", "vibelang"), process.platform === "win32" ? "junction" : "dir");
}

test("comptime Schema.derive lowers to a resolvable vibelang/schema-runtime edge", async () => {
  const project = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-cli-schema-")));
  const output = join(project, "output");
  try {
    writeFileSync(join(project, "main.vibe"), [
      'import { comptime } from "vibelang:comptime"',
      'import { Schema } from "vibelang:schema"',
      "",
      "export interface Row { name: string; count: number }",
      "",
      "export const RowSchema = comptime(Schema.derive<Row>())",
      "",
    ].join("\n"));

    const compiled = run("bin/vibe.js", [
      "compile",
      join(project, "main.vibe"),
      "--rootDir",
      project,
      "--outDir",
      output,
      "--declaration",
      "--sourceMap",
      "--format",
      "json",
    ]);
    assert.equal(compiled.status, 0, compiled.stderr || compiled.stdout);
    const report = JSON.parse(compiled.stdout);
    assert.equal(report.ok, true);

    // Both new lowering edit kinds are part of the report the CLI passes
    // through, so a consumer auditing provenance sees them by name.
    const main = report.files.find((file) => file.input === join(project, "main.vibe"));
    assert.deepEqual(main.comptime.provenance.edits.map((edit) => edit.kind), [
      "schema-runtime-import",
      "remove-import",
      "remove-import",
      "intrinsic-call",
    ]);
    const importEdit = main.comptime.provenance.edits[0];
    assert.deepEqual([importEdit.authored.start, importEdit.authored.end], [0, 0]);
    assert.equal(importEdit.mappedOrigin.file, "main.vibe");

    const javascript = readFileSync(join(output, "main.mjs"), "utf8");
    assert.match(javascript, /^import \{ __vsSchema \} from "vibelang\/schema-runtime";/m);
    assert.doesNotMatch(javascript, /vibelang:schema|Schema\.derive/);
    // The compiler-owned descriptor, not an author-maintained schema literal.
    assert.match(javascript, /kind: "object"/);

    // A declaration must name the package seam, never the checker's machine
    // specific path for the packaged module.
    const declaration = readFileSync(join(output, "main.d.mts"), "utf8");
    assert.match(declaration, /import\("vibelang\/schema-runtime"\)\.DerivedSchema<Row>/);
    assert.doesNotMatch(declaration, /poc\/dist\/build\/schema-runtime/);

    linkInstalledPackage(project);
    const loaded = await import(`${pathToFileURL(join(output, "main.mjs")).href}?identity=${main.comptime.identity}`);
    assert.equal(loaded.RowSchema.descriptor.kind, "object");
    assert.deepEqual(
      loaded.RowSchema.parse({ name: "row", count: 2 }).match({ ok: (row) => row, error: () => null }),
      { count: 2, name: "row" },
    );
    assert.equal(
      loaded.RowSchema.parse({ name: 4, count: 2 })
        .match({ ok: () => null, error: (failure) => failure.pointer }),
      "$.name",
    );
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

test("a type-only comptime binding lowers to a type-alias edit and erases its runtime const", () => {
  const project = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-cli-type-alias-")));
  const output = join(project, "output");
  try {
    writeFileSync(join(project, "main.vibe"), [
      'import { comptime } from "vibelang:comptime"',
      "",
      'const Account = comptime({ id: "string", nested: { flag: true } })',
      "",
      "export function open(account: Account): string { return account.id }",
      "",
    ].join("\n"));

    const compiled = run("bin/vibe.js", [
      "compile",
      join(project, "main.vibe"),
      "--rootDir",
      project,
      "--outDir",
      output,
      "--declaration",
      "--format",
      "json",
    ]);
    assert.equal(compiled.status, 0, compiled.stderr || compiled.stdout);
    const report = JSON.parse(compiled.stdout);
    assert.equal(report.ok, true);

    const main = report.files.find((file) => file.input === join(project, "main.vibe"));
    assert.deepEqual(main.comptime.provenance.edits.map((edit) => edit.kind), [
      "remove-import",
      "type-alias",
    ]);

    const javascript = readFileSync(join(output, "main.mjs"), "utf8");
    assert.doesNotMatch(javascript, /const Account|vibelang:comptime/);
    assert.match(javascript, /function open/);

    const declaration = readFileSync(join(output, "main.d.mts"), "utf8");
    assert.match(declaration, /declare function open\(account: Account\): string/);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
