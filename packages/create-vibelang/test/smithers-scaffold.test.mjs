import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const binPath = fileURLToPath(new URL("../bin/create-vibelang.mjs", import.meta.url))

test("--smithers generates valid WORKSPACE.ts, PACKAGE.ts, and package.json CI script", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "vibelang-smithers-scaffold-"))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const target = join(dir, "factory-app")
  const res = spawnSync(process.execPath, [binPath, target, "--smithers", "--no-install"], { encoding: "utf8" })
  assert.equal(res.status, 0, res.stderr)

  const pkg = JSON.parse(readFileSync(join(target, "package.json"), "utf8"))
  assert.equal(pkg.scripts.ci, "smthrs ci //...")
  assert.ok(pkg.devDependencies["@smthrs/cli"], "missing @smthrs/cli devDependency")
  assert.ok(pkg.devDependencies["@smthrs/targets"], "missing @smthrs/targets devDependency")

  const ws = readFileSync(join(target, "WORKSPACE.ts"), "utf8")
  assert.ok(ws.includes("S.Workspace("), "WORKSPACE.ts must declare S.Workspace")
  assert.ok(ws.includes("S.Cache("), "WORKSPACE.ts must declare S.Cache")
  assert.ok(ws.includes("discovery: { prune:"), "WORKSPACE.ts must prune generated dirs")

  const pkgTs = readFileSync(join(target, "PACKAGE.ts"), "utf8")
  assert.ok(pkgTs.includes("S.Package("), "PACKAGE.ts must declare S.Package")
  assert.ok(pkgTs.includes("S.Shell.Build("), "PACKAGE.ts must declare build target")
  assert.ok(pkgTs.includes("S.Shell.Test("), "PACKAGE.ts must declare test/check targets")
})
