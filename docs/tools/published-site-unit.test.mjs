import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveSiteRelease, renderSiteRelease, installReferences, builtInstallProblems } from "./published-site.mjs"
const snapshot = JSON.parse(readFileSync(new URL("./testdata/npm-0.0.10.json", import.meta.url)))
test("npm latest overrides the candidate and registry failures never fall back", () => {
  const calls = []
  const npm = args => {
    calls.push(args)
    if (args.join(" ") === "vibelang version") return "0.0.10\n"
    if (args[1] === "versions") return JSON.stringify(snapshot.packages[args[0]].versions ?? [snapshot.packages[args[0]].version])
    if (args[0] === "vibelang@0.0.10") return JSON.stringify(snapshot.compiler)
    if (args[0] === "vibelang-runtime@0.0.10") return JSON.stringify(snapshot.runtime)
    return JSON.stringify(snapshot.packages[args[0].split("@0.0.10")[0]])
  }
  const resolved = resolveSiteRelease({ env: {}, npm })
  assert.deepEqual(resolved.compiler, snapshot.compiler)
  assert.deepEqual(resolved.runtime, snapshot.runtime)
  for (const [name, manifest] of Object.entries(snapshot.packages)) assert.equal(resolved.packages[name].version, manifest.version)
  assert.deepEqual(calls[0], ["vibelang", "version"])
  assert.throws(() => resolveSiteRelease({ env: {}, npm: () => { throw new Error("registry offline") } }), /registry offline/)
  assert.throws(() => resolveSiteRelease({ env: {}, npm: () => "" }), /invalid npm release/)
})
test("an explicit candidate override supports offline release rehearsals", () => {
  const dir = mkdtempSync(join(tmpdir(), "site-rehearsal-"))
  try {
    for (const [name, manifest] of [["compiler", { version: "9.8.7", optionalDependencies: { "@vibelang/cli-win32-x64": "9.8.7" } }], ["runtime", { version: "9.8.7", peerDependencies: { effect: "4.1.0" } }]]) {
      mkdirSync(join(dir, "packages", name), { recursive: true })
      writeFileSync(join(dir, "packages", name, "package.json"), JSON.stringify(manifest))
    }
    const release = resolveSiteRelease({ repository: dir, env: { VIBELANG_RELEASE_VERSION: "9.8.7" }, npm: () => { throw Error("must not contact npm") } })
    const page = renderSiteRelease("setup.md", "Version 0.0.11 publishes native packages for macOS, Linux and Windows on arm64 and x64.", release)
    assert.match(page, /Version 9.8.7.*Windows on x64/)
    assert.doesNotMatch(page, /WSL/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
test("HTML highlighting and all package managers expose every install pin", () => {
  for (const command of ["npm install", "npm i", "pnpm add", "bun add", "yarn add"]) {
    const refs = installReferences('<pre><span>' + command + ' --exact </span><span>vibelang@0.0.10</span> vibelang-runtime@0.0.11</pre>')
    assert.deepEqual(refs, [{ name: "vibelang", version: "0.0.10" }, { name: "vibelang-runtime", version: "0.0.11" }])
  }
})
test("the built-assets guard rejects each unpublished version or platform", () => {
  const dir = mkdtempSync(join(tmpdir(), "site-assets-"))
  try {
    writeFileSync(join(dir, "installation.html"), '<pre>npm install <span>vibelang@0.0.10</span></pre>')
    assert.deepEqual(builtInstallProblems(dir, snapshot), [])
    writeFileSync(join(dir, "installation.md"), "bun add vibelang-runtime@0.0.11\n| Windows | @vibelang/cli-win32-x64 |")
    const problems = builtInstallProblems(dir, snapshot)
    assert.equal(problems.length, 2)
    assert.match(problems.join("\n"), /vibelang-runtime@0.0.11/)
    assert.match(problems.join("\n"), /cli-win32-x64/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
test("site rendering preserves source notes and specs, hides only future release sections", () => {
  const text = "# Notes\n\n## 0.0.11 (unreleased)\nnpm install vibelang@0.0.11\n\n## 0.0.10\ncurrent\n\n## 0.0.9\nhistory\n"
  assert.equal(renderSiteRelease("setup/release-notes.md", text, snapshot), "# Notes\n\n## 0.0.10\ncurrent\n\n## 0.0.9\nhistory\n")
  assert.equal(renderSiteRelease("spec/tooling.md", text, snapshot), text)
  assert.equal(renderSiteRelease("vips/0001.md", text, snapshot), text)
  assert.throws(() => renderSiteRelease("setup/release-notes.md", "## 0.0.11\n", snapshot), /missing npm version/)
})
test("homepage badges and both platform tables follow the selected registry version", () => {
  for (const path of ["site/src/pages/index.mdx", "site/src/index.mdx"]) {
    const text = renderSiteRelease(path, "<strong>0.0.11</strong>\nVersion 0.0.11 provides native packages for macOS, Linux and Windows on arm64 and x64.", snapshot)
    assert.match(text, /<strong>0.0.10<\/strong>/)
    assert.match(text, /use WSL/)
    assert.doesNotMatch(text, /0.0.11/)
  }
  const table = "| Platform | Package | Rehearsed for 0.0.11 |\n| --- | --- | --- |\n| Windows | `@vibelang/cli-win32-x64` | No |\n"
  const before = renderSiteRelease("getting-started/004-installation.md", table, snapshot)
  assert.doesNotMatch(before, /win32/)
  for (const name of Object.keys(snapshot.compiler.optionalDependencies)) assert.ok(before.includes(name), name)
  const windows = { ...snapshot, compiler: { ...snapshot.compiler, optionalDependencies: { ...snapshot.compiler.optionalDependencies, "@vibelang/cli-win32-x64": "0.0.10" } } }
  assert.match(renderSiteRelease("getting-started/004-installation.mdx", table, windows), /cli-win32-x64/)
})
test("both HTML route layouts check published history and reject a future latest heading", () => {
  const dir = mkdtempSync(join(tmpdir(), "site-history-"))
  try {
    mkdirSync(join(dir, "setup/release-notes"), { recursive: true })
    const file = join(dir, "setup/release-notes/index.html")
    const history = "<h2>0.0.10</h2><pre>npm install vibelang@0.0.10</pre><h2>0.0.9</h2><pre>npm install vibelang@0.0.9</pre>"
    writeFileSync(file, history)
    const published = { ...snapshot, packages: { ...snapshot.packages, vibelang: { version: "0.0.10", versions: ["0.0.9", "0.0.10"] } } }
    assert.deepEqual(builtInstallProblems(dir, published), [])
    writeFileSync(file, "<h2>0.0.11 (unreleased)</h2><pre>npm install vibelang@0.0.11</pre>" + history)
    assert.ok(builtInstallProblems(dir, snapshot).some(p => p.includes("latest release notes")))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
test("malformed pins, unknown tags, and scoped native versions cannot escape the registry guard", () => {
  const dir = mkdtempSync(join(tmpdir(), "site-invalid-pins-"))
  try {
    for (const spec of ["vibelang@0.0", "vibelang@next", "@vibelang/cli-win32-x64@0.0.11"]) {
      writeFileSync(join(dir, "install.md"), "pnpm add " + spec)
      assert.ok(builtInstallProblems(dir, snapshot).length, spec)
    }
    writeFileSync(join(dir, "install.md"), "yarn add vibelang-runtime@latest")
    const newer = { ...snapshot, packages: { ...snapshot.packages, "vibelang-runtime": { version: "0.0.10", "dist-tags": { latest: "0.0.11" } } } }
    assert.ok(builtInstallProblems(dir, newer).some(p => p.includes("@latest differs")))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
test("every historical install pin must exist, while published history keeps its own version", () => {
  const dir = mkdtempSync(join(tmpdir(), "site-history-pins-"))
  const history = { ...snapshot, packages: { ...snapshot.packages, vibelang: { version: "0.0.10", versions: ["0.0.9", "0.0.10"] } } }
  try {
    const file = join(dir, "release-notes.md")
    const notes = old => "# Notes\n\n## 0.0.10\nnpm install vibelang@0.0.10\n\n## 0.0.9\nnpm install vibelang@" + old + "\n"
    writeFileSync(file, notes("0.0.9"))
    assert.deepEqual(builtInstallProblems(dir, history), [])
    writeFileSync(file, notes("0.0.99"))
    assert.ok(builtInstallProblems(dir, history).some(p => p.includes("vibelang@0.0.99")))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
test("rehearsal package mentions are not installation claims", () => {
  assert.deepEqual(installReferences("- The throwaway registry accepts @vibelang/cli-win32-x64 and @vibelang/cli-win32-arm64."), [])
  assert.ok(installReferences("npm install @vibelang/cli-win32-x64").some(ref => ref.name === "@vibelang/cli-win32-x64"))
})
