import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { emitMigratedJs } from "../lib/steps.mjs"
import { declarationRouteLeaks } from "../lib/route-declarations.mjs"

// docs/user/src/setup/developer-tools.md, emitted routes: no route reaches a
// published package. The record flow's emit refuses a package's routes when
// its compiled declarations still name one.
const repo = fileURLToPath(new URL("../../../../", import.meta.url))
const require = createRequire(join(repo, "packages/runtime/package.json"))
const compiler = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const put = (root, file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
const packages = [{ dir: ".", tsconfig: "tsconfig.json", sources: ["src"] }]
const index = 'export * from "./user.vibe"\n'

test("declarationRouteLeaks names each declaration file that keeps a route", t => {
  const root = mkdtempSync(join(tmpdir(), "route-declarations-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  put(root, "a/index.d.ts", 'export * from "#vibelang/emitted/src/user";\n')
  put(root, "a/clean.d.ts", 'export * from "./user.js";\n')
  put(root, "b/index.js", 'export * from "#vibelang/emitted/src/user";\n')
  put(root, "c/types.d.mts", 'export type U = typeof import("#vibelang/emitted/src/user");\n')
  assert.deepEqual(declarationRouteLeaks(root), ["a/index.d.ts", "c/types.d.mts"])
  assert.deepEqual(declarationRouteLeaks(join(root, "missing")), [])
})

// A published package (no "private") whose TypeScript entry re-exports a
// .vibe module, which the native emit routes.
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "route-declarations-emit-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  put(root, "package.json", JSON.stringify({ name: "route-declarations-fixture", version: "1.0.0", type: "module", exports: { ".": "./src/index.ts" } }))
  put(root, "tsconfig.json", JSON.stringify({ compilerOptions: {
    target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, declaration: true,
    noEmit: true, rewriteRelativeImportExtensions: true, allowArbitraryExtensions: true, skipLibCheck: true, types: []
  }, include: ["src/**/*.ts", "src/**/*.vibe"] }))
  put(root, "src/index.ts", index)
  put(root, "src/user.vibe", "export const value: number = 42\n")
  mkdirSync(join(root, "node_modules/.bin"), { recursive: true })
  for (const [name, source] of [
    ["typescript", dirname(require.resolve("typescript/package.json"))],
    ["effect", dirname(require.resolve("effect/package.json"))],
    ["vibelang", join(repo, "packages/compiler")],
    ["vibelang-runtime", join(repo, "packages/runtime")]
  ]) symlinkSync(source, join(root, "node_modules", name))
  symlinkSync(compiler, join(root, "node_modules/.bin/vibelang"))
  return root
}

test("a published package keeps a route that its declarations do not name", async t => {
  const root = fixture(t)
  const receipts = await emitMigratedJs({ target: root, toolchain: { kind: "installed" }, packages }, root, join(root, ".logs"))
  assert.ok(!receipts.some(item => item.refusedRoutes), JSON.stringify(receipts))
  assert.match(readFileSync(join(root, "src/index.ts"), "utf8"), /"#vibelang\/emitted\/src\/user"/)
  assert.deepEqual(declarationRouteLeaks(join(root, ".logs", "route-declarations", "root")), [])
})

test("a published package whose declarations name a route gets its routes restored", async t => {
  const root = fixture(t)
  const leaking = async (pkg, outDir) => put(outDir, "index.d.ts", 'export * from "#vibelang/emitted/src/user";\n')
  const receipts = await emitMigratedJs({ target: root, toolchain: { kind: "installed" }, packages }, root, join(root, ".logs"), { routeDeclarations: leaking })
  const refusal = receipts.find(item => item.refusedRoutes)
  assert.ok(refusal, JSON.stringify(receipts))
  assert.deepEqual(refusal.refusedRoutes, { declarations: ["index.d.ts"], modules: ["src/user.vibe"] })
  assert.match(refusal.warnings[0], /routes reach published declarations/)
  assert.equal(readFileSync(join(root, "src/index.ts"), "utf8"), index)
  assert.equal(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).imports, undefined)
})

test("a repeated emit names modules refused through pre-existing routes", async t => {
  const root = fixture(t)
  const config = { target: root, toolchain: { kind: "installed" }, packages }
  const clean = async (pkg, outDir) => put(outDir, "index.d.ts", 'export * from "./user.js";\n')
  const first = await emitMigratedJs(config, root, join(root, ".first-logs"), { routeDeclarations: clean })
  assert.ok(!first.some(item => item.refusedRoutes), JSON.stringify(first))
  assert.match(readFileSync(join(root, "src/index.ts"), "utf8"), /"#vibelang\/emitted\/src\/user"/)
  const leaking = async (pkg, outDir) => put(outDir, "index.d.ts", 'export * from "#vibelang/emitted/src/user";\n')
  const second = await emitMigratedJs(config, root, join(root, ".second-logs"), { routeDeclarations: leaking })
  const refusal = second.find(item => item.refusedRoutes)
  assert.ok(refusal, JSON.stringify(second))
  assert.deepEqual(refusal.refusedRoutes, { declarations: ["index.d.ts"], modules: ["src/user.vibe"] })
  assert.equal(readFileSync(join(root, "src/index.ts"), "utf8"), index)
  assert.equal(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).imports, undefined)
})
