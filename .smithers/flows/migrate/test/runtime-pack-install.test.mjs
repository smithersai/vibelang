import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { makeConfig, wireTarget } from "../lib/steps.mjs"
import { tarballFiles } from "../lib/upgrade.mjs"
import * as Wire from "../lib/wire.mjs"
import { must, quote, run, writeJson } from "../lib/util.mjs"

const require = createRequire(new URL("../../../../packages/runtime/package.json", import.meta.url))
const typescript = dirname(require.resolve("typescript/package.json"))
const corpus = JSON.parse(readFileSync(new URL("./corpus/alchemy-packed-runtime-file-dependency.json", import.meta.url)))
const compilerCorpus = JSON.parse(readFileSync(new URL("./corpus/opencode-packed-source-child-compiler.json", import.meta.url)))
const effectVersion = JSON.parse(readFileSync(new URL("../../../../packages/runtime/package.json", import.meta.url))).peerDependencies.effect
async function packed(dir, out) {
  const result = await must("npm pack --ignore-scripts --json --pack-destination " + quote(out), { cwd: dir })
  return join(out, JSON.parse(result.stdout)[0].filename)
}

for (const manager of ["npm", "pnpm", "bun"]) for (const compilerRuntime of [false, true]) {
  test("public pack: " + manager + " development, registry consumers" + (compilerRuntime ? ", source-child sibling" : ""), { timeout: 120_000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), "alchemy-runtime-pack-"))
    let server
    try {
      const target = join(root, "target"), stage = join(root, "toolchain"), logs = join(root, "logs"), packs = join(root, "packs")
      for (const dir of [target, stage, logs, packs]) mkdirSync(dir)
      const runtimeDir = join(root, "runtime"), compilerDir = join(root, "compiler"), effectDir = join(root, "effect")
      mkdirSync(runtimeDir); mkdirSync(compilerDir); mkdirSync(effectDir)
      const effectManifest = { name: compilerCorpus.publishedDependency, version: effectVersion, type: "module", exports: "./index.js", files: ["index.js"] }
      writeJson(join(effectDir, "package.json"), effectManifest)
      writeFileSync(join(effectDir, "index.js"), "export {}\n")
      const runtimeManifest = { name: "vibelang-runtime", version: corpus.runtimeVersion, type: "module", exports: "./index.js", files: ["index.js"] }
      writeJson(join(runtimeDir, "package.json"), runtimeManifest)
      writeFileSync(join(runtimeDir, "index.js"), 'export const marker = "from-runtime"\n')
      const compilerManifest = { name: "vibelang", version: compilerCorpus.version, bin: { vibelang: "cli.mjs", "vibelang-format": "cli.mjs" }, exports: { "./register": "./register.mjs", "./bun": "./register.mjs" }, files: ["cli.mjs", "register.mjs"] }
      writeJson(join(compilerDir, "package.json"), compilerManifest)
      writeFileSync(join(compilerDir, "cli.mjs"), '#!/usr/bin/env node\nif (process.argv.includes("--version")) console.log("0.0.11")\n', { mode: 0o755 })
      writeFileSync(join(compilerDir, "register.mjs"), 'globalThis.__registryCompiler = "loaded"\n')
      const runtimeTgz = await packed(runtimeDir, stage), compilerTgz = await packed(compilerDir, stage), effectTgz = await packed(effectDir, stage)
      mkdirSync(join(stage, "native"))
      writeFileSync(join(stage, "native/vibelang"), "#!/bin/sh\nexit 0\n", { mode: 0o755 })
      mkdirSync(join(stage, "node_modules"))
      symlinkSync(typescript, join(stage, "node_modules/typescript"), "dir")
      writeJson(join(stage, "toolchain.json"), { version: corpus.runtimeVersion, effect: effectVersion, commit: "0123456789abcdef0123456789abcdef0123456789", compiler: "native/vibelang", packages: { vibelang: compilerTgz.slice(stage.length + 1), "vibelang-runtime": runtimeTgz.slice(stage.length + 1) } })
      const entries = [
        { manifest: runtimeManifest, bytes: readFileSync(runtimeTgz), archive: "/runtime.tgz" },
        { manifest: compilerManifest, bytes: readFileSync(compilerTgz), archive: "/compiler.tgz" },
        { manifest: effectManifest, bytes: readFileSync(effectTgz), archive: "/effect.tgz" }
      ], requests = []
      let registryOpen = false
      server = createServer((request, response) => {
        const path = new URL(request.url, "http://fixture").pathname
        requests.push(path)
        // Effect is already published; only the staged VibeLang SDK is withheld.
        const publishedEffect = path === "/" + effectManifest.name || path === "/" + effectManifest.name + "/" + effectManifest.version || path === "/effect.tgz"
        if (!registryOpen && !publishedEffect) { response.writeHead(404); response.end(JSON.stringify({ error: "release is not published yet" })); return }
        const entry = entries.find(entry => path === "/" + entry.manifest.name || path === "/" + entry.manifest.name + "/" + entry.manifest.version)
        if (entry) {
          const origin = "http://127.0.0.1:" + server.address().port
          const manifest = { ...entry.manifest, dist: { tarball: origin + entry.archive, integrity: "sha512-" + createHash("sha512").update(entry.bytes).digest("base64") } }
          response.setHeader("content-type", "application/json")
          response.end(JSON.stringify(path.endsWith("/" + manifest.version) ? manifest : { name: manifest.name, "dist-tags": { latest: manifest.version }, versions: { [manifest.version]: manifest } }))
        } else {
          const archive = entries.find(entry => path === entry.archive)
          if (archive) { response.setHeader("content-type", "application/octet-stream"); response.end(archive.bytes) }
          else { response.writeHead(404); response.end(JSON.stringify({ error: "fixture package not found" })) }
        }
      })
      await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve) })
      const registry = "http://127.0.0.1:" + server.address().port
      const env = { NODE_OPTIONS: "", npm_config_userconfig: join(root, "npmrc"), npm_config_cache: join(root, "npm-cache"), npm_config_registry: registry }
      writeFileSync(env.npm_config_userconfig, "registry=" + registry + "\nfetch-retries=0\naudit=false\nfund=false\n")
      const publicDir = compilerRuntime ? join(target, "packages/child") : target
      mkdirSync(publicDir, { recursive: true })
      const publicName = compilerRuntime ? compilerCorpus.manifest.name : corpus.manifest.name
      writeJson(join(target, "package.json"), compilerRuntime ? { name: "private-app", version: "1.0.0", private: true, workspaces: ["packages/*"] } : { ...corpus.manifest, files: ["index.js", "index.vibe"], exports: "./index.js" })
      const code = 'export { marker } from "vibelang-runtime"\n'
      writeFileSync(join(target, "index.vibe"), code)
      writeFileSync(join(target, "index.js"), code)
      const publicCode = compilerRuntime ? 'export const marker = "from-child"\n' : code
      if (compilerRuntime) {
        writeJson(join(publicDir, "package.json"), { name: publicName, version: "1.0.0", type: "module", files: ["index.js", "index.vibe", "src"], exports: "./index.js" })
        writeFileSync(join(publicDir, "index.js"), publicCode)
        writeFileSync(join(publicDir, "index.vibe"), publicCode)
        mkdirSync(join(publicDir, "src"))
        writeFileSync(join(publicDir, "src/launcher.ts"), 'import { spawn } from "node:child_process"\nexport const launch = () => spawn(process.execPath, ["worker.ts"])\n')
        writeFileSync(join(publicDir, "src/worker.ts"), 'export const value = 1\n')
      }
      writeFileSync(join(target, ".gitignore"), ".vibelang-toolchain/\n")
      writeFileSync(join(target, ".npmrc"), "registry=" + registry + "\nfetch-retries=0\naudit=false\nfund=false\n")
      if (manager === "pnpm") {
        writeFileSync(join(target, "pnpm-workspace.yaml"), 'packages:\n  - "."\n  - "packages/*"\n')
        await must("pnpm install --lockfile-only --ignore-scripts --registry " + quote(registry), { cwd: target, env })
      } else if (manager === "bun") {
        // Bun does not write a lockfile for an empty root. Start with an
        // installed development compiler so this is an actual Bun project.
        const manifest = JSON.parse(readFileSync(join(target, "package.json"), "utf8"))
        manifest.devDependencies = { vibelang: "file:" + compilerTgz }
        writeJson(join(target, "package.json"), manifest)
        await must("bun install --lockfile-only --ignore-scripts --registry " + quote(registry), { cwd: target, env: { ...env, BUN_INSTALL_CACHE_DIR: join(root, "bun-local-cache") } })
      }
      writeJson(join(target, "tsconfig.json"), { compilerOptions: { target: "ES2022", module: "NodeNext", strict: true, skipLibCheck: true }, include: ["*.vibe"] })
      await must("jj git init && jj config set --repo user.name fixture && jj config set --repo user.email fixture@localhost", { cwd: target, env })
      assert.equal(Wire.packageManager((await import("node:fs")).readdirSync(target)), manager)
      const config = makeConfig({ target, packages: ["."], sources: ["."], toolchain: stage, test: "true", install: (manager === "bun" ? "BUN_INSTALL_CACHE_DIR=" + quote(join(root, "bun-local-cache")) + " " : "") + Wire.installCommand(manager) + " --ignore-scripts --registry " + quote(registry) })
      const setup = await wireTarget(config, logs)
      assert.equal(JSON.parse(readFileSync(join(target, "node_modules/vibelang-runtime/package.json"), "utf8")).version, corpus.runtimeVersion)
      assert.equal(requests.some(path => path.startsWith("/vibelang")), false, "development must work while the release is unpublished")
      const localManifest = readFileSync(join(publicDir, "package.json"), "utf8")
      if (compilerRuntime) {
        assert.equal(JSON.parse(localManifest).dependencies[effectManifest.name], effectVersion)
        assert.ok(requests.includes("/" + effectManifest.name), "development resolves already-published Effect while the SDK is withheld")
      }
      const artifact = await packed(publicDir, packs)
      registryOpen = true
      const names = compilerRuntime ? ["vibelang"] : ["vibelang-runtime"]
      for (const consumerManager of ["npm", "bun"]) {
        requests.length = 0
        const consumer = join(root, "empty-consumer-" + consumerManager)
        mkdirSync(consumer)
        writeJson(join(consumer, "package.json"), { private: true, type: "module" })
        const consumeEnv = { ...env, npm_config_cache: join(root, "consumer-npm-cache"), BUN_INSTALL_CACHE_DIR: join(root, "consumer-bun-cache") }
        const command = consumerManager === "npm" ? "npm install --ignore-scripts --no-audit --no-fund" : "bun add --ignore-scripts"
        const installed = await run(command + " --registry " + quote(registry) + " " + quote(artifact), { cwd: consumer, env: consumeEnv, timeoutMs: 30_000 })
        assert.equal(installed.code, 0, consumerManager + " packed consumer must install without the source checkout:\n" + installed.stderr)
        for (const name of names) assert.ok(requests.some(path => path === "/" + name || path.startsWith("/" + name + "/")), "consumer resolves " + name + " from the registry")
        const loaded = await must((consumerManager === "npm" ? "node --input-type=module -e " : "bun -e ") + quote('console.log((await import(' + JSON.stringify(publicName) + ')).marker)'), { cwd: consumer, env: consumeEnv })
        assert.equal(loaded.stdout, compilerRuntime ? "from-child\n" : "from-runtime\n")
        if (compilerRuntime) {
          const consumerRequire = createRequire(join(consumer, "node_modules", publicName, "package.json"))
          const effectMain = consumerRequire.resolve(effectManifest.name)
          assert.equal(JSON.parse(readFileSync(join(dirname(effectMain), "package.json"))).version, effectVersion)
          assert.ok(requests.includes("/compiler.tgz"))
          assert.equal((await must(quote(join(consumer, "node_modules/.bin/vibelang")) + " --version", { cwd: consumer, env: consumeEnv })).stdout, compilerCorpus.version + "\n")
          const loaderCommand = consumerManager === "npm" ? "node --import=vibelang/register -e " : "bun --preload=vibelang/bun -e "
          assert.equal((await must(loaderCommand + quote("console.log(globalThis.__registryCompiler)"), { cwd: consumer, env: consumeEnv })).stdout, "loaded\n")
        } else assert.ok(requests.includes("/runtime.tgz"))
      }
      const manifest = JSON.parse(tarballFiles(readFileSync(artifact))["package.json"])
      for (const name of names) {
        assert.equal(manifest.dependencies[name], corpus.runtimeVersion)
        if (manager === "npm") assert.match(JSON.parse(localManifest).devDependencies[name], /^file:/)
        else assert.equal(JSON.parse(localManifest).devDependencies?.[name], undefined)
      }
      assert.equal(readFileSync(join(publicDir, "package.json"), "utf8"), localManifest, "pack must not alter development pins")
      assert.equal(readFileSync(join(publicDir, "index.vibe"), "utf8"), publicCode)
      assert.equal(readFileSync(join(publicDir, "index.js"), "utf8"), publicCode)
      assert.deepEqual(setup.toolchainPublication.releaseRequired, names.map(name => ({ name, version: corpus.runtimeVersion })))
      if (compilerRuntime) assert.ok(setup.changed.includes("packages/child/package.json"), "receipt includes the unselected source-child package")
    } finally {
      if (server) await new Promise(resolve => server.close(resolve))
      rmSync(root, { recursive: true, force: true })
    }
  })
}
