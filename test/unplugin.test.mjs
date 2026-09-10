import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import unplugin, { unpluginFactory, VibeLangBuildError } from "../dist/unplugin.js";

function setup(t, sources = { "main.vibe": "export const answer = 42;" }, options = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-unplugin-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  function write(name, source) {
    const file = join(root, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, source);
    return file;
  }
  for (const [name, source] of Object.entries(sources)) write(name, source);
  const plugin = unpluginFactory({ root, entries: ["main.vibe"], ...options }, { framework: "rollup" });
  const watched = new Set();
  const context = { addWatchFile(file) { watched.add(file); }, getWatchFiles() { return [...watched]; },
    error(error) { throw error; }, warn() {}, parse() { throw new Error("host parser must not be used"); }, emitFile() { throw new Error("no disk emit"); } };
  const load = (name = "main.vibe") => plugin.load.handler.call(context, name.startsWith("virtual:") ? name : join(root, name));
  return { root, plugin, context, watched, load, write };
}

test("unplugin factory exposes all specified host adapters", () => {
  for (const name of ["vite", "rollup", "webpack", "esbuild", "rspack", "rolldown", "farm", "bun", "rsbuild"])
    assert.equal(typeof unplugin[name], "function", name);
});

for (const options of [undefined, {}, { entries: [] }, { entries: ["main.ts"] }, { entries: ["../main.vibe"] },
  { entries: ["main.vibe"], mode: "guess" }, { entries: ["main.vibe"], target: "" }, { entries: ["main.vibe"], unexpected: true }])
  test(`factory refuses invalid project options ${JSON.stringify(options)}`, () => assert.throws(() => unpluginFactory(options, { framework: "rollup" })));

test("checked is default and source maps lead to authored bytes", async t => {
  const { root, plugin, load, watched } = setup(t);
  assert.equal(plugin.enforce, "pre");
  const result = await load();
  assert.match(result.code, /export const answer = 42/);
  assert.doesNotMatch(result.code, /sourceMappingURL/);
  const map = result.map;
  assert.deepEqual(map.sources, [join(root, "main.vibe")]);
  assert.deepEqual(map.sourcesContent, ["export const answer = 42;"]);
  assert.ok(watched.has(join(root, "main.vibe")));
});

for (const extension of ["ts", "tsx", "js", "jsx", "mjs", "cts"])
  test(`plugin leaves .${extension} contents to its host`, async t => {
    const { root, plugin, context } = setup(t);
    assert.equal(await plugin.transform.handler.call(context, "not language", join(root, `foreign.${extension}`)), null);
    assert.equal(await plugin.load.handler.call(context, join(root, `foreign.${extension}`)), null);
  });

test("explicit and extensionless VibeLang imports resolve without claiming bare packages", async t => {
  const p = setup(t, { "main.vibe": "export {};", "child.vibe": "export {};" });
  const importer = join(p.root, "entry.ts");
  for (const name of ["./child.vibe", "./child", "./child.js"])
    assert.equal(await p.plugin.resolveId.call(p.context, name, importer, { isEntry: false }), join(p.root, "child.vibe"));
  assert.equal(await p.plugin.resolveId.call(p.context, "package/child.vibe", importer, { isEntry: false }), null);
  assert.throws(() => p.plugin.resolveId.call(p.context, "./child.vibe?raw", importer, { isEntry: false }), /query\/hash/);
});

test("cross-module typed failures use one checked project and rewrite only module literals", async t => {
  const p = setup(t, {
    "main.vibe": 'import {work} from "./service.vibe";export const answer = work().match({ok:n=>n,error:()=>0});export const untouched="./service.mjs";',
    "service.vibe": "export class Boom extends Error{};export function work():Result<number,Boom>{return 42;}",
  });
  const output = await p.load();
  assert.ok(output.code.includes(JSON.stringify(join(p.root, "service.vibe"))));
  assert.match(output.code, /untouched = "\.\/service\.mjs"/);
  assert.ok(p.watched.has(join(p.root, "service.vibe")));
  const service = await p.load("service.vibe");
  assert.match(service.code, /__vs/);
  assert.deepEqual(output.map.sources, [join(p.root, "main.vibe")]);
});

