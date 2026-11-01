import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, posix } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { applyState, prepareState } from "../lib/codemod-state.mjs"
import { loadTypeScript } from "../lib/declarations.mjs"
import { candidates, draftPlan, validatePlan } from "../lib/plan.mjs"
import { makeConfig, paths, revert } from "../lib/steps.mjs"
import { nativeConfigScripts, restoreViteScripts, rewriteViteScripts, viteConfigSource } from "../lib/vite-config.mjs"
import { wireViteApps } from "../lib/wire.mjs"
import * as Jj from "../lib/jj.mjs"
import { must, readJson, writeJson } from "../lib/util.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const ts = loadTypeScript([fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))])
const corpus = readJson(new URL("./corpus/foldkit-plan-vite-config.json", import.meta.url))
const specsFor = () => ({ vibelang: "0.0.11", "vibelang-vite": "0.0.11" })
const write = (root, file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
const record = (path) => ({ path, effect: "values", test: false, imports: [], testedBy: [], coverage: null, lines: 1 })

test("foldkit-78: a wired Vite config is a candidate; other tool configs and unwired Vite configs are not", () => {
  const inventory = { files: [record(corpus.path), record("packages/website/vitest.config.ts"), record("packages/website/src/leaf.ts")] }
  assert.deepEqual(candidates(inventory).map(f => f.path), ["packages/website/src/leaf.ts"])
  assert.deepEqual(candidates(inventory, { nativeConfigs: [corpus.path] }).map(f => f.path), [corpus.path, "packages/website/src/leaf.ts"])
  assert.ok(draftPlan(inventory, undefined, { nativeConfigs: [corpus.path] }).batches.some(b => b.files.includes(corpus.path)))
  const plan = { batches: [{ files: [corpus.path], reason: "config" }] }
  assert.ok(validatePlan(plan, inventory).errors.some(e => e.includes(corpus.refusal)))
  assert.deepEqual(validatePlan(plan, inventory, undefined, { nativeConfigs: [corpus.path] }).errors, [])
  assert.ok(validatePlan({ batches: [{ files: ["packages/website/vitest.config.ts"], reason: "x" }] }, inventory, undefined, { nativeConfigs: [corpus.path] }).errors.some(e => e.includes("tool's config")))
})

// The website's wiring as setup leaves it, then the codemod renames the config.
async function fixture(t, { jj = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "migrate-vite-native-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  write(root, "package.json", JSON.stringify({ private: true, workspaces: ["packages/*"], scripts: { web: "cd packages/website && vite build", other: "cd packages/other && vite build" } }, null, 2) + "\n")
  write(root, "packages/website/package.json", JSON.stringify({ name: "website", private: true, scripts: {
    build: "vibelang && vite build", dev: "pnpm exec vite --host", preview: "vite preview",
    prod: "npx vite build --config=vite.prod.config.ts --configLoader=bundle", quoted: "vite build -c 'vite.prod.config.ts'",
    unrelated: "echo vite; node helper.mjs vite; vitest run"
  } }, null, 2) + "\n")
  write(root, "packages/other/package.json", JSON.stringify({ name: "other", scripts: { build: "vite build" } }, null, 2) + "\n")
  write(root, "packages/website/vite.config.ts", 'import { defineConfig } from "vite"\nimport { enabled } from "./src/leaf.ts"\nexport default defineConfig({ define: { enabled } })\n')
  write(root, "packages/website/vite.prod.config.ts", 'import { defineConfig } from "vite"\nimport { enabled } from "./src/leaf.ts"\nexport default defineConfig({})\n')
  write(root, "packages/website/src/leaf.ts", "export const enabled = true\n")
  write(root, "packages/other/vite.config.ts", 'export default defineConfig({})\n')
  if (jj) {
    await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: root })
    await Jj.commit(root, "original")
  }
  const packages = [{ dir: "packages/website", sources: ["src"] }]
  const wired = wireViteApps({ root, packages, ts, specsFor })
  return { root, packages, wired }
}

test("foldkit-78: setup reports the configs it wired, and the codemod names the renamed config in every wired script", async t => {
  const { root, wired } = await fixture(t)
  assert.deepEqual(wired.nativeConfigs.sort(), ["packages/website/vite.config.ts", "packages/website/vite.prod.config.ts"])
  const state = prepareState(root, ["packages/website/vite.config.ts"], ["packages/website/vite.config.ts", "packages/website/src/leaf.ts"])
  applyState(root, state)
  const pkg = readJson(join(root, "packages/website/package.json"))
  assert.match(pkg.scripts.build, /^vibelang && NODE_OPTIONS=.* vite --config vite\.config\.vibe --configLoader native build$/)
  assert.match(pkg.scripts.dev, /pnpm exec vite --config vite\.config\.vibe --configLoader native --host$/)
  assert.match(pkg.scripts.preview, /vite --config vite\.config\.vibe --configLoader native preview$/)
  assert.match(pkg.scripts.prod, /--config=vite\.prod\.config\.ts/, "another config's script is untouched")
  assert.equal(pkg.scripts.unrelated, "echo vite; node helper.mjs vite; vitest run")
  const rootPkg = readJson(join(root, "package.json"))
  assert.match(rootPkg.scripts.web, /^cd packages\/website && NODE_OPTIONS=.* vite --config vite\.config\.vibe --configLoader native build$/)
  assert.equal(rootPkg.scripts.other, "cd packages/other && vite build")
  assert.equal(existsSync(join(root, "packages/website/vite.config.vibe")), true)
  assert.deepEqual(state.scriptEdits.map(e => [e.manifest, e.script, e.module]).sort(), [
    ["package.json", "web", "packages/website/vite.config.vibe"],
    ["packages/website/package.json", "build", "packages/website/vite.config.vibe"],
    ["packages/website/package.json", "dev", "packages/website/vite.config.vibe"],
    ["packages/website/package.json", "preview", "packages/website/vite.config.vibe"]
  ])
  assert.equal(state.writes.filter(w => w.file === "packages/website/package.json").length, 1, "one pending write per manifest")
  // Replaying the same state is a no-op, as after an interruption.
  applyState(root, state)
  assert.deepEqual(readJson(join(root, "packages/website/package.json")), pkg)
})

test("foldkit-78: a written --config follows the rename in its own spelling", async t => {
  const { root } = await fixture(t)
  const edits = rewriteViteScripts(root, [{ from: "packages/website/vite.prod.config.ts", to: "packages/website/vite.prod.config.vibe" }])
  const pkg = readJson(join(root, "packages/website/package.json"))
  const preload = 'NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--import=vibelang/register" '
  assert.equal(pkg.scripts.prod, preload + "npx vite build --config=vite.prod.config.vibe --configLoader native")
  assert.equal(pkg.scripts.quoted, preload + "vite --configLoader native build -c 'vite.prod.config.vibe'")
  assert.doesNotMatch(pkg.scripts.build, /vite\.prod/)
  assert.deepEqual(edits.map(e => e.script).sort(), ["prod", "quoted"])
  restoreViteScripts(root, edits, "packages/website/vite.prod.config.ts")
  assert.match(readJson(join(root, "packages/website/package.json")).scripts.prod, /--config=vite\.prod\.config\.ts --configLoader native$/)
})

test("foldkit-78: step revert restores the scripts with the config, in a real jj target", async t => {
  const { root } = await fixture(t, { jj: true })
  await Jj.commit(root, "setup")
  const before = { website: readFileSync(join(root, "packages/website/package.json"), "utf8"), root: readFileSync(join(root, "package.json"), "utf8") }
  const run = join(root, "..", posix.basename(root) + "-run")
  t.after(() => rmSync(run, { recursive: true, force: true }))
  writeJson(paths(run).config, makeConfig({ target: root, packages: ["packages/website"], test: "true", vibelangVersion: "0.0.11" }))
  writeJson(paths(run).plan, { batches: [{ files: ["packages/website/vite.config.ts"] }] })
  const state = prepareState(root, ["packages/website/vite.config.ts"], ["packages/website/vite.config.ts", "packages/website/src/leaf.ts"])
  applyState(root, state)
  writeJson(paths(run).codemod("01"), { files: state.files, renames: state.renames, exportEdits: state.exportEdits, importEdits: state.importEdits, scriptEdits: state.scriptEdits })
  assert.match(readJson(join(root, "packages/website/package.json")).scripts.build, /vite\.config\.vibe/)
  const result = await revert({ run, batch: "01", file: "packages/website/vite.config.vibe", reason: "foldkit-78 test" })
  assert.equal(result.scriptEdits.length, 4)
  assert.equal(readFileSync(join(root, "packages/website/package.json"), "utf8"), before.website)
  assert.equal(readFileSync(join(root, "package.json"), "utf8"), before.root)
  assert.equal(existsSync(join(root, "packages/website/vite.config.ts")), true)
  assert.equal(existsSync(join(root, "packages/website/vite.config.vibe")), false)
})

// Script and config name forms: every Vite call that loads the renamed config
// names its .vibe file afterwards, nothing else changes, and restore inverts it.
test("foldkit-78: Vite invocations of a renamed config name the .vibe file, and restore inverts that, over script forms", () => {
  const name = fc.constantFrom("vite.config", "vite.prod.config", "vite.dev-site.config")
  const ext = fc.constantFrom(".ts", ".mts")
  const launcher = fc.constantFrom("", "pnpm exec ", "npx ", "bunx ", "bun x ")
  const env = fc.constantFrom("", "NODE_OPTIONS=\"--import=vibelang/register\" ", "FOO=1 ")
  const mode = fc.constantFrom("", "build", "preview", "--host")
  const named = fc.constantFrom("discover", "--config ", "--config=", "-c ", "-c='", "--config \"")
  const chain = fc.constantFrom("", "vibelang && ", "cd packages/web && ")
  const other = fc.constantFrom("", " && echo done", "; vitest run")
  fc.assert(fc.property(name, ext, launcher, env, mode, named, chain, other, fc.boolean(), (stem, extension, launch, assigned, arg, form, prefix, suffix, renamedOne) => {
    const dir = prefix.startsWith("cd ") ? "." : "packages/web"
    const cwd = "packages/web"
    const from = cwd + "/" + stem + extension, to = cwd + "/" + stem + ".vibe"
    const discovered = form === "discover"
    if (discovered && stem !== "vite.config") return // only vite.config.* is found by name
    const close = form.endsWith("'") ? "'" : form.endsWith('"') ? '"' : ""
    const target = stem + extension
    const script = prefix + assigned + launch + "vite" + (arg ? " " + arg : "") + (discovered ? "" : " " + form + target + close) + suffix
    const renames = renamedOne ? [{ from, to }] : [{ from: cwd + "/unrelated.config" + extension, to: cwd + "/unrelated.config.vibe" }]
    const root = mkdtempSync(join(tmpdir(), "migrate-vite-prop-"))
    try {
      write(root, from, "export default {}\n")
      const { scripts, edits } = nativeConfigScripts({ s: script }, { root, dir, renames })
      if (!renamedOne) { assert.equal(scripts.s, script); assert.deepEqual(edits, []); return }
      assert.equal(edits.length, 1)
      assert.equal(edits[0].module, to)
      const expected = discovered
        ? prefix + assigned + launch + "vite --config " + stem + ".vibe" + (arg ? " " + arg : "") + suffix
        : prefix + assigned + launch + "vite" + (arg ? " " + arg : "") + " " + form + stem + ".vibe" + close + suffix
      assert.equal(scripts.s, expected)
      assert.equal(nativeConfigScripts(scripts, { root, dir, renames }).scripts.s, expected, "a rewritten script is stable")
      write(root, "pkg/package.json", JSON.stringify({ scripts }) + "\n")
      restoreViteScripts(root, edits.map(e => ({ manifest: "pkg/package.json", ...e })), from)
      assert.equal(readJson(join(root, "pkg/package.json")).scripts.s, script)
    } finally { rmSync(root, { recursive: true, force: true }) }
  }), { seed: 190078, numRuns: 300 })
  fc.assert(fc.property(fc.stringMatching(/^[a-z][a-z0-9-]{0,8}$/), fc.constantFrom(".ts", ".mts", ".js", ".mjs", ".cts", ".d.ts"), fc.boolean(), (part, extension, vite) => {
    const base = (vite ? "vite" : "vitest") + (part ? "." + part : "") + ".config" + extension
    assert.equal(viteConfigSource.test(base), vite && (extension === ".ts" || extension === ".mts"))
  }), { seed: 190079, numRuns: 100 })
})
