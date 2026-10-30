// Registry integration check. Run explicitly before a release:
// VIBELANG_TEST_REGISTRY=1 node --test scripts/release/rehearse.test.mjs
// All publication goes to the script's throwaway loopback registry.
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const repo = fileURLToPath(new URL("../../", import.meta.url))
test("rehearsal publishes both scoped Windows packages to its isolated registry", {
  skip: !process.env.VIBELANG_TEST_REGISTRY,
  timeout: 240_000
}, (t) => {
  const root = mkdtempSync(join(tmpdir(), "vibelang-registry-test-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const scripts = join(root, "scripts/release")
  const tarballs = join(root, "dist-npm/tarballs")
  const source = join(root, "source/package")
  for (const dir of [scripts, tarballs, source]) mkdirSync(dir, { recursive: true })
  for (const file of ["rehearse.sh", "repack.mjs"]) copyFileSync(join(repo, "scripts/release", file), join(scripts, file))
  // This fixture checks registry routing; the real starter is exercised by rehearse.sh.
  writeFileSync(join(scripts, "check-app.sh"), "#!/bin/sh\necho registry-fixture-app-check\n")
  const names = ["@vibelang/cli-win32-x64", "@vibelang/cli-win32-arm64", "vibelang"]
  const version = "0.0.0"
  const packages = names.map(name => {
    writeFileSync(join(source, "package.json"), JSON.stringify({ name, version }))
    const file = name.replace("@", "").replace("/", "-") + "-" + version + ".tgz"
    execFileSync("tar", ["-czf", join(tarballs, file), "-C", join(root, "source"), "package"])
    return { name, version, file }
  })
  writeFileSync(join(tarballs, "manifest.json"), JSON.stringify({ version, packages }))
  const result = spawnSync("sh", [join(scripts, "rehearse.sh")], {
    encoding: "utf8", timeout: 210_000,
    env: { ...process.env, VIBELANG_SKIP: "" }
  })
  const evidence = result.stdout + result.stderr
  assert.equal(result.status, 0, evidence + String(result.error ?? ""))
  for (const name of names) assert.ok(evidence.includes("rehearse: published " + name + "@" + version), evidence)
  assert.match(evidence, /rehearse: PASS/)
})
