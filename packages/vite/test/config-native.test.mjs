import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"
import { loadTypeScript } from "../../../.smithers/flows/migrate/lib/declarations.mjs"
import { wireViteApps } from "../../../.smithers/flows/migrate/lib/wire.mjs"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const here = fileURLToPath(new URL(".", import.meta.url))
const ts = loadTypeScript([join(repo, "packages/runtime")])
const regressions = new URL("./property-regressions/", import.meta.url)
const corpus = JSON.parse(readFileSync(new URL("./property-regressions/foldkit-vite-config-native-dependency.json", import.meta.url)))
const write = (root, file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
let diagnostics = ""
function generated(input) {
  const q = input.quote, suffix = input.extension
  const files = {
    "leaf.vibe": `export schema FeatureFlag { enabled: boolean }\nexport const enabled = ${input.enabled}\n`,
    "entry.ts": "export const value = __ENABLED__\n"
  }
  let target = "./leaf.vibe"
  for (let i = 0; i < input.barrels; i++) {
    files[`bridge${i}.${suffix}`] = `export ${input.star ? "*" : "{ enabled }"} from ${q}${target}${q}\n`
    target = `./bridge${i}.${suffix}`
  }
  const imports = {
    named: `import { enabled } from ${q}${target}${q}`,
    namespace: `import * as flags from ${q}${target}${q}\nconst enabled = flags.enabled`,
    dynamic: `const { enabled } = await import(${q}${target}${q})`,
    empty: `import {} from ${q}${target}${q}\nconst enabled = ${input.enabled}`,
    template: 'const { enabled } = await import(`' + target + '`)',
    sideEffect: `import ${q}${target}${q}\nconst enabled = ${input.enabled}`
  }
  files[`vite.config.${suffix}`] = `import { defineConfig } from "vite"\nimport vibelang from "vibelang-vite"\n${imports[input.shape]}\nexport default defineConfig({ plugins: [vibelang()], define: { __ENABLED__: JSON.stringify(enabled) }, build: { lib: { entry: "entry.ts", formats: ["es"], fileName: "entry" } } })\n`
  return files
}

function scenario(input, files, proveBefore = false) {
  mkdirSync(join(here, ".fixtures"), { recursive: true })
  const root = mkdtempSync(join(here, ".fixtures/config-native-"))
  try {
    for (const [file, text] of Object.entries(files)) write(root, file, text)
    write(root, "package.json", JSON.stringify({ type: "module", scripts: { build: `vite build --configLoader=${input.loader}` } }))
    write(root, "tsconfig.json", JSON.stringify({ compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "bundler", strict: true, skipLibCheck: true, types: [] }, include: ["leaf.vibe"] }))
    mkdirSync(join(root, "node_modules"), { recursive: true })
    for (const [name, path] of [["vibelang", join(repo, "packages/compiler")], ["vibelang-vite", join(repo, "packages/vite")]]) symlinkSync(path, join(root, "node_modules", name))
    const run = command => spawnSync("sh", ["-c", command], { cwd: root, encoding: "utf8", timeout: 60000,
      env: { ...process.env, NODE_OPTIONS: input.inherited, PATH: join(repo, "packages/vite/node_modules/.bin") + ":" + process.env.PATH } })
    if (proveBefore) {
      const before = run("vite build")
      assert.ifError(before.error)
      assert.notEqual(before.status, 0, "default config bundling must reproduce the bug")
      assert.match(before.stderr, /PARSE_ERROR|Unexpected token/)
      const nativeOnly = run("vite build --configLoader native")
      assert.notEqual(nativeOnly.status, 0, "native config loading also needs the preload")
      assert.match(nativeOnly.stderr, /ERR_UNKNOWN_FILE_EXTENSION/)
    }
    const wired = wireViteApps({ root, packages: [{ dir: ".", sources: ["src"] }], ts,
      specsFor: () => ({ vibelang: "0.0.11", "vibelang-vite": "0.0.11" }) })
    assert.deepEqual(wired.warnings, [])
    const command = JSON.parse(readFileSync(join(root, "package.json"))).scripts.build
    const result = run(command)
    diagnostics = JSON.stringify({ input, command, status: result.status, stdout: result.stdout, stderr: result.stderr }).replaceAll(root, "<project>")
    assert.ifError(result.error)
    assert.equal(result.status, 0, diagnostics)
    const observed = spawnSync(process.execPath, ["--input-type=module", "-e",
      `const { value } = await import(${JSON.stringify(pathToFileURL(join(root, "dist/entry.js")).href)}); console.log(JSON.stringify(value))`],
      { encoding: "utf8", timeout: 10000 })
    assert.ifError(observed.error)
    assert.equal(observed.status, 0, observed.stderr)
    assert.equal(JSON.parse(observed.stdout), input.enabled)
    assert.deepEqual(wireViteApps({ root, packages: [{ dir: "." }], ts, specsFor: () => ({ vibelang: "0.0.11", "vibelang-vite": "0.0.11" }) }).changed, [])
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("foldkit: real Vite config importing a native schema builds after setup", () => {
  scenario(corpus.input, corpus.files, true)
})

test("Vite config import shapes retain their values through native loading", async () => {
  assert.ok(readFileSync(join(repo, "docs/design/src/007-tooling.md"), "utf8").includes("Existing tools work."))
  await checkProperty(fc, {
    name: "vite-config-native-dependency",
    rule: 'docs/design/src/007-tooling.md: "Existing tools work."',
    command: "node --test test/config-native.test.mjs", regressions, numRuns: 24,
    arbitrary: fc.record({ shape: fc.constantFrom("named", "namespace", "dynamic", "sideEffect", "empty", "template"), barrels: fc.integer({ min: 0, max: 2 }),
      extension: fc.constantFrom("ts", "mts", "mjs"), star: fc.boolean(), quote: fc.constantFrom("'", '"'), enabled: fc.boolean(),
      loader: fc.constantFrom("bundle", "runner", "native"), inherited: fc.constantFrom("", "--enable-source-maps", "--no-warnings") }),
    artifacts: generated, diagnostics: () => diagnostics,
    check: input => scenario(input, generated(input))
  })
})
