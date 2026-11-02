import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { loadTypeScript } from "../lib/declarations.mjs"
import { nodeBinScripts, wireNodeBins, workspaceNodeBins } from "../lib/node-bins.mjs"

const ts = loadTypeScript([fileURLToPath(new URL("../../../../packages/runtime/", import.meta.url))])
const put = (root, path, text) => {
  mkdirSync(dirname(join(root, path)), { recursive: true })
  writeFileSync(join(root, path), text)
}
const specsFor = () => ({ vibelang: "0.0.11" })

// smithers: `pnpm run target-index` runs `pnpm exec smthrs target …`, a Node
// bin of the workspace's @smthrs/cli that loads packages/smithers/src; once
// ControlNdjson was .vibe, Node could not load it without vibelang's loader.
test("smithers: a script that runs a workspace Node bin reaching migrated sources loads vibelang/register", (t) => {
  const corpus = JSON.parse(readFileSync(new URL("./corpus/smithers-workspace-bin-loader.json", import.meta.url), "utf8"))
  const root = mkdtempSync(join(tmpdir(), "migrate-node-bins-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const [path, text] of Object.entries(corpus.files)) put(root, path, text)
  mkdirSync(join(root, "node_modules/@smthrs"), { recursive: true })
  symlinkSync(join(root, "packages/smithers"), join(root, "node_modules/@smthrs/smithers"), "dir")
  const manifests = [".", "packages/cli", "packages/smithers", "packages/tools"].map((dir) => ({ dir }))
  assert.deepEqual([...workspaceNodeBins(root, manifests).keys()].sort(), ["lint-docs", "smthrs"])
  const result = wireNodeBins({ root, packages: [{ dir: "packages/smithers", sources: ["src"] }], manifests, ts, specsFor })
  assert.deepEqual(result, { changed: ["package.json"], bins: ["smthrs"] })
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
  assert.deepEqual(pkg.scripts, corpus.expected)
  assert.equal(pkg.devDependencies.vibelang, "0.0.11")
  // A rerun changes nothing.
  assert.deepEqual(wireNodeBins({ root, packages: [{ dir: "packages/smithers", sources: ["src"] }], manifests, ts, specsFor }).changed, [])
})

test("nodeBinScripts keeps chaining, launchers and an existing NODE_OPTIONS", () => {
  const needed = new Set(["smthrs"])
  const { scripts, wired } = nodeBinScripts({
    a: "pnpm build && npx smthrs ci",
    b: "NODE_OPTIONS='--max-old-space-size=4096' smthrs flow start x",
    c: "NODE_OPTIONS=--import=vibelang/register smthrs target",
    d: "(smthrs check) || echo failed",
    e: "smthrsx run; smthrs-other run",
    f: "pnpm --filter x run smthrs"
  }, needed)
  assert.deepEqual(scripts, {
    a: 'pnpm build && NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--import=vibelang/register" npx smthrs ci',
    b: "NODE_OPTIONS='--max-old-space-size=4096 --import=vibelang/register' smthrs flow start x",
    c: "NODE_OPTIONS=--import=vibelang/register smthrs target",
    d: '(NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--import=vibelang/register" smthrs check) || echo failed',
    e: "smthrsx run; smthrs-other run",
    f: "pnpm --filter x run smthrs"
  })
  assert.deepEqual(wired, ["smthrs"])
})
