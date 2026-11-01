import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const source = fileURLToPath(new URL("./remote.sh", import.meta.url))
const directories = ["experiments", "docs/tools", "packages/runtime"]
const bun = spawnSync("sh", ["-c", "command -v bun"], { encoding: "utf8" }).stdout.trim()

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "vibelang remote installs-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const workspace = join(root, "workspace")
  const home = join(root, "remote home")
  const remote = join(home, "es-remote/workspace")
  const bin = join(root, "bin")
  const put = (name, contents) => {
    mkdirSync(dirname(name), { recursive: true })
    writeFileSync(name, contents)
  }
  const executable = (name, contents) => { put(name, contents); chmodSync(name, 0o755) }
  mkdirSync(join(workspace, ".jj"), { recursive: true })
  mkdirSync(join(workspace, "scripts"), { recursive: true })
  cpSync(source, join(workspace, "scripts/remote.sh"))
  // Exercise the generated remote shell with real local Bun installs, without
  // making an SSH connection. rsync is outside this preparation regression;
  // the remote fixture already contains the synchronized sources and lockfiles.
  executable(join(bin, "ssh"), "#!" + process.execPath + "\n" + [
    'const { spawnSync } = require("node:child_process")',
    'const home = JSON.stringify(process.env.FIXTURE_REMOTE_HOME)',
    'const command = process.argv.at(-1).replaceAll("$HOME", home).replaceAll("~/", home + "/")',
    'const result = spawnSync("sh", ["-c", command], { stdio: "inherit" })',
    'process.exit(result.status ?? 1)'
  ].join("\n"))
  executable(join(bin, "rsync"), "#!/bin/sh\nexit 0\n")
  executable(join(bin, "jj"), "#!/bin/sh\nprintf '%s\\n' scripts/remote.sh\n")
  // remote.sh creates a control directory even with the transport shim.
  executable(join(bin, "mkdir"), '#!/bin/sh\ncase "$1" in */.ssh/cm) exit 0 ;; esac\nexec /bin/mkdir "$@"\n')
  const env = { ...process.env, PATH: bin + delimiter + process.env.PATH, ES_REMOTE_HOST: "fixture.invalid",
    ES_REMOTE_KEY: join(root, "unused-key"), FIXTURE_REMOTE_HOME: home }
  const install = (directory, flags = []) => {
    const result = spawnSync(bun, ["install", "--silent", ...flags], { cwd: directory, env, encoding: "utf8", timeout: 30000 })
    assert.equal(result.status, 0, result.stdout + result.stderr)
  }
  const manifest = version => ({
    private: true,
    dependencies: { "fixture-tool": "file:" + join(root, "tool" + version) },
    scripts: { build: "node build.cjs" }
  })
  for (const version of [1, 2]) {
    put(join(root, "tool" + version, "package.json"), JSON.stringify({ name: "fixture-tool", version: version + ".0.0", main: "index.cjs" }))
    put(join(root, "tool" + version, "index.cjs"), "module.exports = " + version + "\n")
  }
  for (const name of directories) {
    const directory = join(remote, name)
    put(join(directory, "package.json"), JSON.stringify(manifest(1)))
    put(join(directory, "build.cjs"), 'require("node:fs").mkdirSync("dist", { recursive: true }); require("node:fs").writeFileSync("dist/index.js", "built")\n')
    install(directory)
  }
  put(join(remote, "packages/runtime/dist/index.js"), "already built")
  return {
    root, remote, put, install,
    upgrade(name, timing = "older") {
      const directory = join(remote, name)
      put(join(directory, "package.json"), JSON.stringify(manifest(2)))
      // Generate a real, consistent new lockfile without replacing the old
      // installation, as rsync does when a new source tree arrives.
      install(directory, ["--lockfile-only"])
      assert.equal(JSON.parse(readFileSync(join(directory, "node_modules/fixture-tool/package.json"))).version, "1.0.0")
      const stamp = new Date("2020-01-01T00:00:00Z")
      const manifestStamp = new Date(stamp.getTime() + (timing === "newer" ? 10000 : timing === "older" ? -10000 : 0))
      utimesSync(join(directory, "node_modules"), stamp, stamp)
      utimesSync(join(directory, "package.json"), manifestStamp, manifestStamp)
    },
    run() {
      return spawnSync("sh", [join(workspace, "scripts/remote.sh"), "node", "-e",
        'require("node:fs").writeFileSync("command-ran", "yes")'], {
        cwd: workspace, env, encoding: "utf8", timeout: 30000
      })
    },
    assertVersion(name, version) {
      assert.equal(JSON.parse(readFileSync(join(remote, name, "node_modules/fixture-tool/package.json"))).version, version + ".0.0")
    },
    assertRan() { assert.equal(readFileSync(join(remote, "command-ran"), "utf8"), "yes") }
  }
}

