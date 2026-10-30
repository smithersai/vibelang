import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

for (const linked of [true, false]) {
  test("CI refreshes a stale " + (linked ? "shared symlink" : "local install"), () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "vibe-ci-install-"))
    try {
      const root = path.join(temp, "checkout")
      const write = (name, text) => { fs.mkdirSync(path.dirname(name), { recursive: true }); fs.writeFileSync(name, text) }
      const executable = (name, text) => { write(name, text); fs.chmodSync(name, 0o755) }
      for (const file of ["ci.sh", "check-effect-install.mjs"]) {
        const src = new URL("./" + file, import.meta.url)
        if (fs.existsSync(src)) write(path.join(root, "scripts", file), fs.readFileSync(src))
      }
      const installed = (dir, version) => write(path.join(dir, "effect/package.json"), JSON.stringify({ version }))
      for (const dir of ["packages/runtime", "packages/compiler", "experiments", "docs/tools"]) {
        write(path.join(root, dir, "package.json"), JSON.stringify({ devDependencies: { effect: "4.1.0" } }))
        installed(path.join(root, dir, "node_modules"), "4.1.0")
      }
      write(path.join(root, "packages/runtime/package.json"), JSON.stringify({ peerDependencies: { effect: "4.1.0" } }))
      const runtime = path.join(root, "packages/runtime/node_modules")
      fs.rmSync(runtime, { recursive: true })
      const shared = path.join(temp, "shared/node_modules")
      installed(shared, "4.0.6")
      if (linked) fs.symlinkSync(shared, runtime, "dir")
      else installed(runtime, "4.0.6")
      const correct = path.join(temp, "matching/node_modules")
      installed(correct, "4.1.0")
      const experiments = path.join(root, "experiments/node_modules")
      fs.rmSync(experiments, { recursive: true })
      fs.symlinkSync(correct, experiments, "dir")
      write(path.join(root, "packages/ts-mapper/package.json"), JSON.stringify({ devDependencies: { typescript: "7.1.0-beta" } }))
      executable(path.join(root, "packages/ts-mapper/test/.cache/typescript-7.1.0-beta/node_modules/.bin/tsc"), "#!/bin/sh\nexit 0\n")
      write(path.join(root, ".smithers/package.json"), "{}")
      executable(path.join(root, ".smithers/node_modules/.bin/smthrs"), "#!/usr/bin/env node\nif(require(process.cwd()+'/packages/runtime/node_modules/effect/package.json').version!=='4.1.0')process.exit(9)\n")
      // This installer writes through symlinks: isolation assertions exercise CI.
      const installer = path.join(temp, "installer.mjs")
      write(installer, 'import fs from "node:fs";const dir=process.cwd();fs.appendFileSync(process.env.INSTALL_LOG,dir+"\\n");if(!dir.endsWith("/.smithers")){fs.mkdirSync("node_modules/effect",{recursive:true});fs.writeFileSync("node_modules/effect/package.json",JSON.stringify({version:"4.1.0"}));}')
      const bun = path.join(temp, "bin/bun")
      executable(bun, '#!/bin/sh\nexec node "$INSTALLER"\n')
      const log = path.join(temp, "installs.log")
      const run = spawnSync("sh", ["scripts/ci.sh", "//packages:runtime-dist", "--jobs", "8"], {
        cwd: root, encoding: "utf8", timeout: 10000,
        env: { ...process.env, PATH: path.dirname(bun) + ":" + process.env.PATH, INSTALLER: installer, INSTALL_LOG: log }
      })
      assert.equal(run.status, 0, run.stdout + run.stderr)
      assert.equal(JSON.parse(fs.readFileSync(path.join(runtime, "effect/package.json"))).version, "4.1.0")
      assert.equal(fs.lstatSync(runtime).isSymbolicLink(), false)
      assert.equal(JSON.parse(fs.readFileSync(path.join(shared, "effect/package.json"))).version, "4.0.6")
      assert.equal(fs.readlinkSync(experiments), correct)
      assert.deepEqual(fs.readFileSync(log, "utf8").trim().split("\n"), [path.join(root, ".smithers"), path.join(root, "packages/runtime")])
    } finally { fs.rmSync(temp, { recursive: true, force: true }) }
  })
}
