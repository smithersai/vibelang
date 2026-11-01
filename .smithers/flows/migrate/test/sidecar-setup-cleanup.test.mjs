import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { makeConfig, wireNewPackages, wireTarget } from "../lib/steps.mjs"
import { must } from "../lib/util.mjs"

const runtime = fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))

test("Smithers: setup removes superseded adjacent sidecars immediately and replay stays clean", async t => {
  const root = mkdtempSync(join(tmpdir(), "sidecar-setup-cleanup-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const put = (file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
  put("package.json", '{"name":"fixture","private":true,"type":"module"}\n')
  put("tsconfig.json", '{"compilerOptions":{"noEmit":true},"include":["src"]}\n')
  put("src/step.vibe", "export const step = 1\n")
  put("src/step.d.vibe.ts", "export declare const step = 1;\n")
  put("src/unrelated.d.vibe.ts", "export declare const unrelated = 2;\n")
  put("test/load.test.ts", 'import { readdirSync } from "node:fs"; export const paths = readdirSync("src").filter(n => n.endsWith(".ts"));\n')
  mkdirSync(join(root, "node_modules"))
  symlinkSync(join(runtime, "node_modules/typescript"), join(root, "node_modules/typescript"))
  await must("jj git init", { cwd: root })
  await must("jj config set --repo user.name test", { cwd: root })
  await must("jj config set --repo user.email test@localhost", { cwd: root })
  const protectedTest = readFileSync(join(root, "test/load.test.ts"))
  const config = makeConfig({ target: root, packages: ["."], test: "true", vibelangVersion: "0.0.11", install: "true" })
  const first = await wireTarget(config, join(root, ".logs"))
  assert.ok(first.sidecarDir, "the unchanged tracked selector must enable directory mode")
  assert.equal(existsSync(join(root, "src/step.d.vibe.ts")), false, "setup left a tracked stale sidecar behind")
  assert.ok(first.changed.includes("src/step.d.vibe.ts"))
  assert.equal(readFileSync(join(root, "src/step.vibe"), "utf8"), "export const step = 1\n")
  assert.equal(readFileSync(join(root, "src/unrelated.d.vibe.ts"), "utf8"), "export declare const unrelated = 2;\n")
  assert.deepEqual(readFileSync(join(root, "test/load.test.ts")), protectedTest)
  const second = await wireTarget(config, join(root, ".logs"))
  assert.ok(!second.changed.includes("src/step.d.vibe.ts"), "setup removed the same output twice")
  assert.deepEqual(readFileSync(join(root, "test/load.test.ts")), protectedTest)
  const customConfig = JSON.parse(readFileSync(join(root, "tsconfig.json"), "utf8"))
  customConfig.vibe.sidecarDir = "types"
  put("tsconfig.json", JSON.stringify(customConfig))
  const custom = await wireTarget(config, join(root, ".logs"))
  assert.equal(custom.sidecarDir.directory, "types", "receipt must describe the effective setting")
  assert.ok(custom.sidecarDir.projects.some(project => project.config === "tsconfig.json" && project.directory === "types"))
})


test("new-package no-wire setup relocates sidecars while preserving existing wired packages", async t => {
  const root = mkdtempSync(join(tmpdir(), "sidecar-new-package-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const put = (file, text) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text) }
  put("package.json", '{"name":"workspace","private":true,"type":"module"}\n')
  put("packages/old/package.json", '{"name":"old","dependencies":{"vibelang-runtime":"0.0.11"},"devDependencies":{"vibelang":"0.0.11"}}\n')
  put("packages/old/tsconfig.json", '{"include":["src"]}\n')
  put("packages/new/package.json", '{"name":"new","private":true}\n')
  put("packages/new/tsconfig.json", '{"compilerOptions":{"noEmit":true},"include":["src"]}\n')
  put("packages/new/src/step.vibe", "export const step = 1\n")
  put("packages/new/src/step.d.vibe.ts", "export declare const step = 1;\n")
  put("load.ts", 'import { readdirSync } from "node:fs"; export const files = readdirSync("packages/new/src").filter(n => n.endsWith(".ts"));\n')
  mkdirSync(join(root, "node_modules"))
  symlinkSync(join(runtime, "node_modules/typescript"), join(root, "node_modules/typescript"))
  await must("jj git init", { cwd: root })
  await must("jj config set --repo user.name test", { cwd: root })
  await must("jj config set --repo user.email test@localhost", { cwd: root })
  const before = ["packages/old/package.json", "packages/old/tsconfig.json"].map(file => readFileSync(join(root, file)))
  const config = makeConfig({ target: root, packages: ["packages/old", "packages/new"], test: "true", vibelangVersion: "0.0.11", install: "true" })
  const result = await wireNewPackages(config, join(root, ".logs"))
  assert.deepEqual(result.added, ["packages/new"])
  assert.equal(JSON.parse(readFileSync(join(root, "packages/new/tsconfig.json"), "utf8")).vibe.sidecarDir, ".vibe/declarations")
  assert.ok(result.sidecarDir.projects.some(project => project.config === "packages/new/tsconfig.json"))
  assert.ok(result.sidecarDir.removed.includes("packages/new/src/step.d.vibe.ts"))
  assert.equal(existsSync(join(root, "packages/new/src/step.d.vibe.ts")), false)
  for (const [i, file] of ["packages/old/package.json", "packages/old/tsconfig.json"].entries()) assert.deepEqual(readFileSync(join(root, file)), before[i])
  assert.equal(await wireNewPackages(config, join(root, ".logs")), null)
})
