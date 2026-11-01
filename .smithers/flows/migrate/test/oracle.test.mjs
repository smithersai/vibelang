import { createRequire } from "node:module"
// The declaration gate answers to the repository's own compiler (oracle.mjs):
// alchemy-23's native baseline skipped packages/aws's Pipes/builders.d.ts
// (TS5088) while tsrs published it, so "identical to the native baseline"
// proved nothing for a batch that migrated builders.ts.
import assert from "node:assert/strict"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { emitDeclarations, loadTypeScript } from "../lib/declarations.mjs"
import { declarationNames, findStockCompiler, unprovenDeclarations, unprovenMigrations } from "../lib/oracle.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))

const runtime = fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))
const ts = loadTypeScript([runtime])
const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-stock-oracle-builders.json", import.meta.url), "utf8"))

function tree(files) {
  const root = mkdtempSync(join(tmpdir(), "oracle-"))
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true })
    writeFileSync(join(root, name), text)
  }
  return root
}

const packageTsconfig = JSON.stringify({ compilerOptions: { strict: true, target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", rootDir: "src", outDir: "lib", declaration: true, skipLibCheck: true, types: [] }, include: ["src/**/*.ts", "src/**/*.vibe"] })

test("findStockCompiler takes the compiler the package's scripts run, then the root's, then tsc, tsgo, tsrs", () => {
  const bin = (dir, name) => {
    mkdirSync(join(dir, "node_modules/.bin"), { recursive: true })
    writeFileSync(join(dir, "node_modules/.bin", name), "#!/bin/sh\n")
    chmodSync(join(dir, "node_modules/.bin", name), 0o755)
  }
  const root = tree({ "package.json": JSON.stringify({ scripts: { build: "pnpm -r build" } }), "packages/aws/package.json": JSON.stringify({ scripts: { "build:package": "tsrs -b" } }) })
  try {
    bin(root, "tsc")
    assert.equal(findStockCompiler(root, join(root, "packages/aws")), null)
    bin(root, "tsrs")
    assert.deepEqual(findStockCompiler(root, join(root, "packages/aws")), { name: "tsrs", path: join(root, "node_modules/.bin/tsrs") })
    bin(join(root, "packages/aws"), "tsrs")
    assert.equal(findStockCompiler(root, join(root, "packages/aws")).path, join(root, "packages/aws/node_modules/.bin/tsrs"))
    assert.equal(findStockCompiler(root, join(root, "packages/none")).name, "tsc") // no script names one
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
  const bare = tree({ "package.json": "{}", "packages/x/package.json": "{}" })
  try {
    assert.equal(findStockCompiler(bare, join(bare, "packages/x")), null)
  } finally {
    rmSync(bare, { recursive: true, force: true })
  }
})

test("declarationNames names the declaration of every source, also one the compiler did not write, by each spelling", () => {
  const root = tree({ "tsconfig.json": packageTsconfig, "src/Pipes/builders.vibe": "export const x = 1\n", "src/Ok.ts": "export const ok = 1\n" })
  try {
    const names = declarationNames(ts, root, [{ tsconfig: "tsconfig.json", prefix: "." }])
    assert.equal(names["src/Pipes/builders.vibe"], "Pipes/builders.d.ts")
    assert.equal(names["src/Pipes/builders.ts"], "Pipes/builders.d.ts")
    assert.equal(names["src/Ok.ts"], "Ok.d.ts")
    assert.equal(names["src/Ok.vibe"], "Ok.d.ts")
    const two = declarationNames(ts, root, [{ tsconfig: "tsconfig.json", prefix: "tsconfig.json" }])
    assert.equal(two["src/Ok.ts"], "tsconfig.json/Ok.d.ts")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("alchemy-23: a batch that migrates a module whose declaration the native baseline skipped is unproven", () => {
  const stock = tree(corpus.stock)
  const native = tree(corpus.native)
  const pkg = tree({ "tsconfig.json": packageTsconfig, ...corpus.source })
  try {
    const oracle = unprovenDeclarations(ts, stock, native)
    assert.deepEqual(oracle.files, ["Pipes/builders.d.ts"])
    assert.deepEqual(oracle.missing, ["Pipes/builders.d.ts"])
    const names = declarationNames(ts, pkg, [{ tsconfig: "tsconfig.json", prefix: "." }])
    const found = unprovenMigrations({ migrated: corpus.migrated, pkgDir: corpus.package, names, oracle })
    assert.deepEqual(found.map((x) => x.file), corpus.unproven)
    assert.match(found[0].reason, /no declaration/)
    // Another package's file of the same name is not this package's.
    assert.deepEqual(unprovenMigrations({ migrated: ["packages/gcp/src/Pipes/builders.vibe"], pkgDir: corpus.package, names, oracle }), [])
  } finally {
    for (const dir of [stock, native, pkg]) rmSync(dir, { recursive: true, force: true })
  }
})

test("the stock compiler's emit goes through emitDeclarations with the flags vibelang's does", async () => {
  // TypeScript 5.9 (strada) writes builders.d.ts with /*elided*/ any where TS 7.1.0-beta stopped with TS5088.
  const pkg = tree({ "tsconfig.json": packageTsconfig, ...corpus.source })
  try {
    const out = join(pkg, "stock")
    const emitted = await emitDeclarations({ compiler: join(runtime, "node_modules/.bin/tsc"), tsconfig: "tsconfig.json", cwd: pkg, outDir: out, root: pkg })
    assert.equal(emitted.code, 0)
    assert.equal(emitted.files, 2)
    const native = tree(corpus.native)
    try {
      assert.deepEqual(unprovenDeclarations(ts, out, native).missing, ["Pipes/builders.d.ts"])
    } finally {
      rmSync(native, { recursive: true, force: true })
    }
  } finally {
    rmSync(pkg, { recursive: true, force: true })
  }
})

test("property: spelling never makes a declaration unproven, and every type or file difference does", () => {
  // Seeded: each file of the stock tree is in the native tree as is, respelled
  // (comments, quotes, union and member order, redundant parentheses), with a
  // changed type, or absent; the native tree may add files of its own.
  let seed = 23
  const next = (n) => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % n)
  const types = ["string", "number", "boolean", "\"a\" | \"b\"", "ReadonlyArray<string>"]
  for (let round = 0; round < 40; round++) {
    const stock = {}
    const native = {}
    const expected = new Set()
    const count = 1 + next(5)
    for (let i = 0; i < count; i++) {
      const name = `m${i}.d.ts`
      const t = types[next(types.length)]
      stock[name] = `export declare const v${i}: ${t};\nexport interface I${i} { a: string; b: number }\n`
      switch (next(4)) {
        case 0:
          native[name] = stock[name]
          break
        case 1:
          native[name] = `/** doc */\nexport declare const v${i}: (${t.includes("|") ? "'b' | 'a'" : t});\nexport interface I${i} {\n  b: number;\n  a: string;\n}\n`
          break
        case 2:
          native[name] = `export declare const v${i}: ${t === "string" ? "number" : "string"};\nexport interface I${i} { a: string; b: number }\n`
          expected.add(name)
          break
        default:
          expected.add(name)
      }
    }
    if (next(3) === 0) {
      native["extra.d.ts"] = "export declare const extra: string;\n"
      expected.add("extra.d.ts")
    }
    const a = tree(stock)
    const b = tree(native)
    try {
      assert.deepEqual(unprovenDeclarations(ts, a, b).files, [...expected].sort(), JSON.stringify({ stock, native }))
    } finally {
      rmSync(a, { recursive: true, force: true })
      rmSync(b, { recursive: true, force: true })
    }
  }
})

test("alchemy: the declaration build compiler wins over a different typecheck compiler and a missing one has no fallback", () => {
  const root = tree({
    "package.json": JSON.stringify({ scripts: { typecheck: "tsc --noEmit" } }),
    "packages/aws/package.json": JSON.stringify({ scripts: { typecheck: "tsc --noEmit", "build:package": "tsrs -b" } }),
    "node_modules/.bin/tsc": "#!/bin/sh\\n",
    "node_modules/.bin/tsrs": "#!/bin/sh\\n"
  })
  try {
    assert.equal(findStockCompiler(root, join(root, "packages/aws")).name, "tsrs")
    rmSync(join(root, "node_modules/.bin/tsrs"))
    assert.equal(findStockCompiler(root, join(root, "packages/aws")), null)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("property: declaration script selection ignores manifest insertion order and missing primary compilers", () => {
  const fc = require("fast-check")
  fc.assert(fc.property(fc.shuffledSubarray(["typecheck", "lint:types", "build:package"], { minLength: 3, maxLength: 3 }), fc.constantFrom("tsrs", "tsgo"), fc.boolean(), (order, compiler, installed) => {
    const scripts = Object.fromEntries(order.map(name => [name, name === "build:package" ? compiler + " -b" : "tsc --noEmit"]))
    const root = tree({
      "package.json": JSON.stringify({ scripts }),
      "node_modules/.bin/tsc": "#!/bin/sh\\n",
      ...(installed ? { ["node_modules/.bin/" + compiler]: "#!/bin/sh\\n" } : {})
    })
    try {
      const found = findStockCompiler(root, root)
      assert.equal(found?.name ?? null, installed ? compiler : null)
    } finally { rmSync(root, { recursive: true, force: true }) }
  }), { seed: 420421, numRuns: 100 })
})

test("property: stock emission retries only an unsupported Go flag and preserves the compiler, other flags and exit diagnostics", async () => {
  const fc = require("fast-check")
  await fc.assert(fc.asyncProperty(fc.boolean(), fc.boolean(), async (supportsSingle, failsEmit) => {
    const root = tree({ "tsconfig.json": "{}", "compiler.cjs": [
      "#!/usr/bin/env node",
      'const fs=require("node:fs"),p=require("node:path"),args=process.argv.slice(2)',
      'fs.appendFileSync(p.join(__dirname,"trace.jsonl"),JSON.stringify(args)+"\\n")',
      'if (!' + supportsSingle + ' && args.includes("--singleThreaded")) { console.log(' + JSON.stringify('error TS5023: Unknown compiler option "--singleThreaded".') + ');process.exit(1) }',
      'const out=args[args.indexOf("--outDir")+1];fs.mkdirSync(out,{recursive:true});fs.writeFileSync(p.join(out,"value.d.ts"),"export declare const value: number;\\n")',
      'if (' + failsEmit + ') { console.log("error TS2322: retained stock error");process.exitCode=2 }'
    ].join("\n") })
    const compiler = join(root, "compiler.cjs"), log = join(root, "emit.log")
    chmodSync(compiler, 0o755)
    try {
      const result = await emitDeclarations({ compiler, tsconfig: "tsconfig.json", cwd: root, outDir: join(root, "out with spaces"), log, root })
      assert.equal(result.code, failsEmit ? 2 : 0)
      assert.equal(result.diagnostics.some(d => d.code === "TS2322"), failsEmit)
      const calls = readFileSync(join(root, "trace.jsonl"), "utf8").trim().split("\n").map(JSON.parse)
      assert.equal(calls.length, supportsSingle ? 1 : 2)
      if (!supportsSingle) {
        assert.deepEqual(calls[1], calls[0].filter(arg => arg !== "--singleThreaded"))
        assert.deepEqual(result.unsupportedOptions, ["--singleThreaded"])
        assert.match(readFileSync(result.optionProbeLog, "utf8"), /TS5023/)
      }
    } finally { rmSync(root, { recursive: true, force: true }) }
  }), { seed: 420422, numRuns: 20 })
})

test("an unsupported-option diagnostic never hides a compiler crash or triggers its retry", async () => {
  const root = tree({ "tsconfig.json": "{}", "compiler.cjs": [
    "#!/usr/bin/env node",
    'require("node:fs").appendFileSync(__dirname+"/calls","called\\n")',
    'console.log(' + JSON.stringify('error TS5023: Unknown compiler option "--singleThreaded".') + ')',
    'console.error("panic: compiler failure");process.exit(1)'
  ].join("\n") })
  const compiler = join(root, "compiler.cjs")
  chmodSync(compiler, 0o755)
  try {
    await assert.rejects(emitDeclarations({ compiler, tsconfig: "tsconfig.json", cwd: root, root, outDir: join(root, "out") }), /compiler did not finish.*\n.*panic/s)
    assert.equal(readFileSync(join(root, "calls"), "utf8"), "called\n")
  } finally { rmSync(root, { recursive: true, force: true }) }
})
