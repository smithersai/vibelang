import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const platforms = ["vibelang-darwin-arm64", "vibelang-darwin-x64", "vibelang-linux-arm64", "vibelang-linux-x64", "@smthrs/cli-win32-arm64", "@smthrs/cli-win32-x64"]
const names = ["vibelang", ...platforms, "vibelang-runtime", "vibelang-vite", "create-vibelang", "vibelang-unplugin"]
const version = "0.0.13"

async function fixture(t, change = () => {}) {
  const root = mkdtempSync(join(tmpdir(), "vibelang-verify-test-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const scripts = join(root, "scripts/release")
  mkdirSync(scripts, { recursive: true })
  cpSync(new URL("./verify-published.sh", import.meta.url), join(scripts, "verify-published.sh"))
  const appCalls = join(root, "app-calls")
  writeFileSync(join(scripts, "check-app.sh"), '#!/bin/sh\nprintf "%s\\n" "$@" >"' + appCalls + '"\n')
  // The site check is stubbed here; the tests below run the real live-site.mjs.
  const siteCalls = join(root, "site-calls")
  writeFileSync(join(scripts, "live-site.mjs"), 'import { existsSync, writeFileSync } from "node:fs"\n' +
    'writeFileSync(' + JSON.stringify(siteCalls) + ', JSON.stringify({ args: process.argv.slice(2), afterApp: existsSync(' + JSON.stringify(appCalls) + ') }))\n')
  const manifests = Object.fromEntries(names.map(name => [name, {
    name, version, _from: "file:/tmp/vibelang-publish.release/package.tgz",
    _resolved: "/tmp/vibelang-publish.release/package.tgz",
    optionalDependencies: name === "vibelang" ? Object.fromEntries(platforms.map(name => [name, version])) : undefined
  }]))
  change(manifests)
  const requests = []
  const server = createServer((req, res) => {
    const [prefix, encodedName, requestedVersion] = req.url.slice(1).split("/")
    const name = decodeURIComponent(encodedName ?? "")
    requests.push(name)
    const manifest = prefix === "registry" && requestedVersion === version ? manifests[name] : undefined
    res.writeHead(manifest ? 200 : 404, { "content-type": "application/json" })
    res.end(JSON.stringify(manifest ?? { error: "not found" }))
  })
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
  t.after(() => server.close())
  const registry = `http://127.0.0.1:${server.address().port}/registry/`
  const result = await new Promise((resolve, reject) => {
    const child = spawn("sh", [join(scripts, "verify-published.sh"), version], {
      env: { ...process.env, VIBELANG_REGISTRY: registry, VIBELANG_SITE_URL: "http://127.0.0.1:9/site" }, timeout: 30_000
    })
    let stdout = "", stderr = ""
    child.stdout.on("data", chunk => { stdout += chunk })
    child.stderr.on("data", chunk => { stderr += chunk })
    child.on("error", reject)
    child.on("close", status => resolve({ status, stdout, stderr }))
  })
  return { ...result, requests, appCalls, siteCalls, registry }
}

test("clean metadata checks all eleven release packages and forwards the configured registry", async t => {
  const result = await fixture(t)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.deepEqual(result.requests, names)
  assert.deepEqual(readFileSync(result.appCalls, "utf8").trim().split("\n"),
    [result.registry, version, "npm", "bun"])
  const site = JSON.parse(readFileSync(result.siteCalls, "utf8"))
  assert.equal(site.afterApp, true, "the live-site check runs after the app check")
  assert.deepEqual(site.args.slice(0, 4), ["--version", version, "--registry", result.registry])
  assert.equal(site.args.at(-1), "http://127.0.0.1:9/site")
})

for (const field of ["_from", "_resolved", "metadata.nested.0.source"]) {
  for (const segment of ["Users", "home"]) {
    test(field + " containing a " + segment + " path names the package and field and stops verification", async t => {
      const result = await fixture(t, manifests => {
        const manifest = manifests["vibelang-unplugin"]
        const path = join("/", segment, "publisher", "bundle", "package.tgz")
        if (field.startsWith("metadata")) manifest.metadata = { nested: [{ source: "file:" + path }] }
        else manifest[field] = "file:" + path
      })
      assert.equal(result.status, 1, result.stdout + result.stderr)
      assert.ok(result.stderr.includes("vibelang-unplugin@" + version), result.stderr)
      assert.ok(result.stderr.includes(field), result.stderr)
      assert.match(result.stderr, /home path/)
      assert.equal(existsSync(result.appCalls), false, "app checks do not run after unsafe metadata")
      assert.equal(existsSync(result.siteCalls), false, "the site check does not run after unsafe metadata")
    })
  }
}

test("a missing package manifest fails before app verification", async t => {
  const result = await fixture(t, manifests => { delete manifests["vibelang-runtime"] })
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stderr, /vibelang-runtime@0\.0\.13.*404/)
  assert.equal(existsSync(result.appCalls), false)
})

// verify-published.sh runs against a local registry and a local docs site. The
// app scaffold is stubbed; the site check is the real live-site.mjs.
const checkout = fileURLToPath(new URL("../../", import.meta.url))
const siteVersion = "9.8.7"
const typescript = /var version = "([^"]+)"/.exec(readFileSync(join(checkout, "typescript/tsc/internal/core/version.go"), "utf8"))[1]
const sitePlatforms = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"]
const siteManifest = { name: "vibelang", version: siteVersion, optionalDependencies: Object.fromEntries(sitePlatforms.map(p => ["vibelang-" + p, siteVersion])) }
const support = "macOS and Linux on arm64 and x64. Native Windows binaries are not available yet; use WSL."
const installPage = release => `<h1>Installation</h1><p>Version ${release} installs from npm.</p><p>Rehearsed for ${release}.</p>` +
  `<pre>npm install vibelang@${release} vibelang-runtime@${release}</pre><p>${support}</p>` +
  `<table>${sitePlatforms.map(p => `<tr><td>${p}</td><td><code>vibelang-${p}</code></td></tr>`).join("")}</table>`
