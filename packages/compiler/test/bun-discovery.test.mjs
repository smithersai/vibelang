// opencode-35: the vibelang/bun preload's discovery hook matched every
// specifier, so each runtime resolution (Bun.resolveSync, import.meta.resolve,
// require.resolve, a dynamic import or require: Bun 1.4.4 calls a plugin's
// onResolve for each) ran a JavaScript callback. opencode's TUI plugin test
// resolved effect/package.json about four million times: 34 s instead of 1 s.
import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import fc from "fast-check"
import { pathSpecifier } from "../relative-imports.mjs"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const compilerPackage = fileURLToPath(new URL("../", import.meta.url))
const native = process.env.VIBELANG_BINARY || join(repo, "typescript/built/local/tsc")
const effect = join(process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules"), "effect")
const runtime = join(repo, "packages/runtime")
const hasBun = spawnSync("bun", ["--version"]).status === 0
const missing = [native, effect, join(runtime, "dist/index.js")].find((path) => !existsSync(path))
const skip = !hasBun ? "bun is not on PATH" : missing !== undefined && `run typescript/vibelang/smoke.sh first; missing ${missing}`

const relative = fc.tuple(fc.constantFrom("./", "../", "../../"), fc.stringMatching(/^[a-z][a-z0-9._-]{0,8}$/)).map(([p, n]) => p + n)
const absolute = fc.oneof(fc.stringMatching(/^\/[a-z][a-z0-9/._-]{0,12}$/), fc.tuple(fc.constantFrom("C:", "d:"), fc.constantFrom("\\", "/"), fc.stringMatching(/^[a-z]{1,6}$/)).map((parts) => parts.join("")))
const bare = fc.oneof(
  fc.stringMatching(/^[a-z][a-z0-9-]{0,8}(?:\/[a-z0-9.-]{1,8}){0,2}$/),
  fc.stringMatching(/^@[a-z][a-z0-9-]{0,6}\/[a-z][a-z0-9-]{0,6}(?:\/[a-z0-9.-]{1,8})?$/),
  fc.constantFrom("effect/package.json", "node:fs", "bun:test", "#internal", ".hidden", "..hidden", "@/alias")
)

test("pathSpecifier names relative and absolute specifiers and no bare one", () => {
  for (const specifier of [".", "..", "./a", "../a/b", ".\\a", "/abs", "C:\\x", "c:/x"]) assert.ok(pathSpecifier.test(specifier), specifier)
  for (const specifier of ["effect", "effect/package.json", "@opencode/plugin/effect", "node:fs", "bun:test", "#x", ".hidden", "@/x"]) assert.ok(!pathSpecifier.test(specifier), specifier)
})

test("path-specifier: generated relative and absolute specifiers match, bare ones do not", () => {
  fc.assert(fc.property(fc.oneof(relative.map((s) => [s, true]), absolute.map((s) => [s, true]), bare.map((s) => [s, false])), ([specifier, path]) => {
    assert.equal(pathSpecifier.test(specifier), path, specifier)
  }), { seed: 37037, numRuns: 500 })
})

function project(t, files) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-bun-discovery-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, "node_modules/fakepkg"), { recursive: true })
  writeFileSync(join(root, "node_modules/fakepkg/package.json"), '{"name":"fakepkg","version":"1.0.0"}')
  symlinkSync(realpathSync(effect), join(root, "node_modules/effect"))
  symlinkSync(runtime, join(root, "node_modules/vibelang-runtime"))
  symlinkSync(compilerPackage, join(root, "node_modules/vibelang"))
  const tsconfig = { compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, types: [], skipLibCheck: true, allowImportingTsExtensions: true, rewriteRelativeImportExtensions: true, noEmit: true }, include: ["src/**/*"] }
  for (const [path, text] of Object.entries({ "package.json": '{"type":"module"}', "tsconfig.json": JSON.stringify(tsconfig), ...files })) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  return (entry) => spawnSync("bun", ["--preload", "vibelang/bun", entry], {
    cwd: root, encoding: "utf8", env: { ...process.env, VIBELANG_BINARY: native, VIBELANG_PROJECT: "", VIBELANG_CACHE_DIR: join(root, ".cache"), VIBELANG_BUN_DEBUG: "1" }
  })
}

test("opencode-35: bare runtime resolutions do not reach the preload's discovery, and a computed path still does", { skip }, (t) => {
  const run = project(t, {
    "src/loop.ts": 'for (let i = 0; i < 2000; i++) { Bun.resolveSync("fakepkg/package.json", import.meta.dir); import.meta.resolve("fakepkg/package.json") }\nconsole.log("resolved")\n',
    "src/x.vibe": 'export const value: string = "from-vibe"\n',
    "src/helper.ts": 'export { value } from "./x"\n',
    "src/dynamic.ts": 'const name = ["help", "er"].join("")\nconst { value } = await import(`./${name}.ts`)\nconsole.log(value)\n'
  })
  const loop = run("src/loop.ts")
  assert.equal(loop.stdout.trim(), "resolved", loop.stderr)
  const count = Number(/vibelang\/bun: (\d+) resolutions? reached discovery/.exec(loop.stderr)?.[1])
  assert.ok(count < 20, `${count} resolutions reached discovery\n${loop.stderr}`)
  // A module imported by a computed path is discovered, so its extensionless import of x.vibe still loads.
  const dynamic = run("src/dynamic.ts")
  assert.equal(dynamic.stdout.trim(), "from-vibe", dynamic.stderr)
})
