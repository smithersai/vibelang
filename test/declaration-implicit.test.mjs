import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

test("CLI publication preserves implicit calls without the library source", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-cli-published-implicit-")));
  const cli = args => spawnSync(process.execPath, ["bin/vibe.js", ...args, "--format", "json"], {
    cwd: process.cwd(), encoding: "utf8",
  });
  try {
    mkdirSync(join(root, "node_modules"));
    symlinkSync(process.cwd(), join(root, "node_modules/vibelang"), process.platform === "win32" ? "junction" : "dir");
    const library = join(root, "library.vibe");
    const librarySource = `import { Context } from "vibelang/context";
export abstract class C extends Context { abstract value(): number }
const seen: number[] = [];
export function snapshot() { return seen.reduce((a, b) => a + b, 0) }
export const resource = { get value(): number { return C.context().value() } };
export class Values { [Symbol.iterator](): Iterator<number> { return [C.context().value()][Symbol.iterator]() } }
export class Resource { [Symbol.dispose](): void { seen.push(C.context().value()) } }
`;
    writeFileSync(library, librarySource);
    const published = cli(["compile", library, "--rootDir", root, "--outDir", join(root, "published"), "--declaration"]);
    assert.equal(published.status, 0, published.stderr || published.stdout);
    const declaration = readFileSync(join(root, "published/library.d.mts"), "utf8");
    assert.match(declaration, /get value\(\): number/);
    assert.match(declaration, /@vibelangAccessor \{"version":1,"enumerable":true\}/);
    assert.match(declaration, /"requirements":\["C"\]/);
    rmSync(library);
    assert.equal(existsSync(library), false);

    const consumer = `import * as lib from "./published/library.mjs";
import { Layer } from "vibelang/provider";
function observe(): number {
  let total = { ...lib.resource }.value;
  for (const value of new lib.Values()) total += value;
  { using resource = new lib.Resource() }
  return total + lib.snapshot();
}
`;
    writeFileSync(join(root, "bad.vibe"), consumer + "export const answer = observe();");
    const output = join(root, "out");
    const initialization = cli(["compile", join(root, "bad.vibe"), "--rootDir", root, "--outDir", output]);
    assert.equal(initialization.status, 1, initialization.stderr || initialization.stdout);
    assert.ok(JSON.parse(initialization.stdout).files.some(file => file.diagnostics.some(issue => issue.code === "VIBE1510")), initialization.stdout);
    // A callable contract is not an initialization-safety claim. Preserve the
    // loader's existing foreign-module boundary and supply its documented
    // assertion for this module's inert declarations and local initializers.
    writeFileSync(library, "/** @module @throws {never} */\n" + librarySource);
    const republished = cli(["compile", library, "--rootDir", root, "--outDir", join(root, "published"), "--declaration"]);
    assert.equal(republished.status, 0, republished.stderr || republished.stdout);
    rmSync(library);
    assert.equal(existsSync(library), false);
    const refused = cli(["compile", join(root, "bad.vibe"), "--rootDir", root, "--outDir", output]);
    assert.equal(refused.status, 1, refused.stderr || refused.stdout);
    assert.ok(JSON.parse(refused.stdout).files.some(file => file.diagnostics.some(issue => issue.code === "VIBE2102")), refused.stdout);
    assert.equal(existsSync(join(output, "bad.mjs")), false);

    writeFileSync(join(root, "erased.vibe"),
      'import * as lib from "./published/library.mjs"; const slot: { value: number } = lib.resource; export const answer = slot.value;');
    const erased = cli(["compile", join(root, "erased.vibe"), "--rootDir", root, "--outDir", output]);
    assert.equal(erased.status, 1, erased.stderr || erased.stdout);
    assert.ok(JSON.parse(erased.stdout).files.some(file => file.diagnostics.some(issue => issue.code === "VIBE1808")), erased.stdout);
    assert.equal(existsSync(join(output, "erased.mjs")), false);

    writeFileSync(join(root, "main.vibe"), consumer +
      "export function main(): number { return Layer.provide(Layer.succeed(lib.C, { value: () => 7 }), () => observe()) }");
    const accepted = cli(["compile", join(root, "main.vibe"), "--rootDir", root, "--outDir", output, "--declaration"]);
    assert.equal(accepted.status, 0, accepted.stderr || accepted.stdout);
    const copied = readFileSync(join(output, "__vibelang_foreign__/published/library.d.mts"), "utf8");
    assert.match(copied, /"requirements":\["C"\]/);
    assert.match(copied, /@vibelangAccessor \{"version":1,"enumerable":true\}/);
    assert.doesNotMatch(copied, new RegExp(root));
    rmSync(join(root, "published"), { recursive: true, force: true });
    assert.equal((await import(pathToFileURL(join(output, "main.mjs")).href)).main(), 21);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("CLI staging preserves a plain JavaScript library's transitive declaration contract", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-cli-js-declarations-")));
  const output = join(root, "out");
  const cli = file => spawnSync(process.execPath, ["bin/vibe.js", "compile", join(root, file),
    "--rootDir", root, "--outDir", output, "--declaration", "--format", "json"], {
    cwd: process.cwd(), encoding: "utf8",
  });
  try {
    mkdirSync(join(root, "foreign"));
    writeFileSync(join(root, "foreign/library.mjs"), `/** @module @throws {never} */
const seen = []; export function read() { seen.push(7); return seen.length }
`);
    writeFileSync(join(root, "foreign/library.d.mts"), `/** @module @throws {never} */
import type { Count } from "./types.js";
/** @throws {never} */ export declare function read(): Count;
`);
    writeFileSync(join(root, "foreign/types.d.ts"), "export type Count = number;\n");
    const prefix = 'import { read } from "./foreign/library.mjs";\n';
    writeFileSync(join(root, "bad.vibe"), prefix + "export const wrong: string = read();\n");
    const refused = cli("bad.vibe");
    assert.equal(refused.status, 1, refused.stderr || refused.stdout);
    assert.ok(JSON.parse(refused.stdout).files.some(file => file.diagnostics.some(issue => issue.code === "TS2322")), refused.stdout);
    assert.equal(existsSync(join(output, "bad.mjs")), false);

    writeFileSync(join(root, "main.vibe"), prefix + "export function main(): number { return read() }\n");
    const accepted = cli("main.vibe");
    assert.equal(accepted.status, 0, accepted.stderr || accepted.stdout);
    const declaration = readFileSync(join(output, "__vibelang_foreign__/foreign/library.d.mts"), "utf8");
    assert.match(declaration, /"\.\/types\.mjs"/);
    assert.doesNotMatch(declaration, /@vibelang(?:Module|Effects|Accessor)/);
    assert.match(readFileSync(join(output, "__vibelang_foreign__/foreign/types.d.mts"), "utf8"), /Count = number/);
    rmSync(join(root, "foreign"), { recursive: true, force: true });
    assert.equal((await import(pathToFileURL(join(output, "main.mjs")).href)).main(), 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
