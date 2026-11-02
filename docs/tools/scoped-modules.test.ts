import { expect, test } from "bun:test"
import assert from "node:assert/strict"
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { checkProperty } from "../../scripts/testing/property.mjs"

const repo = resolve(import.meta.dir, "../..")
const require = createRequire(join(repo, "packages/runtime/package.json"))
const fc = require("fast-check")
const rule = "Existing tools work."
type Input = { first: string[]; second: string[]; existing?: "none" | "directory" | "symlink"; scope?: string }
function packageAt(root: string, name: string, marker: string) {
  const directory = join(root, name)
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, "package.json"), JSON.stringify({ name, type: "module", exports: "./index.js" }))
  writeFileSync(join(directory, "index.js"), "export const marker = " + JSON.stringify(marker) + "\n")
  return directory
}
async function fixture({ first, second, existing = "none", scope = "@effect" }: Input) {
  const root = mkdtempSync(join(tmpdir(), "docs-scoped-packages-"))
  try {
    const fake = join(root, "repo"), project = join(root, "project"), sources = [join(fake, "experiments/node_modules"), join(fake, "docs/tools/node_modules")]
    for (const path of [...sources, join(fake, "packages"), join(project, "node_modules")]) mkdirSync(path, { recursive: true })
    for (const name of ["runtime", "compiler", "vite"]) symlinkSync(join(repo, "packages", name), join(fake, "packages", name))
    const expected = new Map<string, string>(), originals: { source: string; names: string[] }[] = []
    if (existing !== "none") {
      const seed = join(root, "installed"), name = scope + "/retained"
      const directory = packageAt(seed, name, "already installed")
      if (existing === "symlink") symlinkSync(join(seed, scope), join(project, "node_modules", scope))
      else { mkdirSync(join(project, "node_modules", scope)); symlinkSync(directory, join(project, "node_modules", name)) }
      expected.set(name, directory)
      originals.push({ source: join(seed, scope), names: ["retained"] })
    }
    for (const [index, names] of [first, second].entries()) {
      for (const name of new Set(names)) {
        const directory = packageAt(sources[index], name, index + ":" + name)
        if (!expected.has(name)) expected.set(name, directory)
      }
      for (const name of readdirSync(sources[index]).filter(name => name.startsWith("@"))) originals.push({ source: join(sources[index], name), names: readdirSync(join(sources[index], name)).sort() })
    }
    const file = join(fake, "docs/tools/check-snippets.ts")
    copyFileSync(process.env.SCOPED_LINKER_SOURCE || join(repo, "docs/tools/check-snippets.ts"), file)
    const helper = await import(pathToFileURL(file).href)
    helper.linkModules(project)
    const projectRequire = createRequire(join(project, "package.json"))
    for (const [name, source] of expected) {
      assert.equal(realpathSync(projectRequire.resolve(name)), realpathSync(join(source, "index.js")), "wrong package for " + name)
    }
    for (const { source, names } of originals) assert.deepEqual(readdirSync(source).sort(), names, "shared dependency tree changed: " + source)
    assert.equal(realpathSync(join(project, "node_modules/vibelang-runtime")), realpathSync(join(repo, "packages/runtime")))
  } finally { rmSync(root, { recursive: true, force: true }) }
}
test("scope children from both dependency roots remain resolvable", () => fixture({ first: ["@effect/platform-node"], second: ["@effect/vitest"] }))
test("existing scoped links stay intact and their shared installation stays unchanged", async () => {
  for (const existing of ["directory", "symlink"] as const) await fixture({ first: ["@effect/platform-node"], second: ["@effect/vitest"], existing })
})
test("duplicate packages retain source priority across scopes and ordinary packages", () => fixture({ first: ["@tools/shared", "ordinary"], second: ["@tools/shared", "@tools/other", "ordinary"] }))
test("scope-linking oracle quotes the tooling specification", () => expect(readFileSync(join(repo, "docs/design/src/007-tooling.md"), "utf8")).toContain(rule))
test("scoped package layouts merge without hiding siblings or mutating sources", () => checkProperty(fc, {
  name: "docs-scoped-modules", rule, command: "bun test docs/tools/scoped-modules.test.ts",
  regressions: new URL("./testdata/scoped-modules/", import.meta.url), numRuns: 160,
  arbitrary: fc.record({
    first: fc.array(fc.constantFrom("@effect/platform-node", "@effect/vitest", "@tools/shared", "@tools/other", "ordinary"), { maxLength: 6 }),
    second: fc.array(fc.constantFrom("@effect/platform-node", "@effect/vitest", "@tools/shared", "@tools/other", "ordinary"), { maxLength: 6 }),
    existing: fc.constantFrom("none", "directory", "symlink"), scope: fc.constantFrom("@effect", "@tools")
  }), check: fixture
}))
