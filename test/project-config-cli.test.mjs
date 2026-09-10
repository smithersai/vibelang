import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

const cli = resolve("bin/vibe.js");
const mandatory = { strict: true, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true,
  isolatedModules: true, verbatimModuleSyntax: true, useDefineForClassFields: true };
function project(t, config = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-project-mode-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (file, text) => { const path = join(root, file); mkdirSync(dirname(path), {recursive:true}); writeFileSync(path, text); return path; };
  write("tsconfig.json", JSON.stringify({ compilerOptions: mandatory, ...config }));
  return { root, write, run(command, backend = "js", args = []) {
    return spawnSync(process.execPath, [cli, command, "-p", root, "--backend", backend, "--format", "json", ...args],
      { cwd: root, encoding: "utf8", timeout: 120_000 });
  } };
}
for (const backend of ["js", "go"]) {
  test(`${backend} project mode checks implicitly discovered .vibe files`, t => {
    const p = project(t);
    p.write("main.vibe", 'export const answer: number = "broken";');
    p.write("plain.ts", "export const sentinel = 1;");
    const result = p.run("check", backend);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /TS2322/);
    assert.match(result.stdout, /main\.vibe/);
  });
  test(`${backend} project mode refuses weakened language configuration`, t => {
    const p = project(t, {compilerOptions: {...mandatory, strict:false}});
    p.write("main.vibe", "export const answer = 42;");
    p.write("plain.ts", "export {};");
    const result = p.run("check", backend);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /VIBE6001/);
  });
  test(`${backend} project mode respects JSONC extends, include and exclude`, t => {
    const p = project(t);
    p.write("base.json", JSON.stringify({compilerOptions:{...mandatory, rootDir:"src", outDir:"build"}}));
    p.write("tsconfig.json", '// inherited\n{"extends":"./base.json","include":["src/**/*"],"exclude":["src/skip/**"],}');
    p.write("src/main.vibe", "export const answer: number = 42;");
    p.write("src/skip/broken.vibe", 'export const bad: number = "wrong";');
    p.write("outside.vibe", 'export const bad: number = "wrong";');
    const result = p.run("compile", backend);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const file = join(p.root, "build", backend === "go" ? "main.js" : "main.mjs");
    assert.ok(existsSync(file), result.stdout);
    assert.match(readFileSync(file,"utf8"), /answer/);
    assert.equal(existsSync(join(p.root,"build/skip")), false);
  });
  test(`${backend} project mode does not ignore disconnected TypeScript errors`, t => {
    const p = project(t, {compilerOptions:{...mandatory,outDir:"build"}});
    p.write("main.vibe", "export const answer = 42;");
    p.write("plain.ts", 'export const bad: number = "wrong";');
    const result = p.run("compile", backend);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /TS2322/);
    assert.match(result.stdout, /plain\.ts/);
    assert.equal(existsSync(join(p.root,"build")), false, "refused project must not publish a partial build");
  });
}
test("plain TypeScript project mode keeps native TypeScript option semantics", t => {
  const p = project(t, {compilerOptions:{strict:false}});
  p.write("plain.ts", "export const answer = 42;");
  const result = p.run("check");
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
