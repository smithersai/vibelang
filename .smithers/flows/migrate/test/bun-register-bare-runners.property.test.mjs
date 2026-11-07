import assert from "node:assert/strict"
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { bareRunnerDeferrals, scriptEntries } from "../lib/bare-runners.mjs"
import { planScope } from "../lib/onepass.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-bun-register.json", import.meta.url)))
const register = "vibelang-unplugin/bun/register"
const repository = files => {
  const root = mkdtempSync(join(tmpdir(), "bun-register-runner-"))
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true })
    writeFileSync(join(root, file), text)
    if (text.startsWith("#!")) chmodSync(join(root, file), 0o755)
  }
  return root
}

test("a published Bun register preload lets reached modules enter the conversion plan", () => {
  const root = repository(corpus.files)
  try {
    const runners = bareRunnerDeferrals(root, corpus.selected)
    assert.deepEqual(runners.deferred, [])
    assert.equal(runners.entries.length, 0)
    assert.deepEqual(planScope(root, corpus.selected).batches[0].files, corpus.selected)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("the published Bun register is recognized on Bun command flags", () => {
  for (const flag of ["--preload ", "--preload="]) {
    assert.equal(scriptEntries("bun " + flag + register + " cli.ts")[0].wired, true)
    assert.equal(scriptEntries("node --import=" + register + " cli.ts")[0].wired, false)
  }

})

test("preload discovery respects the Bun section, runner and exact register specifier", () => {
  fc.assert(fc.property(
    fc.constantFrom("top", "test", "comment"),
    fc.constantFrom(register, "vibelang/bun", register + "/extra", "other-" + register, register + "-extra"),
    fc.constantFrom("bun", "node"),
    fc.constantFrom('"', "'"),
    fc.constantFrom("", " ", "  "),
    (section, specifier, runner, quote, space) => {
      const manifest = JSON.parse(corpus.files["tools/package.json"])
      manifest.scripts.dev = runner + " cli.ts"
      delete manifest.bin
      const files = {
        ...corpus.files,
        "tools/package.json": JSON.stringify(manifest),
        "tools/cli.ts": "import { value } from './value.ts'\nconsole.log(value)\n",
        "tools/bunfig.toml": (section === "test" ? "[test]\n" : section === "comment" ? "#" : "") +
          space + "preload = [" + quote + specifier + quote + "]\n",
      }
      const root = repository(files)
      try {
        const deferred = bareRunnerDeferrals(root, corpus.selected).deferred
        const serves = runner === "bun" && section === "top" && [register, "vibelang/bun"].includes(specifier)
        assert.equal(deferred.length === 0, serves, JSON.stringify({ section, specifier, runner, quote, space }))
      } finally { rmSync(root, { recursive: true, force: true }) }
    }
  ), { seed: 749311, numRuns: 240 })
})
