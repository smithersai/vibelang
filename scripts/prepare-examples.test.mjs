import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { tmpdir } from "node:os"
import { test } from "node:test"
import { prepareExample } from "./prepare-examples.mjs"

test("CI stages examples with local packages and leaves published sources unchanged", t => {
  const scratch = mkdtempSync(join(tmpdir(), "vibelang-examples-test-"))
  t.after(() => rmSync(scratch, { recursive: true, force: true }))
  const source = join(scratch, "source")
  mkdirSync(join(source, "src"), { recursive: true })
  mkdirSync(join(source, "node_modules"))
  const manifest = JSON.stringify({ dependencies: { "vibelang-runtime": "9.8.7", effect: "4.0.5" }, devDependencies: { vibelang: "9.8.7", "vibelang-vite": "9.8.7" } })
  writeFileSync(join(source, "package.json"), manifest)
  writeFileSync(join(source, "src/main.vibe"), "export function main() {}")
  writeFileSync(join(source, "bun.lock"), "old")
  const destination = join(scratch, "staged")
  const packages = { vibelang: join(scratch, "compiler"), "vibelang-runtime": join(scratch, "runtime.tgz"), "vibelang-vite": join(scratch, "vite") }
  prepareExample(source, destination, packages, "4.0.5")
  assert.equal(readFileSync(join(source, "package.json"), "utf8"), manifest)
  const result = JSON.parse(readFileSync(join(destination, "package.json"), "utf8"))
  assert.equal(result.dependencies["vibelang-runtime"], "file:" + packages["vibelang-runtime"])
  assert.equal(result.devDependencies.vibelang, "file:" + packages.vibelang)
  assert.equal(result.devDependencies["vibelang-vite"], "file:" + packages["vibelang-vite"])
  assert.equal(result.overrides["@effect/platform-node-shared"], "4.0.5")
  assert.equal(result.overrides.vibelang, "file:" + packages.vibelang)
  assert.ok(existsSync(join(destination, "src/main.vibe")))
  assert.ok(!existsSync(join(destination, "node_modules")))
  assert.ok(!existsSync(join(destination, "bun.lock")))
})


test("the examples README states the exact Effect version used by every example", () => {
  const examples = new URL("../examples/", import.meta.url)
  const readme = readFileSync(new URL("README.md", examples), "utf8")
  const version = /exact Effect ([0-9.]+) dependencies/.exec(readme)?.[1]
  assert.ok(version, "README must state the exact Effect version")
  for (const entry of readdirSync(examples, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const path = new URL(`${entry.name}/package.json`, examples)
    if (!existsSync(path)) continue
    const manifest = JSON.parse(readFileSync(path, "utf8"))
    assert.equal(manifest.dependencies.effect, version, entry.name)
  }
})

// An example installs the VibeLang packages from this checkout, and with them
// each package's exact dependency pins. A pin younger than the example's
// minimumReleaseAge fails `bun install`, so each example excludes them all.
test("every example's release-age exclusions cover the exact pins of the VibeLang packages it installs", () => {
  const repository = fileURLToPath(new URL("..", import.meta.url))
  const json = path => JSON.parse(readFileSync(join(repository, path), "utf8"))
  const packages = { vibelang: "compiler", "vibelang-vite": "vite", "vibelang-unplugin": "unplugin", "vibelang-runtime": "runtime" }
  const examples = readdirSync(join(repository, "examples")).filter(name => existsSync(join(repository, "examples", name, "bunfig.toml")))
  assert.ok(examples.length > 0)
  for (const example of examples) {
    const bunfig = readFileSync(join(repository, "examples", example, "bunfig.toml"), "utf8")
    if (!/^minimumReleaseAge\s*=/m.test(bunfig)) continue
    const excludes = JSON.parse(/^minimumReleaseAgeExcludes\s*=\s*(\[.*\])/m.exec(bunfig)?.[1] ?? "[]")
    const manifest = json(`examples/${example}/package.json`)
    const installed = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }).filter(name => name in packages)
    const pins = installed.flatMap(name => {
      const { dependencies, optionalDependencies } = json(`packages/${packages[name]}/package.json`)
      return Object.keys({ ...dependencies, ...optionalDependencies })
    })
    assert.deepEqual(pins.filter(name => !excludes.includes(name)), [], `examples/${example}/bunfig.toml minimumReleaseAgeExcludes`)
  }
})
