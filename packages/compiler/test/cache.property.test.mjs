import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { setTimeout as sleep } from "node:timers/promises"
import { fileURLToPath } from "node:url"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { compileProjectSync, projects } from "../project.mjs"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const compiler = process.env.VIBELANG_BINARY || join(repo, "typescript/built/local/tsc")
const effect = join(process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules"), "effect")
const rule = "docs/design/history/src/428-part4-ch28-tooling.md: Packages and versions (D299), Building and testing (D297)"
const regressions = new URL("./property-regressions/", import.meta.url)
const action = fc.record({
  kind: fc.constantFrom("source", "same-stamp", "create", "delete", "rename", "config", "workspace-config", "package", "dependency", "compiler"),
  slot: fc.integer({ min: 0, max: 2 }), value: fc.integer({ min: 0, max: 9 })
})
const history = fc.record({ width: fc.integer({ min: 1, max: 3 }), actions: fc.array(action, { minLength: 1, maxLength: 2 }) })
let diagnostics = ""

// Construct the read graph from test data, independently of cache.mjs's scan/invalidation predicates.
function revisions(input) {
  const parts = new Map(Array.from({ length: input.width }, (_, i) => [`n${i}`, i]))
  let strict = false, ownStrict = false, selected = 0, dependency = 1, binary = 0
  const snapshot = () => {
    const names = [...parts.keys()].sort()
    const files = {
      "app/package.json": '{"type":"module"}',
      "app/tsconfig.json": JSON.stringify({ extends: "../base.json", include: ["src/**/*"] }),
      "base.json": JSON.stringify({ compilerOptions: {
        target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true,
        types: [], skipLibCheck: true, noEmit: true, noUnusedLocals: strict,
        allowImportingTsExtensions: true, rewriteRelativeImportExtensions: true
      } }),
      "dep/package.json": JSON.stringify({ name: "@property/dep", type: "module", exports: `./src/${selected}.vibe` }),
      "dep/tsconfig.json": JSON.stringify({ extends: "../base.json", compilerOptions: { noUnusedLocals: ownStrict }, include: ["src/**/*"] }),
      "dep/src/0.vibe": `export const depValue: number = ${dependency}\n`,
      "dep/src/1.vibe": `export const depValue: number = ${dependency + 10}\n`,
      "app/src/main.vibe": [
        'import { depValue } from "@property/dep"',
        ...names.map((name, i) => `import { part as p${i} } from "./${name}.vibe"`),
        `export function total(): number { const spare = 0; return ${names.map((_, i) => `p${i}`).concat("depValue").join(" + ")} }`, ""
      ].join("\n"),
      "app/main.ts": 'import { total } from "./src/main.vibe"\nconsole.log(JSON.stringify(total()))\n'
    }
    for (const [name, value] of parts) files[`app/src/${name}.vibe`] = `export const part: number = ${value}\n`
    return { files, strict, binary, expected: [...parts.values()].reduce((a, b) => a + b, dependency + selected * 10) }
  }
  const result = [{ ...snapshot() }]
  for (const edit of input.actions) {
    const name = [...parts.keys()].sort()[edit.slot % Math.max(parts.size, 1)] ?? "n0"
    switch (edit.kind) {
      case "source": case "same-stamp": parts.set(name, edit.value); break
      case "create": parts.set(`x${edit.slot}`, edit.value); break
      case "delete": parts.delete(name); break
      case "rename": { const value = parts.get(name) ?? edit.value; parts.delete(name); parts.set(`r${edit.slot}`, value); break }
      case "config": strict = edit.value % 2 === 1; break
      case "workspace-config": ownStrict = edit.value % 2 === 1; break
      case "package": selected = edit.value % 2; break
      case "dependency": dependency = edit.value; break
      case "compiler": binary = edit.value; break
    }
    result.push({ ...snapshot(), edit })
  }
  return result
}

function write(root, files) {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), text)
  }
}

function fixture() {
  for (const path of [compiler, effect, join(repo, "packages/runtime/dist/index.js")]) {
    assert.ok(existsSync(path), `property setup: missing ${path}; build compiler/runtime and install Effect first`)
  }
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-property-")))
  for (const pkg of ["app", "dep"]) {
    const modules = join(root, pkg, "node_modules")
    mkdirSync(modules, { recursive: true })
    symlinkSync(realpathSync(effect), join(modules, "effect"))
    symlinkSync(join(repo, "packages/runtime"), join(modules, "vibelang-runtime"))
  }
  mkdirSync(join(root, "app/node_modules/@property"))
  symlinkSync(join(root, "dep"), join(root, "app/node_modules/@property/dep"))
  return root
}

