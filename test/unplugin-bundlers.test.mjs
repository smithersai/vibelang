import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import * as esbuild from "esbuild";
import { rollup } from "rollup";
import unplugin from "../dist/unplugin.js";
import { getNativeCompiler } from "../poc/dist/compiler/native.js";

const ENTRY = 'import {work,type Boom} from "./service";function main():Result<number,Boom>{return work()!+1;}export const answer=main().match({ok:n=>n,error:()=>0});';
const SERVICE = 'export class Boom extends Error{};export function work():Result<number,Boom>{return 41;}';

function project(t, sources = { "main.vibe": ENTRY, "service.vibe": SERVICE }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-real-bundler-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (name, source) => {
    const file = join(root, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, source);
    return file;
  };
  for (const [name, source] of Object.entries(sources)) write(name, source);
  mkdirSync(join(root, "node_modules"), { recursive: true });
  symlinkSync(resolve("."), join(root, "node_modules", "vibelang"), process.platform === "win32" ? "junction" : "dir");
  return { root, write, options: { root, entries: ["main.vibe"] } };
}

function execute(p, javascript) {
  const output = p.write("bundle.mjs", javascript);
  const run = spawnSync(process.execPath, ["--input-type=module", "--eval",
    `const module=await import(${JSON.stringify(pathToFileURL(output).href)});console.log(JSON.stringify(module.answer));`],
  { cwd: p.root, encoding: "utf8", timeout: 15_000 });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  return JSON.parse(run.stdout);
}

test("real esbuild compiles a multi-module propagation program and preserves authored maps", async t => {
  const p = project(t);
  const build = await esbuild.build({ absWorkingDir: p.root, entryPoints: ["main.vibe"], bundle: true, format: "esm", platform: "node",
    sourcemap: "external", outfile: "bundle.mjs", write: false, external: ["vibelang/runtime"], plugins: [unplugin.esbuild(p.options)] });
  assert.equal(execute(p, build.outputFiles.find(file => file.path.endsWith(".mjs")).text), 42);
  const map = JSON.parse(build.outputFiles.find(file => file.path.endsWith(".map")).text);
  assert.ok(map.sources.some(source => source.endsWith("main.vibe")));
  assert.ok(map.sourcesContent.includes(ENTRY));
  assert.equal(existsSync(join(p.root, ".vibelang-bundler-output")), false);
});

for (const bundle of [undefined, false]) test(`esbuild refuses unbundled output when bundle is ${bundle}`, async t => {
  const p = project(t, {
    "main.vibe": 'import {value} from "./service.vibe";export const answer=value;',
    "service.vibe": "export const value=42;",
  });
  // Without bundling, esbuild does not load the rewritten dependency IDs and
  // would otherwise publish JavaScript importing an uncompiled .vibe file.
  await assert.rejects(esbuild.build({ absWorkingDir: p.root, entryPoints: ["main.vibe"], bundle,
    format: "esm", platform: "node", outfile: "bundle.mjs", write: false, logLevel: "silent",
    plugins: [unplugin.esbuild(p.options)] }), /requires bundle: true; use 'vibe compile' for unbundled output/);
  assert.equal(existsSync(join(p.root, ".vibelang-bundler-output")), false);
});

test("real Rollup receives ordinary JavaScript before any downstream transform", async t => {
  const p = project(t);
  let transformed = 0;
  const bundle = await rollup({ input: join(p.root, "main.vibe"), external: ["vibelang/runtime"], plugins: [
    unplugin.rollup(p.options), { name: "downstream-js-only", transform(code, id) {
      if (!id.endsWith(".vibe")) return;
      transformed++;
      assert.doesNotMatch(code, /Result<number|work\(\)!/);
      return null;
    } },
  ] });
  try {
    const generated = await bundle.generate({ format: "esm", sourcemap: true });
    assert.equal(execute(p, generated.output[0].code), 42);
    assert.equal(transformed, 2);
    assert.ok(generated.output[0].map.sourcesContent.includes(ENTRY));
  } finally { await bundle.close(); }
});

test("public plugin handles are assignable to all nine host interfaces", () => {
  // Farm and Bun's own declarations currently have unrelated errors (including
  // missing optional packages). Check OUR assignments while leaving those host
  // declarations alone. The installed-consumer package gate independently checks
  // VibeLang's entire public declaration closure with skipLibCheck:false.
  const check = spawnSync(getNativeCompiler().executable, ["--typescript", "--noEmit", "--strict",
    "--module", "nodenext", "--moduleResolution", "nodenext", "--target", "es2022",
    "--skipLibCheck", "true", "--lib", "es2022,dom,esnext.disposable", "test/fixtures/unplugin-types.mts"],
  { cwd: resolve("."), encoding: "utf8", timeout: 30_000 });
  assert.equal(check.status, 0, check.stderr || check.stdout);
});

