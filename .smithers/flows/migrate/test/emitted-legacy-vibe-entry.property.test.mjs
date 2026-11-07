// A converted module's export entry from an earlier toolchain,
// { types: its sidecar, default: "./src/x.vibe" }, survived wiring and
// emission: routeEmittedExports routes only native targets, so a bare
// `bun build` in an unchanged test read the .vibe as an asset and found no
// export (opencode @opencode/plugin "./effect/plugin", the sdk import-boundary
// test). With the module's emitted JavaScript the entry now takes the current
// layout, { types, "vibelang-source", default: emitted }. A bare .vibe string
// (Smithers' export contracts) and an entry without emitted output stay.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { routeEmittedExports } from "../lib/emitted-exports.mjs"

const repo = fileURLToPath(new URL("../../../../", import.meta.url))
const fc = createRequire(join(repo, "packages/runtime/package.json"))("fast-check")
const rule = "Type checkers use `.d.vibe.ts`; linters, Knip, bundlers and test runners read `.vibe`."
const write = (root, file, text) => { const path = join(root, file); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text) }
const bun = () => spawnSync("bun", ["--version"], { encoding: "utf8" }).status === 0

test("the entry oracle quotes Chapter 7", () => assert.ok(readFileSync(join(repo, "docs/design/src/007-tooling.md"), "utf8").includes(rule)))

// One package: a converted module, its sidecar and its emitted JavaScript.
function packageWith(root, { stem = "src/effect/plugin", extension = "vibe", relocated = true, emitted = true, nest = false, key = "./effect/plugin", extra = {} } = {}) {
  const source = `./${stem}.${extension}`
  const types = relocated ? `./.vibe/declarations/${stem}.d.${extension}.ts` : `./${stem}.d.${extension}.ts`
  const output = `./.vibelang/js/${stem}.${extension === "vibex" ? "jsx" : "js"}`
  const legacy = { types, default: source }
  const exports = { [key]: nest ? { import: legacy } : legacy, ...extra }
  write(root, "package.json", JSON.stringify({ name: "@acme/plugin", type: "module", exports }, null, 2))
  write(root, source, "export function define(plugin: unknown) { return plugin }\n")
  write(root, types, "export declare function define(plugin: unknown): unknown;\n")
  if (emitted) write(root, output, "export function define(plugin) { return plugin }\n")
  return { source, types, output, outputs: emitted ? { [source]: output } : {}, legacy }
}

test("opencode: the legacy plugin entry takes the current layout and a bare bun build reads the JavaScript", { skip: !bun() && "needs bun" }, () => {
  const root = mkdtempSync(join(tmpdir(), "legacy-vibe-entry-"))
  try {
    const pkg = join(root, "plugin")
    const { source, types, output, outputs } = packageWith(pkg)
    assert.equal(routeEmittedExports(pkg, outputs), true)
    assert.deepEqual(JSON.parse(readFileSync(join(pkg, "package.json"), "utf8")).exports["./effect/plugin"], { types, "vibelang-source": source, default: output })
    mkdirSync(join(root, "app/node_modules/@acme"), { recursive: true })
    symlinkSync(pkg, join(root, "app/node_modules/@acme/plugin"))
    write(root, "app/entry.ts", 'import { define } from "@acme/plugin/effect/plugin"\nconsole.log(typeof define)\n')
    const build = spawnSync("bun", ["build", join(root, "app/entry.ts"), "--target=node", "--outdir", join(root, "app/out")], { cwd: join(root, "app"), encoding: "utf8" })
    assert.equal(build.status, 0, build.stdout + build.stderr)
    const run = spawnSync("node", [join(root, "app/out/entry.js")], { encoding: "utf8" })
    assert.equal(run.stdout.trim(), "function", run.stderr)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("a bare .vibe string entry and an entry without emitted output stay as written", () => {
  const root = mkdtempSync(join(tmpdir(), "legacy-vibe-entry-"))
  try {
    const { legacy } = packageWith(root, { emitted: false, extra: { "./Route": "./src/Route.vibe" } })
    assert.equal(routeEmittedExports(root, {}), false)
    const exports = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).exports
    assert.deepEqual(exports["./effect/plugin"], legacy)
    assert.equal(exports["./Route"], "./src/Route.vibe")
  } finally { rmSync(root, { recursive: true, force: true }) }
})

// Neighbourhood: a .vibe or .vibex module beside its sidecar or under a
// relocated sidecar directory, at the top of an export or nested under a
// condition, with or without its emitted JavaScript. The entry takes the
// current layout exactly when the output exists, a second pass changes
// nothing, and a native export beside it keeps its shape.
test("property: a legacy entry takes the current layout exactly when its JavaScript exists", () => {
  fc.assert(fc.property(fc.constantFrom("vibe", "vibex"), fc.boolean(), fc.boolean(), fc.boolean(), fc.constantFrom("src/plugin", "src/deep/a..b", "lib/ü"), (extension, relocated, emitted, nest, stem) => {
    const root = mkdtempSync(join(tmpdir(), "legacy-vibe-entry-"))
    try {
      const { source, types, output, outputs, legacy } = packageWith(root, { stem, extension, relocated, emitted, nest, key: "./entry", extra: { "./native": "./src/native.js" } })
      routeEmittedExports(root, outputs)
      const exports = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).exports
      const current = emitted ? { types, "vibelang-source": source, default: output } : legacy
      assert.deepEqual(exports["./entry"], nest ? { import: current } : current)
      assert.equal(exports["./native"], "./src/native.js")
      const once = readFileSync(join(root, "package.json"), "utf8")
      assert.equal(routeEmittedExports(root, outputs), false)
      assert.equal(readFileSync(join(root, "package.json"), "utf8"), once)
    } finally { rmSync(root, { recursive: true, force: true }) }
  }), { numRuns: 40 })
})
