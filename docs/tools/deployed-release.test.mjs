import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { deployedReleaseProblems } from "./deployed-release.mjs"

const baseUrl = "https://docs.example/"
const registryUrl = "https://registry.example/vibelang/latest"
const version = "9.8.7"
const platforms = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"]
const manifest = { version, optionalDependencies: Object.fromEntries([...platforms, "win32-x64"].map(p => ["vibelang-" + p, version])) }
const latest = { ...manifest, optionalDependencies: Object.fromEntries(platforms.map(p => ["vibelang-" + p, version])) }
const support = "macOS and Linux on arm64 and x64. Native Windows binaries are not available yet; use WSL."
const output = "VibeLang 9.8.7 (TypeScript 7.1.0-dev)"
const install = `# Installation\nVersion ${version}\n${support}\n` + platforms.map(p => `| ${p} | \`vibelang-${p}\` |\n`).join("")
const pages = {
  "/": `<html><script>old cache 0.0.1</script><span>version</span><strong>${version}</strong><p>${support}</p></html>`,
  "/setup.md": `# Set up VibeLang\n${support}\nnpm i vibelang@${version}\nThe first prints \`${output}\`\n`,
  "/getting-started/004-installation": `<h1>Installation</h1><p>Version ${version}</p><p>${support}</p><table>${platforms.map(p => `<tr><td>${p}</td><td><code><span>vibelang-</span><span>${p}</span></code></td></tr>`).join("")}</table>`,
  "/getting-started/004-installation.md": install,
  "/llms.txt": "# VibeLang\n[Setup](/setup.md) [Installation](/getting-started/004-installation.md) [Notes](/setup/release-notes.md)",
  "/setup/release-notes": `<h1>Release notes</h1><h2 id="latest">${version}</h2><p>Changed from 0.0.2</p><h2>0.0.2</h2><p>vibelang@0.0.2</p>`,
  "/setup/release-notes.md": `# Release notes\n\n## ${version}\nChanges from 0.0.2\n\n## 0.0.2\nvibelang@0.0.2\n`
}
function fixture(overrides = {}, npm = latest, checkout = manifest) {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push([String(url), options])
    const body = String(url) === registryUrl ? JSON.stringify(npm) : { ...pages, ...overrides }[new URL(url).pathname]
    return new Response(body ?? "missing", { status: body === undefined ? 404 : 200 })
  }
  return { calls, check: () => deployedReleaseProblems({ baseUrl, registryUrl, manifest: checkout, typescriptVersion: "7.1.0-dev", fetchImpl }) }
}
test("checks every served surface and npm latest, ignoring historical releases and HTML metadata", async () => {
  const { check, calls } = fixture()
  assert.deepEqual(await check(), [])
  assert.deepEqual(calls.map(([url]) => new URL(url).pathname).sort(), [...Object.keys(pages), "/vibelang/latest"].sort())
  for (const [, options] of calls) {
    assert.equal(options.cache, "no-store")
    assert.equal(options.headers["Cache-Control"], "no-cache")
    assert.ok(options.signal)
  }
})
for (const path of Object.keys(pages)) {
  test("rejects a stale served pin on " + path, async () => {
    const replacement = path.includes("release-notes") ? pages[path].replaceAll(version, "0.0.2")
      : path === "/" ? pages[path].replaceAll(version, "0.0.1") : pages[path] + "\nnpm install vibelang-runtime@0.0.2"
    assert.ok((await fixture({ [path]: replacement }).check()).some(p => p.startsWith(path + ":")), path)
  })
}
test("checks JSON pins, every pin on a page, and expected CLI output including TypeScript", async () => {
  const bad = pages["/setup.md"] + '\n{"vibelang-vite": "0.0.1"}\nvibelang-unplugin@0.0.2\nVibeLang 9.8.7 (TypeScript 7.0.0)'
  const problems = await fixture({ "/setup.md": bad }).check()
  for (const pin of ["vibelang-vite", "vibelang-unplugin", "TypeScript 7.0.0"]) assert.ok(problems.some(p => p.includes(pin)), pin)
})
test("a missing expected CLI output cannot pass", async () => {
  assert.ok((await fixture({ "/setup.md": pages["/setup.md"].replace(output, "") }).check()).some(p => p.includes("expected --version output")))
})
test("a correct npm query pin cannot hide a stale expected npm version", async () => {
  assert.ok((await fixture({ "/setup.md": pages["/setup.md"] + '\nRun `npm view vibelang@9.8.7 version` and expect `0.0.2`.' }).check()).some(p => p.includes("npm view")))
})
for (const path of ["/", "/setup.md", "/getting-started/004-installation", "/getting-started/004-installation.md"]) {
  test("rejects a native Windows platform claim on " + path, async () => {
    const bad = pages[path] + "\n| Windows on x64 | vibelang-win32-x64 |"
    assert.ok((await fixture({ [path]: bad }).check()).some(p => p.startsWith(path + ":") && p.includes("platform")))
  })
}
test("rejects missing published platforms and missing WSL guidance", async () => {
  const path = "/getting-started/004-installation.md"
  const bad = pages[path].replace(/.*vibelang-linux-arm64.*\n/, "").replace("WSL", "")
  const problems = await fixture({ [path]: bad }).check()
  assert.ok(problems.some(p => p.includes("linux-arm64")))
  assert.ok(problems.some(p => p.includes("WSL")))
})
test("npm latest must match the checkout and published platforms must be in its manifest", async () => {
  assert.ok((await fixture({}, { ...latest, version: "9.8.8" }).check()).some(p => p.includes("npm latest") && p.includes("9.8.8")))
  const extra = { ...latest, optionalDependencies: { ...latest.optionalDependencies, "vibelang-freebsd-x64": version } }
  assert.ok((await fixture({}, extra).check()).some(p => p.includes("manifest") && p.includes("freebsd-x64")))
})
test("reports all HTTP failures and keeps checking other pages", async () => {
  const problems = await fixture({ "/": undefined, "/setup.md": undefined }).check()
  assert.ok(problems.some(p => p.startsWith("/:") && p.includes("404")))
  assert.ok(problems.some(p => p.startsWith("/setup.md:") && p.includes("404")))
})
test("registry failure is actionable and does not suppress served version mismatches", async () => {
  const fetchImpl = async url => String(url) === registryUrl ? new Response("unavailable", { status: 503 })
    : new Response(pages[new URL(url).pathname].replaceAll(version, "0.0.2"))
  const problems = await deployedReleaseProblems({ baseUrl, registryUrl, manifest, typescriptVersion: "7.1.0-dev", fetchImpl })
  assert.ok(problems.some(p => p.includes("npm latest") && p.includes("503")))
  assert.ok(problems.some(p => p.startsWith("/setup.md:")))
})
test("direct npm deploy and the release docs wrapper both use the postdeploy check", () => {
  const pkg = JSON.parse(readFileSync(new URL("../../site/package.json", import.meta.url), "utf8"))
  assert.match(pkg.scripts.postdeploy ?? "", /node .*docs\/tools\/deployed-release\.mjs/)
  const wrapper = readFileSync(new URL("../../scripts/deploy-docs.sh", import.meta.url), "utf8")
  assert.match(wrapper, /npm run deploy/)
})

test("a stale homepage badge cannot hide behind correct release prose", async () => {
  const bad = pages["/"].replace("<strong>9.8.7</strong>", "<strong>0.0.1</strong>") + " Version 9.8.7"
  assert.ok((await fixture({ "/": bad }).check()).some(p => p.includes("release label version 0.0.1")))
})


test("scoped Windows packages are recognized only when published", async () => {
  const windows = ["@vibelang/cli-win32-arm64", "@vibelang/cli-win32-x64"]
  const npm = { ...latest, optionalDependencies: { ...latest.optionalDependencies, ...Object.fromEntries(windows.map(p => [p, version])) } }
  const updated = Object.fromEntries(Object.entries(pages).map(([path, text]) => [path,
    text.replace(support, "macOS, Linux and native Windows on arm64 and x64.") +
      (path.startsWith("/getting-started/") ? windows.map(p => `\n| Windows | ${p} |`).join("") : "")
  ]))
  assert.deepEqual(await fixture(updated, npm, npm).check(), [])
  assert.ok((await fixture({ "/setup.md": pages["/setup.md"] + "\n@vibelang/cli-win32-x64" }).check()).some(p => p.includes("absent from npm latest")))
})