test("real Vite builds and executes the checked propagation program", async t => {
  const { build } = await import("vite");
  const p = project(t);
  const result = await build({ root: p.root, configFile: false, logLevel: "silent",
    plugins: [unplugin.vite(p.options)], build: { write: false, minify: false, sourcemap: true,
      lib: { entry: join(p.root, "main.vibe"), formats: ["es"], fileName: "bundle" },
      rolldownOptions: { external: ["vibelang/runtime"] },
    } });
  const output = (Array.isArray(result) ? result : [result]).flatMap(item => item.output);
  const entry = output.find(item => item.type === "chunk" && item.isEntry);
  assert.equal(execute(p, entry.code), 42);
  assert.ok(entry.map.sourcesContent.includes(ENTRY));
});

test("real Rolldown builds and executes the checked propagation program", async t => {
  const { rolldown } = await import("rolldown");
  const p = project(t);
  const bundle = await rolldown({ input: join(p.root, "main.vibe"), external: ["vibelang/runtime"],
    plugins: [unplugin.rolldown(p.options)] });
  try {
    const result = await bundle.generate({ format: "esm", sourcemap: true });
    const entry = result.output.find(item => item.type === "chunk" && item.isEntry);
    assert.equal(execute(p, entry.code), 42);
    assert.ok(entry.map.sourcesContent.includes(ENTRY));
  } finally { await bundle.close(); }
});

function webpackOptions(p, host) {
  return { context: p.root, mode: "development", target: "node", entry: join(p.root, "main.vibe"),
    cache: false, devtool: "source-map", experiments: { outputModule: true },
    output: { path: join(p.root, "host-output"), filename: "bundle.mjs", library: { type: "module" } },
    externalsType: "module", externals: ["vibelang/runtime"], plugins: [unplugin[host](p.options)],
  };
}

for (const host of ["webpack", "rspack"]) test(`real ${host} builds and executes the checked propagation program`, async t => {
  const factory = host === "webpack" ? (await import("webpack")).default : (await import("@rspack/core")).rspack;
  const p = project(t);
  const compiler = factory(webpackOptions(p, host));
  try {
    const stats = await new Promise((resolve, reject) => compiler.run((error, stats) => error ? reject(error) : resolve(stats)));
    assert.equal(stats.hasErrors(), false, stats.toString({ all: false, errors: true, errorDetails: true }));
    assert.equal(execute(p, readFileSync(join(p.root, "host-output/bundle.mjs"), "utf8")), 42);
    const map = JSON.parse(readFileSync(join(p.root, "host-output/bundle.mjs.map"), "utf8"));
    assert.ok(map.sourcesContent.includes(ENTRY));
  } finally { await new Promise((resolve, reject) => compiler.close(error => error ? reject(error) : resolve())); }
});

test("real Rsbuild builds and executes the checked propagation program", async t => {
  const { createRsbuild } = await import("@rsbuild/core");
  const p = project(t);
  const instance = await createRsbuild({ cwd: p.root, config: {
    mode: "development", plugins: [unplugin.rsbuild(p.options)], source: { entry: { main: join(p.root, "main.vibe") } },
    output: { target: "node", module: true, externals: ["vibelang/runtime"], distPath: join(p.root, "host-output"),
      filename: { js: "bundle.mjs" }, cleanDistPath: false, minify: false, sourceMap: { js: "source-map" } },
    tools: { rspack: { output: { library: { type: "module" } } } },
    performance: { printFileSize: false },
  } });
  const result = await instance.build();
  try {
    assert.equal(result.stats.hasErrors(), false, result.stats.toString({ all: false, errors: true }));
    const json = result.stats.toJson({ all: false, assets: true });
    const assets = json.assets ?? json.children.flatMap(child => child.assets);
    const entry = assets.find(asset => asset.name.endsWith("bundle.mjs"));
    const output = join(p.root, "host-output", entry.name);
    assert.equal(execute(p, readFileSync(output, "utf8")), 42);
    assert.ok(JSON.parse(readFileSync(output + ".map", "utf8")).sourcesContent.includes(ENTRY));
  } finally { await result.close(); }
});

