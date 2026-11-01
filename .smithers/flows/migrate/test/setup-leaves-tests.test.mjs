// Decided detail 272, through setup's own wiring: a repository laid out with
// Smithers' embedded esbuild calls (the corpus) keeps every test, fixture and
// helper only tests import byte for byte, while its scripts and sources get
// the plugin. Setup edits a test nowhere: no step of it, not only the esbuild
// wiring, may change one.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { must } from "../lib/util.mjs"
import { makeConfig, wireTarget } from "../lib/steps.mjs"

const runtime = fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))
const corpus = JSON.parse(readFileSync(new URL("./corpus/smithers-embedded-esbuild.json", import.meta.url), "utf8"))
// Each corpus file's package in Smithers.
const packageOf = (file) => file.match(/^(?:apps\/mvp|packages\/smithers\/(?:flows\/[^/]+|ui\/views|agent\/harness|migrate)|packages\/[^/]+)(?=\/)/)[0]
const tests = ["BrowserBundle.test.ts", "IssueSort.browser.test.ts", "tab.test.ts", "sourceShape.test.ts", "MinifiedBuild.ts", "bundle.ts", "helpers.ts", "quickstart.docs.test.ts"]

test("setup's wiring leaves every test and fixture of Smithers' esbuild corpus byte for byte and wires its scripts", async () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-setup-tests-"))
  try {
    const put = (file, text) => {
      mkdirSync(join(root, file, ".."), { recursive: true })
      writeFileSync(join(root, file), text)
    }
    const dirs = [...new Set(corpus.cases.map((entry) => packageOf(entry.file)))]
    put("package.json", JSON.stringify({ name: "fixture", private: true, workspaces: ["packages/core", ...dirs] }, null, 2) + "\n")
    put("packages/core/package.json", JSON.stringify({ name: "core", type: "module" }, null, 2) + "\n")
    put("packages/core/tsconfig.json", JSON.stringify({ compilerOptions: { strict: true }, include: ["src/**/*.ts"] }, null, 2) + "\n")
    put("packages/core/src/index.ts", "export const one = 1\n")
    for (const dir of dirs) put(`${dir}/package.json`, JSON.stringify({ name: dir, type: "module", dependencies: { core: "workspace:*" }, devDependencies: { esbuild: "0.28.2" } }, null, 2) + "\n")
    for (const entry of corpus.cases) put(entry.file, entry.text)
    mkdirSync(join(root, "node_modules"))
    symlinkSync(join(runtime, "node_modules/typescript"), join(root, "node_modules/typescript"))
    await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost && jj file track . 2>/dev/null; true", { cwd: root })
    const before = new Map(corpus.cases.map((entry) => [entry.file, readFileSync(join(root, entry.file), "utf8")]))

    const config = makeConfig({ target: root, packages: ["packages/core"], test: "true", vibelangVersion: "0.0.11", install: "true" })
    const wired = await wireTarget(config, join(root, ".logs"))

    const testFiles = corpus.cases.map((entry) => entry.file).filter((file) => tests.includes(file.split("/").pop()))
    assert.equal(testFiles.length, 9)
    for (const file of testFiles) {
      assert.equal(readFileSync(join(root, file), "utf8"), before.get(file), `${file} changed`)
      assert.ok(!wired.changed.includes(file), `${file} is in setup's changed files`)
    }
    // Not vacuous: the realm build script, a source of the same repository, gets the plugin.
    assert.match(readFileSync(join(root, "packages/smithers/agent/harness/realm/build.mjs"), "utf8"), /vibelang\(\)/)
    assert.ok(wired.warnings.some((warning) => warning.startsWith("packages/smithers/flows/platform-node/src/SandboxedFlow.ts:")), wired.warnings.join("\n"))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
