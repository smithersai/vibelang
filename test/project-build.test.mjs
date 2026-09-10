import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { compileVibeLangFiles, loadVibeLangProject } from "../dist/project-build.js";

function project(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-build-host-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (name, text) => {
    const file = join(root, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
    return file;
  };
  return { root, write, outDir: join(root, "virtual-output") };
}

async function build(p, options = {}) {
  const publications = [], files = new Set(), directories = new Set();
  const results = await compileVibeLangFiles([join(p.root, "main.vibe")], {
    rootDir: p.root, outDir: p.outDir, sourceMap: true,
    onDependencies(trace) {
      trace.files.forEach(file => files.add(file));
      trace.directories.forEach(file => directories.add(file));
    },
    publish(value) { publications.push(value); },
    ...options,
  });
  return { results, publications, files, directories };
}

const diagnostics = result => result.results.flatMap(file => file.diagnostics);
const output = (result, name) => result.publications[0].outputs.find(file => file.fileName.endsWith(`/${name}`)).code;

test("shared project pipeline publishes JavaScript and authored maps without writing output files", async t => {
  const p = project(t);
  const source = "export const answer: number = 42;\n";
  const input = p.write("main.vibe", source);
  const result = await build(p);
  assert.deepEqual(diagnostics(result), []);
  assert.equal(result.publications.length, 1);
  assert.equal(existsSync(p.outDir), false);
  assert.match(output(result, "main.mjs"), /export const answer = 42/);
  const map = JSON.parse(output(result, "main.mjs.map"));
  assert.equal(map.version, 3);
  assert.deepEqual(map.sourcesContent, [source]);
  assert.equal(resolve(p.outDir, map.sources[0]), input);
  assert.ok(map.mappings.length > 0);
  assert.deepEqual(result.publications[0].modules, [{ kind: "vibelang", sourceFileName: input, outputFileName: join(p.outDir, "main.mjs") }]);
  assert.ok(result.files.has(input));
});

test("shared pipeline keeps foreign files distinct from generated language modules", async t => {
  const p = project(t);
  p.write("main.vibe", 'import {answer} from "./foreign.js";export const result = answer;');
  const text = '/** @module @throws {never} */\nexport const answer: number = 42;';
  const foreign = p.write("foreign.ts", text);
  const result = await build(p);
  assert.deepEqual(diagnostics(result), []);
  assert.equal(result.publications[0].modules.find(module => module.sourceFileName === foreign).kind, "foreign");
  assert.equal(readFileSync(foreign, "utf8"), text);
  assert.ok(result.files.has(foreign));
  assert.equal(existsSync(p.outDir), false);
});

test("refused projects publish nothing, retain diagnostics and report negative resolution probes", async t => {
  const p = project(t);
  const input = p.write("main.vibe", 'import type {Missing} from "unpublished";export const answer: Missing = 42;');
  const result = await build(p);
  assert.ok(diagnostics(result).some(issue => issue.severity === "error"));
  assert.equal(result.publications.length, 0);
  assert.equal(result.results[0].output, undefined);
  assert.equal(existsSync(p.outDir), false);
  assert.ok(result.files.has(input));
  assert.ok([...result.directories].some(path => path.endsWith("/node_modules") || path.endsWith("/node_modules/unpublished")));
});

test("an emit:false project never calls either publication destination", async t => {
  const p = project(t);
  p.write("main.vibe", "export const answer = 42;");
  const result = await build(p, { emit: false });
  assert.deepEqual(diagnostics(result), []);
  assert.equal(result.publications.length, 0);
  assert.equal(result.results[0].output, undefined);
  assert.equal(existsSync(p.outDir), false);
});

test("source overrides affect code, maps and discovered imports without changing authored files", async t => {
  const p = project(t);
  const disk = "export const answer = 1;";
  const input = p.write("main.vibe", disk);
  const callee = p.write("callee.vibe", "export const value = 42;");
  const override = 'import {value} from "./callee.vibe";export const answer = value;';
  const result = await build(p, { sourceOverrides: new Map([[input, override]]) });
  assert.deepEqual(diagnostics(result), []);
  assert.equal(result.results.length, 2);
  assert.match(output(result, "main.mjs"), /callee\.mjs/);
  assert.deepEqual(JSON.parse(output(result, "main.mjs.map")).sourcesContent, [override]);
  assert.ok(result.files.has(callee));
  assert.equal(readFileSync(input, "utf8"), disk);
});

test("native package declarations and metadata remain build dependencies", async t => {
  const p = project(t);
  p.write("main.vibe", 'import {value} from "watched";export const answer: number = value;');
  const metadata = p.write("node_modules/watched/package.json", '{"name":"watched","types":"index.d.ts"}');
  const declaration = p.write("node_modules/watched/index.d.ts", '/** @module @throws {never} */\nexport declare const value: number;');
  const good = await build(p);
  assert.deepEqual(diagnostics(good), []);
  assert.ok(good.files.has(metadata));
  assert.ok(good.files.has(declaration));
  p.write("node_modules/watched/index.d.ts", '/** @module @throws {never} */\nexport declare const value: string;');
  const bad = await build(p);
  assert.ok(diagnostics(bad).some(issue => issue.code === "TS2322"));
  assert.equal(bad.publications.length, 0);
  assert.ok(bad.files.has(declaration));
});

test("asset outputs are identified as generated modules and their bytes are tracked", async t => {
  const p = project(t);
  p.write("main.vibe", 'import text from "./input.txt" with {type:"text"};export const answer = text;');
  const asset = p.write("input.txt", "hello from an asset");
  const result = await build(p);
  assert.deepEqual(diagnostics(result), []);
  const generated = result.publications[0].modules.filter(module => module.kind === "asset");
  assert.equal(generated.length, 1);
  assert.ok(result.publications[0].outputs.some(file => file.fileName === generated[0].outputFileName && file.code.includes("hello from an asset")));
  assert.ok(result.files.has(asset));
  assert.equal(existsSync(p.outDir), false);
});

test("comptime target and embedded bytes change code and cache identity", async t => {
  const p = project(t);
  p.write("main.vibe", 'import {comptime,embed} from "vibelang:comptime";export const answer = comptime(() => ({target:comptime.target,text:embed("./input.txt")}))();');
  const input = p.write("input.txt", "before");
  const first = await build(p, { target: "browser-es2022" });
  assert.deepEqual(diagnostics(first), []);
  assert.match(output(first, "main.mjs"), /browser-es2022/);
  assert.match(output(first, "main.mjs"), /before/);
  assert.ok(first.files.has(input));
  p.write("input.txt", "after");
  const second = await build(p, { target: "bun-es2022" });
  assert.deepEqual(diagnostics(second), []);
  assert.match(output(second, "main.mjs"), /bun-es2022/);
  assert.match(output(second, "main.mjs"), /after/);
  assert.notEqual(first.results[0].comptime.cacheIdentity, second.results[0].comptime.cacheIdentity);
  assert.notEqual(first.results[0].assets.cacheIdentity, second.results[0].assets.cacheIdentity);
});

test("overrides cannot replace foreign files or escape the declared project", t => {
  const p = project(t);
  const main = p.write("main.vibe", "export const answer = 1;");
  const foreign = p.write("foreign.ts", "export const answer = 2;");
  assert.throws(() => loadVibeLangProject([main], p.root, undefined, { sourceOverrides: new Map([[foreign, "export {}"]]) }), /distinct .vibe/);
  assert.throws(() => loadVibeLangProject([main], p.root, { maximumFiles: 5, maximumFileBytes: 4, maximumTotalBytes: 64 },
    { sourceOverrides: new Map([[main, "too large"]]) }), /budget/);
});

for (const [kind, source] of [
  ["asset", 'import value from "./nested/absent.txt" with {type:"text"};export const answer=value;'],
  ["embed", 'import {comptime,embed} from "vibelang:comptime";export const answer=comptime(()=>embed("./nested/absent.txt"))();'],
]) test(`a refused ${kind} build reports its absent input without publishing`, async t => {
  const p = project(t);
  p.write("main.vibe", source);
  p.write("nested/existing.txt", "parent exists");
  const result = await build(p);
  assert.ok(diagnostics(result).some(issue => issue.severity === "error"));
  assert.equal(result.publications.length, 0);
  assert.ok(result.files.has(join(p.root, "nested/absent.txt")));
});