// The wrapper's optional file barrier pauses *after* the compiler read its inputs, before cache save.
function wrapper(root, revision) {
  return `import { appendFileSync, existsSync, unlinkSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { setTimeout as sleep } from "node:timers/promises"
appendFileSync(${JSON.stringify(join(root, "calls"))}, "compile\\n")
const run = spawnSync(${JSON.stringify(compiler)}, process.argv.slice(2), { stdio: "inherit", timeout: 30000 })
if (existsSync(${JSON.stringify(join(root, "arm"))})) {
  unlinkSync(${JSON.stringify(join(root, "arm"))})
  writeFileSync(${JSON.stringify(join(root, "ready"))}, "ready")
  const deadline = Date.now() + 10000
  while (!existsSync(${JSON.stringify(join(root, "release"))})) {
    if (Date.now() > deadline) throw new Error("cache-save: release barrier timed out")
    await sleep(5)
  }
}
process.exit(run.status ?? 1)
// compiler revision ${revision}
`
}

const calls = root => existsSync(join(root, "calls")) ? readFileSync(join(root, "calls"), "utf8").trim().split("\n").length : 0
const diagnosticCodes = text => [...text.matchAll(/(?:error|warning) ((?:TS|EK)\d+):/g)].map(m => m[1]).sort()
const artifacts = input => Object.fromEntries(revisions(input).flatMap((revision, i) =>
  Object.entries(revision.files).map(([file, text]) => [`revision-${i}/${file}`, text])))