const site = release => ({
  "/": `<html><span>version</span><strong>${release}</strong><p>${support}</p></html>`,
  "/setup.md": `# Set up VibeLang\n${support}\nnpm i vibelang@${release}\nThe first prints \`VibeLang ${release} (TypeScript ${typescript})\`\n`,
  "/getting-started/004-installation": installPage(release),
  "/getting-started/004-installation.md": `# Installation\nVersion ${release}\n${support}\n` + sitePlatforms.map(p => `| ${p} | \`vibelang-${p}\` |\n`).join(""),
  "/llms.txt": "# VibeLang\n[Setup](/setup.md) [Installation](/getting-started/004-installation.md) [Notes](/setup/release-notes.md)",
  "/setup/release-notes": `<h1>Release notes</h1><h2>${release}</h2><p>Changes.</p>`,
  "/setup/release-notes.md": `# Release notes\n\n## ${release}\nChanges.\n`,
  "/sitemap.xml": "<urlset><url><loc>https://vibelang.sh/</loc></url><url><loc>https://vibelang.sh/getting-started/004-installation</loc></url></urlset>"
})

async function withFixture(pages, registry, check, { bundle = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "verify-published-"))
  const server = createServer((request, response) => {
    const path = new URL(request.url, "http://localhost").pathname
    const body = path.startsWith("/registry/") ? registry[path.slice("/registry/".length)] : pages[path]
    response.writeHead(body === undefined ? 404 : 200).end(body === undefined ? "missing" : typeof body === "string" ? body : JSON.stringify(body))
  })
  await new Promise(done => server.listen(0, "127.0.0.1", done))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    mkdirSync(join(dir, "scripts/release"), { recursive: true })
    // A checkout, or a release bundle: a copy of scripts/release/ and nothing else.
    for (const file of ["verify-published.sh", "live-site.mjs"]) copyFileSync(join(checkout, "scripts/release", file), join(dir, "scripts/release", file))
    writeFileSync(join(dir, "scripts/release/check-app.sh"), '#!/bin/sh\necho "$@" > "$(dirname "$0")/check-app.args"\n')
    chmodSync(join(dir, "scripts/release/check-app.sh"), 0o755)
    if (!bundle) for (const path of ["docs", "typescript"]) symlinkSync(join(checkout, path), join(dir, path))
    const child = spawn("sh", [join(dir, "scripts/release/verify-published.sh"), siteVersion], {
      env: { ...process.env, VIBELANG_REGISTRY: base + "/registry/", VIBELANG_SITE_URL: base }
    })
    let output = ""
    child.stdout.on("data", chunk => { output += chunk })
    child.stderr.on("data", chunk => { output += chunk })
    const status = await new Promise(done => child.on("close", done))
    await check({ status, output, checkApp: existsSync(join(dir, "scripts/release/check-app.args")) ? readFileSync(join(dir, "scripts/release/check-app.args"), "utf8").trim() : undefined, base })
  } finally {
    server.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

const published = { ["vibelang/" + siteVersion]: siteManifest, "vibelang/latest": siteManifest,
  ...Object.fromEntries([...sitePlatforms.map(p => "vibelang-" + p), "vibelang-runtime", "vibelang-vite", "create-vibelang", "vibelang-unplugin"]
    .map(name => [name + "/" + siteVersion, { name, version: siteVersion }])) }

test("a live installation page that still names the previous release fails verification", async () => {
  await withFixture({ ...site(siteVersion), "/getting-started/004-installation": installPage("0.0.12") }, published, ({ status, output, checkApp, base }) => {
    assert.equal(status, 1, output)
    assert.equal(checkApp, `${base}/registry/ ${siteVersion} npm bun`)
    assert.match(output, /\/getting-started\/004-installation: release label Version 0\.0\.12; expected 9\.8\.7/)
    assert.match(output, /pin vibelang@0\.0\.12; expected 9\.8\.7/)
    assert.match(output, /Deploy it with: sh scripts\/release\/deploy-site\.sh 9\.8\.7/)
  })
})

test("a live site that describes the published release passes verification", async () => {
  await withFixture(site(siteVersion), published, ({ status, output }) => {
    assert.equal(status, 0, output)
    assert.match(output, /live-site: served docs match compiler 9\.8\.7/)
    assert.match(output, /9\.8\.7 registry manifests contain no publisher home paths/)
    assert.match(output, /VibeLang 9\.8\.7 installs from .* and http:\/\/127\.0\.0\.1:\d+ describes it/)
  })
})

test("an unpublished version stops at the registry manifest check", async () => {
  await withFixture(site(siteVersion), { "vibelang/latest": { ...siteManifest, version: "0.0.12" } }, ({ status, output, checkApp }) => {
    assert.equal(status, 1, output)
    assert.match(output, /vibelang@9\.8\.7: registry manifest request failed \(HTTP 404\)/)
    assert.equal(checkApp, undefined, "the app check does not run")
  })
})

test("verification runs from a release bundle that holds only scripts/release", async () => {
  await withFixture(site(siteVersion), published, ({ status, output }) => {
    assert.equal(status, 0, output)
    assert.match(output, /live-site: served docs match compiler 9\.8\.7/)
  }, { bundle: true })
  await withFixture({ ...site(siteVersion), "/getting-started/004-installation": installPage("0.0.12") }, published, ({ status, output }) => {
    assert.equal(status, 1, output)
    assert.match(output, /release label Version 0\.0\.12; expected 9\.8\.7/)
  }, { bundle: true })
})

test("a live page that still teaches vibelang --fix fails verification", async () => {
  await withFixture({ ...site(siteVersion), "/": site(siteVersion)["/"].replace("</html>", "<p>Then run vibelang --fix.</p></html>") }, published, ({ status, output }) => {
    assert.equal(status, 1, output)
    assert.match(output, /\/: teaches `vibelang --fix` 1 time\(s\)/)
  }, { bundle: true })
})

const releaseHistory = "- The `vibelang-runtime` package page told readers to run `vibelang --fix`, which the compiler rejects with `TS5023`. The page no longer mentions the option.\n- When the installed `effect` was not the version `vibelang-runtime` pins, the load error named `vibelang-runtime@0.0.11` whatever runtime was installed. It now names only the two Effect versions and the install command, as in `vibelang-runtime requires effect@4.1.1; found effect@4.1.0`."

for (const bundle of [false, true]) {
  for (const section of ["current", "older"]) {
    test("published verification accepts release-history pins and retired commands in the " + section + " section, bundle=" + bundle, async () => {
      const pages = site(siteVersion)
      for (const route of ["/setup/release-notes", "/setup/release-notes.md"]) {
        const html = !route.endsWith(".md")
        const history = html ? "<ul><li>" + releaseHistory.replace(/`(.*?)`/g, "<code>$1</code>").replace(/\n/g, "</li><li>") + "</li></ul>" : releaseHistory
        const heading = release => html ? "<h2>" + release + "</h2>" : "\n## " + release + "\n"
        pages[route] = heading(siteVersion) + (section === "current" ? history : "") + heading("0.0.12") + (section === "older" ? history : "")
      }
      pages["/sitemap.xml"] = pages["/sitemap.xml"].replace("</urlset>",
        "<url><loc>https://vibelang.sh/setup/release-notes</loc></url><url><loc>https://vibelang.sh/setup/release-notes.md</loc></url></urlset>")
      await withFixture(pages, published, ({ status, output }) => {
        assert.equal(status, 0, output)
        assert.match(output, /live-site: served docs match compiler 9\.8\.7/)
        assert.doesNotMatch(output, /mismatch|teaches/)
      }, { bundle })
    })
  }
  test("published verification rejects a stale runtime install command outside release notes, bundle=" + bundle, async () => {
    const pages = site(siteVersion)
    pages["/getting-started/004-installation"] += "<pre>npm install vibelang-runtime@0.0.11</pre>"
    await withFixture(pages, published, ({ status, output }) => {
      assert.equal(status, 1, output)
      assert.match(output, /\/getting-started\/004-installation: pin vibelang-runtime@0\.0\.11; expected 9\.8\.7/)
    }, { bundle })
  })
}
