import "./helpers/jj-config.mjs"
// A repository with .vibe modules keeps its installed predecessor compiler
// until upgrade-effect has checked it: a failing predecessor stops the run
// before any repin, and a passing one lets the run repin.
import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { upgradeEffect } from "../lib/steps.mjs"
import * as Jj from "../lib/jj.mjs"
import { must, readJson, writeJson } from "../lib/util.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")

// A shell compiler that logs each call to calls and exits code; with
// answersVersion it prints a version for --version first.
const compiler = (calls, code, answersVersion = true) => "#!/bin/sh\necho \"$*\" >> " + JSON.stringify(calls) + "\n" +
  (answersVersion ? 'if [ "$1" = "--version" ]; then echo 0.0.11; exit 0; fi\n' : "") + "exit " + code + "\n"

// A target set up by an earlier toolchain, with a native module and its
// installed vibelang, and a staged toolchain whose compiler passes.
async function fixture(root) {
  const target = join(root, "repo")
  const toolchain = join(root, "toolchain")
  const calls = join(root, "calls.log")
  mkdirSync(target)
  mkdirSync(join(toolchain, "native"), { recursive: true })
  await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: target })
  writeFileSync(join(target, "package.json"), JSON.stringify({ name: "fixture", private: true, dependencies: { effect: "4.0.6", vibelang: "file:./.vibelang-toolchain/vibelang-old.tgz" } }))
  writeFileSync(join(target, "bun.lock"), "")
  writeFileSync(join(target, ".gitignore"), ".vibelang-toolchain/\nnode_modules/\n")
  writeFileSync(join(target, "tsconfig.json"), "{}\n")
  mkdirSync(join(target, "src"))
  writeFileSync(join(target, "src/helper.vibe"), "export const v = 1\n")
  mkdirSync(join(target, "node_modules/.bin"), { recursive: true })
  // The predecessor check reads the projects with TypeScript's API before it runs the compiler.
  symlinkSync(dirname(require.resolve("typescript/package.json")), join(target, "node_modules/typescript"))
  writeFileSync(join(toolchain, "native/vibelang"), compiler(join(root, "staged.log"), 0), { mode: 0o755 })
  const base = await Jj.commit(target, "base")
  writeFileSync(join(toolchain, "vibelang-new.tgz"), "tarball\n")
  writeFileSync(join(toolchain, "runtime-new.tgz"), "tarball\n")
  writeJson(join(toolchain, "toolchain.json"), { version: "0.0.12", commit: "fedcba9876543210fedc", effect: "4.0.6", compiler: "native/vibelang", packages: { vibelang: "vibelang-new.tgz", "vibelang-runtime": "runtime-new.tgz" } })
  const predecessor = (code, answersVersion) => writeFileSync(join(target, "node_modules/.bin/vibelang"), compiler(calls, code, answersVersion), { mode: 0o755 })
  const upgrade = () => upgradeEffect({ run: join(root, "run"), target, packages: ["."], test: "true", toolchain, install: "true", base })
  return { target, calls, predecessor, upgrade }
}

test("a predecessor baseline failure never repins an existing native project", async () => {
  // The baseline guard must run before the old compiler's one-time VIP rewrite.
  await fc.assert(fc.asyncProperty(fc.constantFrom(1, 2, 137), fc.boolean(), async (code, answersVersion) => {
    const root = mkdtempSync(join(tmpdir(), "migrate-vip-preflight-"))
    try {
      const { target, calls, predecessor, upgrade } = await fixture(root)
      const manifest = readFileSync(join(target, "package.json"), "utf8")
      predecessor(code, answersVersion)
      // The predecessor's own failure stops the run: its --version, or its check of the module.
      await assert.rejects(upgrade(), answersVersion
        ? new RegExp("the compiler did not finish \\(exit " + code + "\\b")
        : new RegExp("node_modules/\\.bin/vibelang' --version exited " + code + "\\b"))
      assert.ok(readFileSync(calls, "utf8").length, "the predecessor ran")
      assert.equal(readFileSync(join(target, "package.json"), "utf8"), manifest)
      assert.equal(readFileSync(join(target, "src/helper.vibe"), "utf8"), "export const v = 1\n")
    } finally { rmSync(root, { recursive: true, force: true }) }
  }), { seed: 1049759, numRuns: 12 })
})

// The control: the same fixture with a predecessor that passes reaches the
// repin, so the test above fails for the predecessor's sake and not the fixture's.
test("a passing predecessor lets upgrade-effect repin the native project", async () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-vip-preflight-"))
  try {
    const { target, calls, predecessor, upgrade } = await fixture(root)
    predecessor(0, true)
    await upgrade()
    assert.match(readFileSync(calls, "utf8"), /^--version$/m, "the predecessor was checked")
    assert.match(readJson(join(target, "package.json")).dependencies.vibelang, /^file:\.\/\.vibelang-toolchain\/vibelang-new-[0-9a-f]{12}\.tgz$/)
    assert.equal(readFileSync(join(target, "src/helper.vibe"), "utf8"), "export const v = 1\n")
  } finally { rmSync(root, { recursive: true, force: true }) }
})
