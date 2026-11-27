import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { createShimmedProject, runTsc, skipReason } from "./_helpers.mjs"

test("tsc --version and -v print the VibeLang TypeScript 7.1 banner across all three bin entrypoints", { skip: skipReason }, (t) => {
  const root = createShimmedProject(t, { "src/a.ts": "export const x = 1\n" })
  for (const bin of ["node_modules/.bin/tsc", "node_modules/typescript/lib/tsc", "node_modules/typescript/tsc"]) {
    for (const flag of ["--version", "-v"]) {
      const res = runTsc(root, [flag], bin)
      assert.equal(res.status, 0, `${bin} ${flag}: ${res.stderr}`)
      assert.match(res.stdout, /^VibeLang \d+\.\d+\.\d+ \(TypeScript 7\.1/)
    }
  }
})

test("tsc --showConfig resolves the effective project configuration as valid JSON", { skip: skipReason }, (t) => {
  const root = createShimmedProject(t, { "src/a.ts": "export const a: number = 1\n" })
  const res = runTsc(root, ["--showConfig"])
  assert.equal(res.status, 0, res.stdout + res.stderr)
  const config = JSON.parse(res.stdout)
  assert.equal(config.compilerOptions.strict, true)
  assert.equal(config.compilerOptions.declaration, true)
})

test("tsc --noEmit checks mixed files without writing dist artifacts", { skip: skipReason }, (t) => {
  const root = createShimmedProject(t, {
    "src/v.vibe": "export effect function ping() { return 'pong' }\n",
    "src/t.ts": 'import { ping } from "./v.vibe"\nexport const call = () => ping()\n',
  }, {
    compilerOptions: { allowImportingTsExtensions: true, noEmit: true },
  })
  const res = runTsc(root, ["--noEmit"])
  assert.equal(res.status, 0, res.stdout + res.stderr)
  assert.equal(existsSync(join(root, "out")), false)
})

test("tsc --declaration --emitDeclarationOnly writes .d.ts without .js", { skip: skipReason }, (t) => {
  const root = createShimmedProject(t, {
    "src/api.ts": "// @vibe\nexport error Missing { key: string }\nexport effect function lookup(key: string) {\n  if (!key) throw new Missing({ key })\n  return key.length\n}\n",
  })
  const res = runTsc(root, ["--emitDeclarationOnly"])
  assert.equal(res.status, 0, res.stdout + res.stderr)
  assert.equal(existsSync(join(root, "out/api.d.ts")), true)
  assert.equal(existsSync(join(root, "out/api.js")), false)
  const dts = readFileSync(join(root, "out/api.d.ts"), "utf8")
  assert.match(dts, /Missing/)
  assert.match(dts, /lookup/)
})

test("tsc --sourceMap emits inlineable source maps referencing original sources", { skip: skipReason }, (t) => {
  const root = createShimmedProject(t, {
    "src/math.ts": "// @vibe\nexport effect function double(n: number) { return n * 2 }\n",
  })
  const res = runTsc(root, ["--sourceMap"])
  assert.equal(res.status, 0, res.stdout + res.stderr)
  assert.equal(existsSync(join(root, "out/math.js.map")), true)
  const map = JSON.parse(readFileSync(join(root, "out/math.js.map"), "utf8"))
  assert.ok(map.sources.some((s) => s.endsWith("math.ts")), `expected math.ts in sources: ${JSON.stringify(map.sources)}`)
})

test("tsc -b builds composite project references with both plain .ts and // @vibe .ts projects", { skip: skipReason }, (t) => {
  const root = createShimmedProject(t, {
    "tsconfig.json": JSON.stringify({
      files: [],
      references: [{ path: "./packages/core" }, { path: "./packages/app" }],
    }),
    "packages/core/tsconfig.json": JSON.stringify({
      compilerOptions: {
        composite: true,
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        types: [],
        skipLibCheck: true,
        rootDir: "src",
        outDir: "dist",
      },
      include: ["src"],
    }),
    "packages/core/src/core.ts": "// @vibe\nexport effect function greeting(who: string) { return `hi ${who}` }\n",
    "packages/app/tsconfig.json": JSON.stringify({
      compilerOptions: {
        composite: true,
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        types: [],
        skipLibCheck: true,
        rootDir: "src",
        outDir: "dist",
      },
      references: [{ path: "../core" }],
      include: ["src"],
    }),
    "packages/app/src/index.ts": 'import { Effect } from "effect"\nimport { greeting } from "../../core/dist/core.js"\nexport const run = () => Effect.runPromise(greeting("build"))\n',
  })
  const res = runTsc(root, ["-b"])
  assert.equal(res.status, 0, res.stdout + res.stderr)
  assert.equal(existsSync(join(root, "packages/core/dist/core.js")), true)
  assert.equal(existsSync(join(root, "packages/core/dist/core.d.ts")), true)
  assert.equal(existsSync(join(root, "packages/app/dist/index.js")), true)
})