for (const name of directories) {
  for (const timing of ["older", "equal", "newer"]) {
    test("remote preparation refreshes " + name + " when the manifest mtime is " + timing, t => {
      const f = fixture(t)
      f.upgrade(name, timing)
      const result = f.run()
      assert.equal(result.status, 0, result.stdout + result.stderr)
      f.assertVersion(name, 2)
      f.assertRan()
    })
  }

  test("remote preparation repairs an incomplete " + name + " installation", t => {
    const f = fixture(t)
    rmSync(join(f.remote, name, "node_modules/fixture-tool"), { recursive: true })
    const stamp = new Date("2020-01-01T00:00:00Z")
    utimesSync(join(f.remote, name, "package.json"), stamp, stamp)
    const result = f.run()
    assert.equal(result.status, 0, result.stdout + result.stderr)
    f.assertVersion(name, 1)
    f.assertRan()
  })

  test("remote preparation restores a missing " + name + " installation", t => {
    const f = fixture(t)
    rmSync(join(f.remote, name, "node_modules"), { recursive: true })
    const result = f.run()
    assert.equal(result.status, 0, result.stdout + result.stderr)
    f.assertVersion(name, 1)
    f.assertRan()
  })

  test("remote preparation refuses an inconsistent " + name + " lockfile before the requested command", t => {
    const f = fixture(t)
    const file = join(f.remote, name, "package.json")
    const manifest = JSON.parse(readFileSync(file))
    manifest.dependencies["fixture-tool"] = "file:" + join(f.root, "tool2")
    f.put(file, JSON.stringify(manifest))
    const stamp = new Date("2020-01-01T00:00:00Z")
    utimesSync(file, stamp, stamp)
    const result = f.run()
    assert.notEqual(result.status, 0, result.stdout + result.stderr)
    assert.match(result.stderr, /lockfile|frozen/i)
    assert.equal(existsSync(join(f.remote, "command-ran")), false)
    f.assertVersion(name, 1)
  })

  test("remote preparation preserves a provisioned " + name + " installation symlink", t => {
    const f = fixture(t)
    f.upgrade(name)
    const modules = join(f.remote, name, "node_modules")
    const shared = join(f.root, "shared modules")
    cpSync(modules, shared, { recursive: true })
    rmSync(modules, { recursive: true })
    symlinkSync(shared, modules)
    const before = readFileSync(join(shared, "fixture-tool/package.json"), "utf8")
    const result = f.run()
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.equal(readFileSync(join(shared, "fixture-tool/package.json"), "utf8"), before)
    f.assertVersion(name, 1)
    f.assertRan()
  })
}

test("remote preparation runs the command with already current installs", t => {
  const f = fixture(t)
  const result = f.run()
  assert.equal(result.status, 0, result.stdout + result.stderr)
  for (const name of directories) f.assertVersion(name, 1)
  f.assertRan()
})


test("remote preparation tolerates absent optional package manifests", t => {
  const f = fixture(t)
  for (const name of directories) rmSync(join(f.remote, name, "package.json"))
  const result = f.run()
  assert.equal(result.status, 0, result.stdout + result.stderr)
  f.assertRan()
})