test("checked mode refuses an error in any explicit root before returning code", async t => {
  const p = setup(t, { "main.vibe": "export const answer = 42;", "other.vibe": 'export const bad:number="no";' }, { entries: ["main.vibe", "other.vibe"] });
  await assert.rejects(p.load(), error => error instanceof VibeLangBuildError && error.diagnostics.some(issue => issue.code === "TS2322"));
});

test("an undeclared independent entry cannot silently become a second program", async t => {
  const p = setup(t, { "main.vibe": "export const answer=1;", "outside.vibe": "export const answer=2;" });
  await assert.rejects(p.load("outside.vibe"), /outside the checked entry closure/);
});

test("host transform uses supplied bytes and does not rewrite already-loaded JavaScript", async t => {
  const p = setup(t);
  const id = join(p.root, "main.vibe");
  const transformed = await p.plugin.transform.handler.call(p.context, "export const answer = 7;", id);
  assert.match(transformed.code, /answer = 7/);
  assert.match(readFileSync(id, "utf8"), /42/);
  await p.load();
  assert.equal(await p.plugin.transform.handler.call(p.context, transformed.code, id), null);
});

test("watch invalidation recomputes imported signatures and recovers from a refusal", async t => {
  const p = setup(t, {
    "main.vibe": 'import {value} from "./service.vibe";export const answer:number=value;',
    "service.vibe": "export const value = 42;",
  });
  await p.load();
  const service = p.write("service.vibe", 'export const value = "wrong";');
  p.plugin.watchChange.call(p.context, service, { event: "update" });
  await assert.rejects(p.load(), /TS2322/);
  p.write("service.vibe", "export const value = 7;");
  p.plugin.watchChange.call(p.context, service, { event: "update" });
  await p.load();
  assert.match((await p.load("service.vibe")).code, /value = 7/);
});

test("asset modules are in-memory and ordinary foreign modules stay with host transforms", async t => {
  const p = setup(t, {
    "main.vibe": 'import text from "./input.txt" with {type:"text"};import {value} from "./foreign.ts";export const answer=text+value;',
    "input.txt": "hello", "foreign.ts": '/** @module @throws {never} */\nexport const value:number=42;',
  });
  const result = await p.load();
  const edges = result.code.match(/"virtual:vibelang:asset\/[^\"]+"/g);
  assert.equal(edges.length, 1);
  const asset = await p.load(JSON.parse(edges[0]));
  assert.match(asset.code, /hello/);
  assert.ok(result.code.includes(JSON.stringify(join(p.root, "foreign.ts"))));
  assert.ok(p.watched.has(join(p.root, "input.txt")));
  await assert.rejects(p.load("virtual:vibelang:asset/forged"), /outside the checked entry closure/);
});

test("transform-only lowers a closed single file but refuses cross-module conventions", async t => {
  const p = setup(t, { "main.vibe": "function work(){return 42;}export const answer=work();" }, { mode: "transform-only" });
  assert.match((await p.load()).code, /work/);
  p.write("main.vibe", 'import {value} from "./service.vibe";export const answer=value;');
  p.write("service.vibe", "export const value=42;");
  p.plugin.watchChange.call(p.context, join(p.root, "main.vibe"), { event: "update" });
  await assert.rejects(p.load(), /transform-only cannot decide cross-module/);
});

test("new bundler delivery never silently emits the withdrawn durable body profile", async t => {
  const p = setup(t, { "main.vibe": 'import {durable} from "vibelang:flows";export const flow = durable(() => 42);' });
  await assert.rejects(p.load(), /use 'vibe plan'/);
});
