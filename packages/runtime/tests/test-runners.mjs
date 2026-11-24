// Runner coverage for the runtime's tests, run by //packages:runtime-test-runners.
// bun test discovers every *.test.* file, including node:test files through
// Bun's shim and real-browser files that skip without Chromium. This file
// checks the two places where those files must run for real.
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { test } from "node:test"
import { packageDeclarations } from "../../../scripts/testing/package-declarations.mjs"

const testsDir = new URL("./", import.meta.url)
const repo = new URL("../../../", import.meta.url)
const testFiles = readdirSync(testsDir).filter(name => /\.test\.mjs$/.test(name)).sort()
const nodeTestFiles = testFiles.filter(name => /from ["']node:test["']/.test(readFileSync(new URL(name, testsDir), "utf8")))
const targets = packageDeclarations()

test("every node:test file in runtime/tests runs under Node in runtime-dist", () => {
  assert.ok(nodeTestFiles.length > 0)
  const shell = targets["runtime-dist"].shell
  const missing = nodeTestFiles.filter(name => !shell.includes("packages/runtime/tests/" + name))
  assert.deepEqual(missing, [], "add these files to runtimeNodeTests in packages/PACKAGE.ts")
  const declared = new Set(targets["runtime-dist"].data.filter(input => input?.kind === "file").map(input => input.path))
  for (const name of nodeTestFiles) assert.ok(declared.has("runtime/tests/" + name), "runtime-dist input: " + name)
})

test("every node:test file in runtime/tests runs in each Node of scripts/test-node-versions.sh", () => {
  const script = readFileSync(new URL("scripts/test-node-versions.sh", repo), "utf8")
  const missing = nodeTestFiles.filter(name => !script.includes("packages/runtime/tests/" + name))
  assert.deepEqual(missing, [], "add these files to the node --test line of scripts/test-node-versions.sh")
})

test("every real-Chromium file requires the browser in runtime-browser-test", () => {
  const browserFiles = readdirSync(testsDir).filter(name => /\.test\.ts$/.test(name) &&
    /import\("playwright"\)/.test(readFileSync(new URL(name, testsDir), "utf8"))).sort()
  assert.deepEqual(browserFiles, ["experimental-browser-services.test.ts", "experimental-locks.test.ts"])
  const shell = targets["runtime-browser-test"].shell
  assert.match(shell, /VIBELANG_REQUIRE_BROWSER_TESTS=1 bun test /)
  assert.match(shell, /bunx playwright install (?:--with-deps )?chromium/)
  for (const name of browserFiles) {
    assert.ok(shell.includes("tests/" + name), "runtime-browser-test runs " + name)
    // A file that ignores the variable would still skip in that target.
    assert.match(readFileSync(new URL(name, testsDir), "utf8"), /VIBELANG_REQUIRE_BROWSER_TESTS === "1"/, name)
  }
})
