import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { inSubmodule, ownedPaths, submodulePaths } from "../lib/wire.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const fc = require("fast-check")
// README, setup: what setup edits.
const quote = "and every Git submodule too: a commit cannot hold a submodule's edits"
const name = fc.stringMatching(/^[a-z][a-z0-9-]{0,8}$/)

function repository(files) {
  const root = mkdtempSync(join(tmpdir(), "migrate-submodules-"))
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  return root
}

// A repository whose workspace names packages of its own and packages inside
// Git submodules, as alchemy's names submodules/distilled/packages/*.
function layout({ own, submodules, style }) {
  const globs = ["packages/*", ...submodules.map((s) => s.dir + "/packages/*")]
  const files = {
    "package.json": JSON.stringify(style === "npm" ? { name: "root", private: true, workspaces: globs } : { name: "root", private: true }),
    ".gitmodules": submodules.map((s) => `[submodule "${s.dir}"]\n\tpath = ${s.dir}\n\turl = https://example.com/${s.dir}.git\n`).join("")
  }
  if (style === "pnpm") files["pnpm-workspace.yaml"] = "packages:\n" + globs.map((g) => `  - ${g}\n`).join("")
  const owned = [], foreign = []
  for (const p of own) {
    for (const f of ["package.json", "tsconfig.json", "src/a.vibe"]) { files[`packages/${p}/${f}`] = "{}\n"; owned.push(`packages/${p}/${f}`) }
  }
  for (const s of submodules) {
    files[`${s.dir}/.git`] = "gitdir: ../.git/modules/x\n"
    files[`${s.dir}/package.json`] = "{}\n"
    foreign.push(`${s.dir}/package.json`)
    for (const p of s.packages) {
      for (const f of ["package.json", "tsconfig.json", "src/b.vibe"]) { files[`${s.dir}/packages/${p}/${f}`] = "{}\n"; foreign.push(`${s.dir}/packages/${p}/${f}`) }
    }
  }
  return { files, owned, foreign }
}

function check(input) {
  const { files, owned, foreign } = layout(input)
  const root = repository(files)
  try {
    const own = ownedPaths(root)
    const submodules = submodulePaths(root)
    assert.deepEqual(submodules.sort(), input.submodules.map((s) => s.dir).sort())
    for (const path of owned) assert.ok(own(path), `setup owns ${path}`)
    for (const path of foreign) {
      assert.equal(own(path), false, `setup leaves ${path} as it is`)
      assert.ok(inSubmodule(submodules, path), `${path} is inside a submodule`)
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
}

test("alchemy-31: setup leaves every Git submodule as it is, even where a workspace names its packages", () => {
  assert.ok(readFileSync(new URL("../README.md", import.meta.url), "utf8").includes(quote), "update the quoted setup contract")
  const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-submodule-workspace.json", import.meta.url), "utf8"))
  check(corpus.input)
  fc.assert(fc.property(
    fc.record({
      own: fc.uniqueArray(name, { minLength: 1, maxLength: 4 }),
      submodules: fc.uniqueArray(fc.record({
        dir: fc.oneof(name, fc.tuple(name, name).map(([a, b]) => `${a}/${b}`)),
        packages: fc.uniqueArray(name, { minLength: 1, maxLength: 3 })
      }), { minLength: 1, maxLength: 3, selector: (s) => s.dir.split("/")[0] }),
      style: fc.constantFrom("pnpm", "npm")
    }).filter(({ submodules }) => submodules.every((s) => s.dir.split("/")[0] !== "packages")),
    check
  ), { numRuns: 60 })
})

test("a path is inside a submodule only under its directory", () => {
  assert.equal(inSubmodule(["submodules/distilled"], "submodules/distilled/packages/aws/package.json"), true)
  assert.equal(inSubmodule(["submodules/distilled"], "submodules/distilled"), true)
  assert.equal(inSubmodule(["submodules/distilled"], "submodules/distilled-other/package.json"), false)
  assert.equal(inSubmodule([], "packages/a/package.json"), false)
})