test("real Farm builds and executes the checked propagation program", async t => {
  const { resolveConfig, createCompiler, NoopLogger } = await import("@farmfe/core");
  const p = project(t);
  const logger = new NoopLogger();
  const config = await resolveConfig({ root: p.root, clearScreen: false, plugins: [unplugin.farm(p.options)],
    compilation: { input: { main: join(p.root, "main.vibe") }, mode: "development",
      output: { path: join(p.root, "host-output"), entryFilename: "bundle.mjs", targetEnv: "node", format: "esm", clean: false },
      external: ["^vibelang/runtime$"], sourcemap: true, minify: false, persistentCache: false, lazyCompilation: false,
    } }, "development", logger, false);
  const compiler = await createCompiler(config, logger);
  await compiler.compile();
  const output = compiler.resources();
  for (const [name, bytes] of Object.entries(output)) p.write(name, bytes);
  assert.equal(execute(p, output["bundle.mjs"].toString()), 42);
  const maps = Object.entries(output).filter(([name]) => name.endsWith(".map"));
  assert.ok(maps.length > 0, `Farm must retain maps; emitted: ${Object.keys(output).join(", ")}`);
  assert.ok(maps.some(([, map]) => JSON.parse(map.toString()).sourcesContent?.includes(ENTRY)));
});

