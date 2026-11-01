// opencode agent, 2026-11-01T01:00Z: a repository with .vibe modules that
// moves to a newer toolchain needs the earlier compiler's VIP migrations
// first, which only that compiler can make (VIP-1's unmarked Effect helpers).
import assert from "node:assert/strict"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { upgradeEffect } from "../lib/steps.mjs"
import * as Jj from "../lib/jj.mjs"
import { must, writeJson } from "../lib/util.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")

const quote = "it first runs the installed `vibelang --fix --fix-vip-only` on each project with a tracked `.vibe` file"

// A target set up by an earlier toolchain, its installed vibelang a stand-in
// that records each call, the manifest it sees, and marks the helper it fixes.
async function fixture(root, files) {
  const target = join(root, "repo")
  const toolchain = join(root, "toolchain")
  mkdirSync(target)
  mkdirSync(toolchain)
  await must("jj git init && jj config set --repo user.name test && jj config set --repo user.email test@localhost", { cwd: target })
  writeFileSync(join(target, "package.json"), JSON.stringify({ name: "fixture", private: true, dependencies: { effect: "4.0.6", vibelang: "file:./.vibelang-toolchain/vibelang-old.tgz" } }))
  writeFileSync(join(target, "bun.lock"), "")
  writeFileSync(join(target, ".gitignore"), ".vibelang-toolchain/\nnode_modules/\n")
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(target, file, ".."), { recursive: true })
    writeFileSync(join(target, file), text)
  }
  const calls = join(root, "calls.log")
  const bin = join(target, "node_modules/.bin/vibelang")
  mkdirSync(join(bin, ".."), { recursive: true })
  writeFileSync(bin, `#!/bin/sh
if [ "$1" = "--version" ]; then echo 0.0.11; exit 0; fi
case " $* " in *" --fix --fix-vip-only "*) ;; *) exit 0;; esac
printf '%s|%s|%s\\n' "$PWD" "$*" "$(grep -o 'vibelang-[a-z]*\\.tgz' ${join(target, "package.json")})" >> ${calls}
for f in $(find . -name '*.vibe' -not -path '*/node_modules/*'); do
  sed -i 's/^export function unwrap/export effect function unwrap/' "$f"
done
exit 0
`)
  chmodSync(bin, 0o755)
  // Existing native projects are checked before repinning, and with the staged compiler afterward.
  symlinkSync(dirname(require.resolve("typescript/package.json")), join(target, "node_modules/typescript"))
  mkdirSync(join(toolchain, "native"), { recursive: true })
  writeFileSync(join(toolchain, "native/vibelang"), "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo 0.0.12; fi\nexit 0\n", { mode: 0o755 })
  const base = await Jj.commit(target, "base")
  writeFileSync(join(toolchain, "vibelang-new.tgz"), "tarball\n")
  writeJson(join(toolchain, "toolchain.json"), { version: "0.0.12", commit: "fedcba9876543210fedc", effect: "4.0.6", compiler: "native/vibelang", packages: { vibelang: "vibelang-new.tgz" } })
  return { target, toolchain, base, calls }
}

