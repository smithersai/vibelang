import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
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
      env: { ...process.env, VIBELANG_REGISTRY: registry }, timeout: 30_000
    })
    let stdout = "", stderr = ""
    child.stdout.on("data", chunk => { stdout += chunk })
    child.stderr.on("data", chunk => { stderr += chunk })
    child.on("error", reject)
    child.on("close", status => resolve({ status, stdout, stderr }))
  })
  return { ...result, requests, appCalls, registry }
}

test("clean metadata checks all eleven release packages and forwards the configured registry", async t => {
  const result = await fixture(t)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.deepEqual(result.requests, names)
  assert.deepEqual(readFileSync(result.appCalls, "utf8").trim().split("\n"),
    [result.registry, version, "npm", "bun"])
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
    })
  }
}

test("a missing package manifest fails before app verification", async t => {
  const result = await fixture(t, manifests => { delete manifests["vibelang-runtime"] })
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stderr, /vibelang-runtime@0\.0\.13.*404/)
  assert.equal(existsSync(result.appCalls), false)
})