function watchResults(t, label) {
  const queue = [], pending = [], timers = new Set();
  t.after(() => { for (const timer of timers) clearTimeout(timer); });
  return {
    put(result) { const waiter = pending.shift(); if (waiter) waiter(result); else queue.push(result); },
    next() {
      if (queue.length) return Promise.resolve(queue.shift());
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${label} did not invalidate a watched input`)), 20_000);
        timers.add(timer);
        pending.push(result => { clearTimeout(timer); timers.delete(timer); resolve(result); });
      });
    },
  };
}

for (const host of ["webpack", "rspack"]) test(`${host} watch invalidates embedded inputs`, { timeout: 30_000 }, async t => {
  const factory = host === "webpack" ? (await import("webpack")).default : (await import("@rspack/core")).rspack;
  const p = project(t, { "main.vibe": 'import {comptime,embed} from "vibelang:comptime";export const answer=comptime(()=>embed("./input.txt"))();', "input.txt": "before" });
  const compiler = factory(webpackOptions(p, host));
  const results = watchResults(t, host);
  const watcher = compiler.watch({ aggregateTimeout: 20, poll: 50 }, (error, stats) => results.put({ error, stats }));
  try {
    const first = await results.next();
    assert.ifError(first.error);
    assert.equal(first.stats.hasErrors(), false, first.stats.toString({ all: false, errors: true }));
    assert.equal(execute(p, readFileSync(join(p.root, "host-output/bundle.mjs"), "utf8")), "before");
    p.write("input.txt", "after");
    const second = await results.next();
    assert.ifError(second.error);
    assert.equal(second.stats.hasErrors(), false, second.stats.toString({ all: false, errors: true }));
    assert.equal(execute(p, readFileSync(join(p.root, "host-output/bundle.mjs"), "utf8")), "after");
  } finally {
    await new Promise((resolve, reject) => watcher.close(error => error ? reject(error) : resolve()));
    await new Promise((resolve, reject) => compiler.close(error => error ? reject(error) : resolve()));
  }
});

test("Rollup watch invalidates embedded inputs", { timeout: 30_000 }, async t => {
  const { watch } = await import("rollup");
  const p = project(t, { "main.vibe": 'import {comptime,embed} from "vibelang:comptime";export const answer=comptime(()=>embed("./input.txt"))();', "input.txt": "before" });
  const results = watchResults(t, "Rollup");
  const watcher = watch({ input: join(p.root, "main.vibe"), external: ["vibelang/runtime"], plugins: [unplugin.rollup(p.options)],
    output: { file: join(p.root, "host-output/bundle.mjs"), format: "esm", sourcemap: true },
    watch: { skipWrite: true, chokidar: { usePolling: true, interval: 50 } },
  });
  watcher.on("event", async event => {
    if (event.code === "ERROR") results.put({ error: event.error });
    if (event.code !== "BUNDLE_END") return;
    try {
      assert.ok(event.result.watchFiles.includes(join(p.root, "input.txt")));
      const result = await event.result.generate({ format: "esm" });
      // Rollup's first BUNDLE_END occurs before Chokidar's initial asynchronous
      // poll has established baselines. Its public watcher has no ready event.
      // Allow that first poll to complete before changing the input under test.
      await new Promise(resolve => setTimeout(resolve, 150));
      results.put({ code: result.output.find(item => item.type === "chunk" && item.isEntry).code });
    } catch (error) { results.put({ error }); }
    finally { await event.result.close(); }
  });
  try {
    const first = await results.next();
    assert.ifError(first.error);
    assert.equal(execute(p, first.code), "before");
    p.write("input.txt", "after");
    const second = await results.next();
    assert.ifError(second.error);
    assert.equal(execute(p, second.code), "after");
  } finally { await watcher.close(); }
});

test("Vite's dev-server transform cache invalidates comptime reads", { timeout: 30_000 }, async t => {
  const { createServer } = await import("vite");
  const p = project(t, { "main.vibe": 'import {comptime,embed} from "vibelang:comptime";export const answer=comptime(()=>embed("./input.txt"))();', "input.txt": "before" });
  const server = await createServer({ root: p.root, configFile: false, logLevel: "silent",
    server: { middlewareMode: true, watch: { usePolling: true, interval: 50 } },
    plugins: [unplugin.vite(p.options)],
  });
  try {
    assert.match((await server.transformRequest("/main.vibe")).code, /answer = "before"/);
    p.write("input.txt", "after");
    const deadline = Date.now() + 20_000;
    while (!(await server.transformRequest("/main.vibe")).code.includes('answer = "after"')) {
      assert.ok(Date.now() < deadline, "Vite returned a stale comptime transform");
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  } finally { await server.close(); }
});

test("Vite rechecks changed package declarations and recovers from a rejected build", { timeout: 30_000 }, async t => {
  const { createServer } = await import("vite");
  const p = project(t, {
    "main.vibe": 'import type {Value} from "watched";export const answer:Value=42;',
    "node_modules/watched/package.json": '{"name":"watched","types":"index.d.ts"}',
    "node_modules/watched/index.d.ts": "export type Value=number;",
  });
  const server = await createServer({ root: p.root, configFile: false, logLevel: "silent",
    server: { middlewareMode: true }, plugins: [unplugin.vite(p.options)],
  });
  const until = async predicate => {
    const deadline = Date.now() + 20_000;
    while (!await predicate()) {
      assert.ok(Date.now() < deadline, "Vite did not recheck its package declaration dependency");
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  };
  try {
    assert.match((await server.transformRequest("/main.vibe")).code, /answer = 42/);
    p.write("node_modules/watched/index.d.ts", "export type Value=string;");
    await until(async () => {
      try { await server.transformRequest("/main.vibe"); return false; }
      catch (error) { assert.match(error.message, /TS2322/); return true; }
    });
    p.write("node_modules/watched/index.d.ts", "export type Value=number;");
    await until(async () => {
      try { return (await server.transformRequest("/main.vibe")).code.includes("answer = 42"); }
      catch (error) { assert.match(error.message, /TS2322/); return false; }
    });
  } finally { await server.close(); }
});

test("real esbuild owns foreign TypeScript while the plugin serves generated assets", async t => {
  const p = project(t, {
    "main.vibe": 'import text from "./input.txt" with {type:"text"};import {value} from "./foreign.ts";export const answer=text+value;',
    "input.txt": "asset:", "foreign.ts": '/** @module @throws {never} */\nexport const value:number=42;',
  });
  let foreignSeen = false;
  const result = await esbuild.build({ absWorkingDir: p.root, entryPoints: ["main.vibe"], bundle: true, format: "esm", platform: "node",
    write: false, external: ["vibelang/runtime"], plugins: [unplugin.esbuild(p.options), {
      name: "foreign-owner", setup(build) { build.onLoad({ filter: /foreign\.ts$/ }, args => {
        foreignSeen = true;
        const source = readFileSync(args.path, "utf8");
        assert.match(source, /value:number/);
        return { contents: source, loader: "ts" };
      }); },
    }] });
  assert.equal(execute(p, result.outputFiles[0].text), "asset:42");
  assert.equal(foreignSeen, true);
});

test("real Bun bundler compiles and executes the same checked program", t => {
  const p = project(t);
  const driver = p.write("build.ts", `import unplugin from ${JSON.stringify(pathToFileURL(resolve("dist/unplugin.js")).href)};
const result = await Bun.build({entrypoints:[${JSON.stringify(join(p.root, "main.vibe"))}],target:"bun",format:"esm",sourcemap:"external",external:["vibelang/runtime"],plugins:[unplugin.bun(${JSON.stringify(p.options)})]});
if(!result.success)throw new Error(result.logs.map(String).join("\\n"));
const module= result.outputs.find(output=>output.kind === "entry-point");
if(!module)throw new Error("entry missing");
await Bun.write(${JSON.stringify(join(p.root, "bun-bundle.mjs"))},module);
const built=await import(${JSON.stringify(pathToFileURL(join(p.root, "bun-bundle.mjs")).href)});
console.log(JSON.stringify({answer:built.answer,maps:result.outputs.filter(output=>output.kind === "sourcemap").length}));`);
  const result = spawnSync("bun", [driver], { cwd: p.root, encoding: "utf8", timeout: 30_000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout), { answer: 42, maps: 1 });
});

test("esbuild watch recompiles callers when a callee gains a capability requirement", { timeout: 30_000 }, async t => {
  const service = (body) => 'import {Context} from "vibelang/context";export abstract class Value extends Context{abstract read():number;}export function get(){' + body + '}';
  const p = project(t, {
    "main.vibe": 'import {get,Value} from "./service.vibe";import {Layer} from "vibelang/provider";class Live extends Value{read(){return 43;}}export const answer=Layer.provide(Layer.succeed(Value,new Live()),()=>get());',
    "service.vibe": service("return 42;"),
  });
  p.write("bundle.mjs", "");
  const queue = [], pending = [];
  const next = () => queue.length ? Promise.resolve(queue.shift()) : new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("esbuild did not rebuild after an imported requirement changed")), 20_000);
    pending.push(value => { clearTimeout(timer); resolve(value); });
  });
  const context = await esbuild.context({ absWorkingDir: p.root, entryPoints: ["main.vibe"], bundle: true, format: "esm", platform: "node",
    write: false, logLevel: "silent", external: ["vibelang/runtime"], plugins: [unplugin.esbuild(p.options), {
      name: "watch-results", setup(build) { build.onEnd(result => {
        const waiter = pending.shift();
        if (waiter) waiter(result); else queue.push(result);
      }); },
    }] });
  try {
    await context.watch();
    const first = await next();
    assert.deepEqual(first.errors, []);
    assert.equal(execute(p, first.outputFiles[0].text), 42);
    p.write("service.vibe", service("return Value.context().read();"));
    const second = await next();
    assert.deepEqual(second.errors, []);
    assert.equal(execute(p, second.outputFiles[0].text), 43);
  } finally { await context.dispose(); }
});

for (const fixture of [
  { name: "missing nested asset", source: 'import text from "./inputs/nested/value.txt" with {type:"text"};export const answer=text;',
    inputs: { "inputs/nested/existing.txt": "keeps the parent directory present" },
    create: { "inputs/nested/value.txt": "recovered asset" }, answer: "recovered asset" },
  { name: "missing nested comptime embed", source: 'import {comptime,embed} from "vibelang:comptime";export const answer=comptime(()=>embed("./inputs/nested/value.txt"))();',
    inputs: { "inputs/nested/existing.txt": "keeps the parent directory present" },
    create: { "inputs/nested/value.txt": "recovered embed" }, answer: "recovered embed" },
  { name: "missing package declaration", source: 'import type {Value} from "watched";export const answer:Value=42;',
    inputs: { "node_modules/watched/package.json": '{"name":"watched","types":"index.d.ts"}' },
    create: { "node_modules/watched/index.d.ts": "export type Value=number;" }, answer: 42 },
]) test(`esbuild watch recovers when a ${fixture.name} appears`, { timeout: 30_000 }, async t => {
  const p = project(t, { "main.vibe": fixture.source, ...fixture.inputs });
  p.write("bundle.mjs", "");
  const queue = [], pending = [];
  const next = () => queue.length ? Promise.resolve(queue.shift()) : new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`watch lost ${fixture.name}`)), 20_000);
    pending.push(result => { clearTimeout(timer); resolve(result); });
  });
  const context = await esbuild.context({ absWorkingDir: p.root, entryPoints: ["main.vibe"], bundle: true, format: "esm", platform: "node",
    write: false, logLevel: "silent", external: ["vibelang/runtime"], plugins: [unplugin.esbuild(p.options), {
      name: "watch-errors", setup(build) { build.onEnd(result => {
        const waiter = pending.shift();
        if (waiter) waiter(result); else queue.push(result);
      }); },
    }] });
  try {
    await context.watch();
    assert.ok((await next()).errors.length > 0);
    for (const [name, text] of Object.entries(fixture.create)) p.write(name, text);
    const recovered = await next();
    assert.deepEqual(recovered.errors, []);
    assert.deepEqual(execute(p, recovered.outputFiles[0].text), fixture.answer);
  } finally { await context.dispose(); }
});
