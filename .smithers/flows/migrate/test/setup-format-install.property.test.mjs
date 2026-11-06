import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { makeConfig, wireNewPackages, wireTarget } from "../lib/steps.mjs"
import { must, quote } from "../lib/util.mjs"

const runtime = fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))
const compiler = fileURLToPath(new URL("../../../../packages/compiler/", import.meta.url))
const require = createRequire(join(runtime, "package.json"))
const fc = require("fast-check")
const prettier = fileURLToPath(new URL("../../../node_modules/prettier/", import.meta.url))
const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-cold-setup-formatter.json", import.meta.url), "utf8"))

async function fixture(t, { count = 1, configFile = false, warm = false, failInstall = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "cold setup format "))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const put = (name, text) => {
    mkdirSync(dirname(join(root, name)), { recursive: true })
    writeFileSync(join(root, name), text)
  }
  const packages = Array.from({ length: count }, (_, i) => "packages/p" + i)
  const config = { semi: false, plugins: ["vibelang/prettier"] }
  put("package.json", JSON.stringify({ name: "fixture", private: true, workspaces: packages, devDependencies: { prettier: "3.6.2", vite: "7.3.6" }, ...(configFile ? {} : { prettier: config }) }))
  if (configFile) put(".prettierrc.json", JSON.stringify(config))
  put(".gitignore", "node_modules/\n.logs/\n")
  for (const pkg of packages) {
    put(pkg + "/package.json", JSON.stringify({ name: pkg.split("/").at(-1), type: "module", devDependencies: { vite: "7.3.6" } }))
    put(pkg + "/vite.config.ts", corpus.viteConfig)
    put(pkg + "/tsconfig.json", '{"compilerOptions":{"strict":true},"include":["src/**/*.ts"]}\n')
    put(pkg + "/src/index.ts", "export const value=1\n")
  }
  mkdirSync(join(root, "node_modules/.bin"), { recursive: true })
  symlinkSync(join(runtime, "node_modules/typescript"), join(root, "node_modules/typescript"))
  symlinkSync(prettier, join(root, "node_modules/prettier"))
  symlinkSync(join(prettier, "bin/prettier.cjs"), join(root, "node_modules/.bin/prettier"))
  const installCode = failInstall ? "process.exit(13)" :
    `import { existsSync, symlinkSync } from "node:fs"; if (!existsSync("node_modules/vibelang")) symlinkSync(${JSON.stringify(compiler)}, "node_modules/vibelang");`
  put("install.mjs", installCode)
  if (warm) symlinkSync(compiler, join(root, "node_modules/vibelang"))
  await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@example.invalid", { cwd: root })
  return { root, config: makeConfig({ target: root, packages, test: "true", vibelangVersion: "0.0.11", install: quote(process.execPath) + " install.mjs" }) }
}

function checkFormatting(root) {
  const check = spawnSync(join(root, "node_modules/.bin/prettier"), ["--check", "package.json", "packages/p0/vite.config.ts"], { cwd: root, encoding: "utf8" })
  assert.equal(check.status, 0, check.stdout + check.stderr)
}

test("cold setup installs its formatter plugin before formatting written files", async t => {
  const { root, config } = await fixture(t)
  const wired = await wireTarget(config, join(root, ".logs"))
  assert.equal(wired.formatted.code, 0, JSON.stringify(wired.warnings))
  assert.ok(wired.formatted.files.includes("packages/p0/vite.config.ts"))
  checkFormatting(root)
})

test("setup stops at a failed install without attempting the formatter", async t => {
  const { root, config } = await fixture(t, { failInstall: true })
  await assert.rejects(wireTarget(config, join(root, ".logs")))
  assert.equal(existsSync(join(root, ".logs/setup-format.log")), false)
})

test("warm setup still formats the files it writes", async t => {
  const { root, config } = await fixture(t, { warm: true })
  const wired = await wireTarget(config, join(root, ".logs"))
  assert.equal(wired.formatted.code, 0)
  checkFormatting(root)
})

test("cold formatting resolves installed plugins across workspace and config layouts", async t => {
  await fc.assert(fc.asyncProperty(
    fc.integer({ min: 1, max: 3 }), fc.boolean(),
    async (count, configFile) => {
      const { root, config } = await fixture(t, { count, configFile })
      const wired = await wireTarget(config, join(root, ".logs"))
      assert.equal(wired.formatted.code, 0, JSON.stringify(wired.warnings))
      checkFormatting(root)
    }
  ), { numRuns: 8, seed: 1066 })
})

for (const failInstall of [false, true]) {
  test(`new workspace setup ${failInstall ? "stops before formatting on install failure" : "installs plugins before formatting"}`, async t => {
    const { root, config } = await fixture(t, { count: 2, failInstall })
    const file = join(root, "packages/p0/package.json")
    const manifest = JSON.parse(readFileSync(file, "utf8"))
    manifest.devDependencies.vibelang = "0.0.11"
    manifest.devDependencies["vibelang-runtime"] = "0.0.11"
    writeFileSync(file, JSON.stringify(manifest))
    if (failInstall) {
      await assert.rejects(wireNewPackages(config, join(root, ".logs")))
      assert.equal(existsSync(join(root, ".logs/setup-format.log")), false)
    } else {
      const wired = await wireNewPackages(config, join(root, ".logs"))
      assert.deepEqual(wired.added, ["packages/p1"])
      assert.equal(wired.formatted.code, 0, JSON.stringify(wired.warnings))
      const check = spawnSync(join(root, "node_modules/.bin/prettier"), ["--check", "packages/p1/package.json", "packages/p1/tsconfig.json"], { cwd: root, encoding: "utf8" })
      assert.equal(check.status, 0, check.stdout + check.stderr)
    }
  })
}