test("upgrade-effect runs the installed compiler's VIP migrations on the earlier run's .vibe modules before repinning", async () => {
  assert.ok(readFileSync(new URL("../README.md", import.meta.url), "utf8").includes(quote), "update the quoted step rule")
  const root = mkdtempSync(join(tmpdir(), "migrate-vip-switch-"))
  try {
    // opencode's ai protocols: an unmarked helper that unwraps an Effect, which only the pre-VIP-1 compiler knows to mark.
    const corpus = JSON.parse(readFileSync(new URL("./corpus/opencode-vip1-unmarked-helper.json", import.meta.url), "utf8"))
    const helper = corpus.before
    const { target, toolchain, base, calls } = await fixture(root, {
      "packages/ai/tsconfig.json": "{}\n",
      "packages/ai/src/helper.vibe": helper,
      "packages/ai/src/plain.ts": "export const x = 1\n",
      "packages/core/tsconfig.json": "{}\n",
      "packages/core/src/index.ts": "export const y = 2\n"
    })
    const result = await upgradeEffect({ run: join(root, "run"), target, packages: ["."], test: "true", testCwd: ".", toolchain, install: "true", base })
    // Once, for the one project with a .vibe file, before the manifest names the new tarball.
    assert.deepEqual(readFileSync(calls, "utf8").trim().split("\n"),
      [`${join(target, "packages/ai")}|-p ${join(target, "packages/ai/tsconfig.json")} --fix --fix-vip-only --noEmit --pretty false|vibelang-old.tgz`])
    assert.deepEqual(result.vipFixes, { changed: ["packages/ai/src/helper.vibe"], projects: ["packages/ai/tsconfig.json"], failed: [] })
    assert.deepEqual(result.changed.sort(), ["package.json", "packages/ai/src/helper.vibe"])
    assert.equal(readFileSync(join(target, "packages/ai/src/helper.vibe"), "utf8"), corpus.after)
    const { stdout } = await must(`jj log -r ${result.jj.commit} --no-graph -T description`, { cwd: target })
    assert.match(stdout, /^migrate\(vibelang\): switch to the toolchain of VibeLang fedcba987654\n/)
    assert.match(stdout, /First applies the earlier toolchain's VIP migrations\n\(vibelang --fix --fix-vip-only\) to 1 \.vibe file\./)
    const { stdout: files } = await must(`jj diff -r ${result.jj.commit} --summary`, { cwd: target })
    assert.deepEqual(files.trim().split("\n").sort(), ["M package.json", "M packages/ai/src/helper.vibe"])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("upgrade-effect leaves a repository with no .vibe module to the new toolchain alone", async () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-vip-switch-"))
  try {
    const { target, toolchain, base, calls } = await fixture(root, { "tsconfig.json": "{}\n", "src/index.ts": "export const y = 2\n" })
    const result = await upgradeEffect({ run: join(root, "run"), target, packages: ["."], test: "true", testCwd: ".", toolchain, install: "true", base })
    assert.equal(existsSync(calls), false)
    assert.deepEqual(result.vipFixes, { changed: [], projects: [], failed: [] })
    const { stdout } = await must(`jj log -r ${result.jj.commit} --no-graph -T description`, { cwd: target })
    assert.doesNotMatch(stdout, /VIP migrations/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("a project whose installed compiler is missing or fails is named, and the switch goes on", async () => {
  const root = mkdtempSync(join(tmpdir(), "migrate-vip-switch-"))
  try {
    const { target, toolchain, base } = await fixture(root, { "packages/ai/tsconfig.json": "{}\n", "packages/ai/src/helper.vibe": "export const v = 1\n" })
    writeFileSync(join(target, "node_modules/.bin/vibelang"), "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo 0.0.11; exit 0; fi\ncase \" $* \" in *\" --fix --fix-vip-only \"*) exit 2;; *) exit 0;; esac\n")
    const result = await upgradeEffect({ run: join(root, "run"), target, packages: ["."], test: "true", testCwd: ".", toolchain, install: "true", base })
    assert.deepEqual(result.vipFixes, { changed: [], projects: ["packages/ai/tsconfig.json"], failed: [{ project: "packages/ai/tsconfig.json", code: 2 }] })
    assert.deepEqual(result.changed, ["package.json"])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("a predecessor baseline failure never repins an existing native project", async () => {
  // The baseline guard must run before the old compiler's one-time VIP rewrite.
  await fc.assert(fc.asyncProperty(fc.constantFrom(1, 2, 137), fc.boolean(), async (code, version) => {
    const root = mkdtempSync(join(tmpdir(), "migrate-vip-preflight-"))
    try {
      const { target, toolchain, base } = await fixture(root, { "tsconfig.json": "{}\n", "src/helper.vibe": "export const v = 1\n" })
      const manifest = readFileSync(join(target, "package.json"), "utf8")
      writeFileSync(join(target, "node_modules/.bin/vibelang"),
        "#!/bin/sh\n" + (version ? "" : 'if [ "$1" = "--version" ]; then echo 0.0.11; exit 0; fi\n') + "exit " + code + "\n")
      await assert.rejects(upgradeEffect({ run: join(root, "run"), target, packages: ["."], test: "true", toolchain, install: "true", base }))
      assert.equal(readFileSync(join(target, "package.json"), "utf8"), manifest)
      assert.equal(readFileSync(join(target, "src/helper.vibe"), "utf8"), "export const v = 1\n")
    } finally { rmSync(root, { recursive: true, force: true }) }
  }), { seed: 1049759, numRuns: 12 })
})