async function checkHistory(input, loaders = false) {
  const root = fixture()
  diagnostics = ""
  try {
    const app = join(root, "app"), project = join(app, "tsconfig.json"), source = join(app, "src/main.vibe")
    const binary = join(root, "compiler.mjs"), directory = join(root, "cache")
    let previous = { files: {}, binary: undefined }
    const trace = line => { diagnostics = (diagnostics + line + "\n").slice(-12000) }
    const options = { root: app, project, compiler: binary, cache: { directory }, debug: trace }
    const modules = projects(options)
    for (const [stage, revision] of revisions(input).entries()) {
      trace(`cache-fresh revision ${stage}: ${JSON.stringify(revision.edit ?? "initial")}`)
      for (const file of Object.keys(previous.files)) if (!(file in revision.files)) rmSync(join(root, file))
      for (const [file, text] of Object.entries(revision.files)) {
        if (previous.files[file] === text) continue
        const path = join(root, file)
        const stamp = revision.edit?.kind === "same-stamp" && existsSync(path) ? statSync(path) : undefined
        write(root, { [file]: text })
        if (stamp) utimesSync(path, stamp.atime, stamp.mtime)
      }
      if (revision.binary !== previous.binary) writeFileSync(binary, wrapper(root, revision.binary))
      await sleep(120) // Existing cache timestamp safety window; concurrency itself uses barriers below.
      modules.invalidate()
      const beforeLoad = calls(root)
      const [loaded, concurrent] = await Promise.all([modules.load(source), modules.load(source)])
      if (previous.files["dep/tsconfig.json"] !== revision.files["dep/tsconfig.json"]) {
        assert.ok(calls(root) > beforeLoad, "D297/D299: changed workspace package settings require a new compile")
      }
      assert.deepEqual(loaded.code, concurrent.code)
      assert.deepEqual(loaded.errors, concurrent.errors)
      const beforeWarm = calls(root)
      const warm = compileProjectSync(options)
      if (!loaded.errors.length) assert.equal(calls(root), beforeWarm, "settled successful revisions must actually reuse the cache")
      const fresh = compileProjectSync({ ...options, cache: false })
      assert.deepEqual([...warm.outputs], [...fresh.outputs], `revision ${stage}: outputs and maps`)
      for (const key of ["errors", "warnings", "inputs"]) assert.deepEqual(warm[key], fresh[key], `revision ${stage}: ${key}`)
      assert.deepEqual(loaded.errors, fresh.errors)
      assert.deepEqual(loaded.warnings, fresh.warnings)
      assert.deepEqual(loaded.inputs, fresh.inputs)
      if (revision.strict) assert.ok(fresh.errors.some(e => e.code === "TS6133"))
      else assert.deepEqual(fresh.errors, [])
      if (!fresh.errors.length) {
        assert.equal(loaded.code, fresh.outputs.get(source).code)
        assert.deepEqual(loaded.map, fresh.outputs.get(source).map)
      }
      if (loaders) for (const engine of ["node", "bun"]) {
        const args = engine === "node" ? ["--import", join(repo, "packages/compiler/register.mjs"), "main.ts"] :
          ["--preload", join(repo, "packages/compiler/bun.mjs"), "main.ts"]
        const run = disabled => spawnSync(engine, args, {
          cwd: app, encoding: "utf8", timeout: 30000, maxBuffer: 1 << 20,
          env: { ...process.env, VIBELANG_BINARY: binary, VIBELANG_PROJECT: "", VIBELANG_CACHE_DIR: directory,
            VIBELANG_DISABLE_CACHE: disabled ? "1" : "", NO_COLOR: "1" }
        })
        const cached = run(false), disabled = run(true)
        trace(`${engine}: ${cached.stderr}\nfresh: ${disabled.stderr}`)
        assert.ifError(cached.error); assert.ifError(disabled.error)
        assert.equal(cached.status, disabled.status)
        assert.equal(cached.stdout, disabled.stdout)
        assert.deepEqual(diagnosticCodes(cached.stderr), diagnosticCodes(disabled.stderr))
        if (!revision.strict) { assert.equal(cached.status, 0, cached.stderr); assert.equal(JSON.parse(cached.stdout), revision.expected) }
        else assert.notEqual(cached.status, 0)
      }
      previous = revision
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
}

for (const [name, loaders, numRuns] of [["cache-fresh", false, 10], ["cache-loaders", true, 2]]) {
  test(name, async () => {
    // D299: reuse is valid only while every read input is unchanged; D297: each workspace package owns its settings.
    await checkProperty(fc, {
      name, rule, command: "node --test test/cache.property.test.mjs", arbitrary: history, numRuns, regressions,
      check: input => checkHistory(input, loaders), artifacts, diagnostics: () => diagnostics
    })
  })
}

test("cache-save: saves after compiler reads cannot publish stale results", async () => {
  // D299, metamorphic: after a gated save, settled load = fresh compile, including concurrent consumers.
  await checkProperty(fc, {
    name: "cache-save", rule, command: "node --test test/cache.property.test.mjs", numRuns: 2, regressions,
    arbitrary: fc.integer({ min: 1, max: 9 }), diagnostics: () => diagnostics,
    artifacts: value => revisions({ width: 1, actions: [{ kind: "source", slot: 0, value }] }).at(-1).files,
    check: async value => {
      const root = fixture()
      diagnostics = ""
      let loading
      try {
        write(root, revisions({ width: 1, actions: [] })[0].files)
        const binary = join(root, "compiler.mjs"), app = join(root, "app"), source = join(app, "src/main.vibe")
        writeFileSync(binary, wrapper(root, 0)); writeFileSync(join(root, "arm"), "armed")
        await sleep(120)
        const options = { root: app, project: join(app, "tsconfig.json"), compiler: binary, cache: { directory: join(root, "cache") },
          debug: line => { diagnostics = (diagnostics + line + "\n").slice(-12000) } }
        const modules = projects(options)
        const changed = join(app, "src/n0.vibe")
        loading = Promise.all([modules.load(source), modules.load(changed)])
        let completed = false, loadError
        loading.then(() => { completed = true }, error => { completed = true; loadError = error })
        const deadline = Date.now() + 15000
        while (!existsSync(join(root, "ready"))) {
          if (loadError) throw loadError
          assert.ok(!completed, `cache-save: compiler ended before read barrier\n${diagnostics}`)
          assert.ok(Date.now() < deadline, `cache-save: compiler-read barrier timed out\n${diagnostics}`)
          await sleep(5)
        }
        writeFileSync(join(app, "src/n0.vibe"), `export const part: number = ${value}\n`)
        writeFileSync(join(root, "release"), "release")
        const results = await loading
        const fresh = compileProjectSync({ ...options, cache: false })
        assert.deepEqual(fresh.errors, [])
        for (const [index, loaded] of results.entries()) {
          const expected = fresh.outputs.get(index === 0 ? source : changed)
          assert.deepEqual(loaded.errors, fresh.errors)
          assert.equal(loaded.code, expected.code)
          assert.deepEqual(loaded.map, expected.map)
        }
        assert.ok(calls(root) >= 3, "save requires a replacement compile before the fresh oracle compile")
      } finally {
        writeFileSync(join(root, "release"), "release")
        await loading?.catch(() => {})
        rmSync(root, { recursive: true, force: true })
      }
    }
  })
})
