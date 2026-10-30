// Builds test/fixture with each bundler through vibelang-unplugin, runs the
// bundle, and checks its output, its source map, compiler diagnostics, and
// watch-mode recompiles. Run test/run.sh, which builds the compiler and the
// runtime and links the fixtures' node_modules first.
import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { once } from "node:events"
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { SourceMap } from "node:module"
import { availableParallelism, tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createInterface } from "node:readline"
import { after, describe, it } from "node:test"
import { fileURLToPath } from "node:url"
import { runChild } from "./child.mjs"

const here = fileURLToPath(new URL(".", import.meta.url))
const build = join(here, "build.mjs")
const expected = await readFile(join(here, "expected.txt"), "utf8")
const hasBun = spawnSync("bun", ["--version"]).status === 0

// The plugin compiles into os.tmpdir(). A compile that close() interrupts
// leaves its directory there; keep this run's directories in one place.
process.env.TMPDIR = await mkdtemp(join(tmpdir(), "vibelang-unplugin-test-"))
after(() => rm(process.env.TMPDIR, { recursive: true, force: true }))

// Bun.build has no watch mode.
const bundlers = {
  webpack: { bundle: "out/main.cjs", watch: true },
  rspack: { bundle: "out/main.cjs", watch: true },
  rollup: { bundle: "out/main.js", watch: true },
  rolldown: { bundle: "out/main.js", watch: true },
  esbuild: { bundle: "out/main.js", watch: true },
  bun: { bundle: "out/main.js", watch: false },
  vite: { bundle: "out/main.js", watch: true }
}

async function fixture(t, name) {
  // Fixtures share test/.fixtures/node_modules, which run.sh links.
  const root = await mkdtemp(join(here, ".fixtures", `${name}-`))
  t.after(() => rm(root, { recursive: true, force: true }))
  await cp(join(here, "fixture"), root, { recursive: true })
  return root
}

async function edit(file, from, to, watcher) {
  const source = await readFile(file, "utf8")
  assert.ok(source.includes(from), `${file} has no ${from}`)
  await writeFile(file, source.replace(from, to))
  watcher?.log(`edit ${file.split("/").at(-1)}: ${from} -> ${to}`)
}

async function spawned(command, args, cwd) {
  const { code, stdout, stderr } = await runChild(command, args, { cwd })
  return { code, stdout, stderr }
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const runtime = (bundler) => (bundler === "bun" ? "bun" : process.execPath)

async function bundleOnce(bundler, root) {
  const result = await spawned(runtime(bundler), ["--no-warnings", build, bundler], root)
  const line = result.stdout.trim().split("\n").at(-1)
  assert.ok(line?.startsWith("{"), `${bundler} printed no result\n${result.stdout}\n${result.stderr}`)
  return { code: result.code, event: JSON.parse(line), stderr: result.stderr }
}

async function runBundle(bundler, root) {
  const result = await spawned(runtime(bundler), [bundlers[bundler].bundle], root)
  assert.equal(result.code, 0, result.stderr)
  return result.stdout
}

// The bundle prints text once a rebuild has written it. A bundle that is
// still being written fails to run, which counts as not yet.
async function printsEventually(bundler, root, text) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const result = await spawned(runtime(bundler), [bundlers[bundler].bundle], root)
    if (result.code === 0 && result.stdout.includes(text)) return true
    await new Promise((accept) => setTimeout(accept, 100))
  }
  return false
}

function watchBundle(bundler, root, env = {}) {
  // close() checks ownership and stops the bundler and its compiler individually.
  const child = spawn(process.execPath, ["--no-warnings", build, bundler, "--watch"], {
    cwd: root, detached: true, env: { ...process.env, VIBELANG_UNPLUGIN_DEBUG: "1", ...env }
  })
  const started = Date.now()
  // The failure message shows each build result, edit, and trace line in order.
  const history = []
  const log = (text) => history.push(`+${Date.now() - started}ms ${text}`)
  createInterface({ input: child.stderr }).on("line", (line) => history.push(`  stderr: ${line}`))
  const events = []
  let wake = () => {}
  createInterface({ input: child.stdout }).on("line", (line) => {
    if (!line.startsWith("{")) return
    const event = JSON.parse(line)
    log(event.ok ? "build ok" : `build failed: ${event.message.split("\n")[0]}`)
    events.push(event)
    wake()
  })
  return {
    // Waits for a build event that passes check. Earlier events are skipped,
    // so a bundler that reports one change twice still passes.
    async next(what, check) {
      const deadline = Date.now() + 60000
      while (Date.now() < deadline) {
        while (events.length) {
          const event = events.shift()
          if (await check(event)) return event
        }
        await new Promise((accept) => { wake = accept; setTimeout(accept, 250) })
      }
      assert.fail(`${bundler} --watch: no build ${what} within 60s\n${history.join("\n")}`)
    },
    log,
    // Stops the bundler and any compile it started before the fixture is removed.
    async close() {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit")
        const parentOf = (pid) => Number(spawnSync("ps", ["-o", "ppid=", "-p", String(pid)], { encoding: "utf8" }).stdout?.trim())
        const stop = (pid, parent) => {
          if (parentOf(pid) !== parent) return
          const listing = spawnSync("ps", ["-eo", "pid=,ppid="], { encoding: "utf8" }).stdout || ""
          for (const line of listing.trim().split("\n")) {
            const [descendant, owner] = line.trim().split(/\s+/).map(Number)
            if (owner === pid) stop(descendant, pid)
          }
          if (parentOf(pid) === parent) {
            try { process.kill(pid) } catch (error) { if (error.code !== "ESRCH") throw error }
          }
        }
        stop(child.pid, process.pid)
        await exited
      }
    }
  }
}

// Edits a .vibe source, a type-only .ts import, and the tsconfig under a
// running watcher, and waits for the rebuild each edit causes.
async function watchEdits(bundler, root, watcher) {
  // Each edit waits for the bundler to re-arm its watcher after a build.
  // webpack before 5.112.0 misses a save made as a build finishes
  // (webpack/webpack#22646); that race is webpack's, not the plugin's.
  const settle = (ms = 500) => new Promise((accept) => setTimeout(accept, ms))
  await watcher.next("success", (event) => event.ok)
  assert.ok(await printsEventually(bundler, root, expected))
  await settle(1000)

  await edit(join(root, "src/shop.vibe"), 'receipt("ordered"', 'receipt("booked"', watcher)
  await watcher.next("with the .vibe edit", (event) => event.ok && printsEventually(bundler, root, "booked 2 tea"))

  // order.ts is a type-only import: only the compiler reads it.
  const order = join(root, "src/order.ts")
  await settle()
  await edit(order, "quantity: number", "quantity: string", watcher)
  const failed = await watcher.next("failure after the .ts edit", (event) => !event.ok)
  assert.match(failed.message, new RegExp(`${escape(join(root, "src/shop.vibe"))}:\\d+:\\d+ - error TS\\d+`))
  await settle()
  await edit(order, "quantity: string", "quantity: number", watcher)
  await watcher.next("success after the .ts fix", (event) => event.ok)

  const tsconfig = join(root, "tsconfig.json")
  await settle()
  await edit(tsconfig, '"types": []', '"types": ["missing-types"]', watcher)
  const broken = await watcher.next("failure after the tsconfig edit", (event) => !event.ok)
  assert.match(broken.message, /error TS2688: Cannot find type definition file for 'missing-types'/)
  await settle()
  await edit(tsconfig, '"types": ["missing-types"]', '"types": []', watcher)
  await watcher.next("success after the tsconfig fix", (event) => event.ok && printsEventually(bundler, root, "booked 2 tea"))
}

const concurrency = Math.max(2, Math.min(8, availableParallelism() >> 1))

describe("vibelang-unplugin", { concurrency }, () => {
  for (const [bundler, { bundle, watch }] of Object.entries(bundlers)) {
    const skip = bundler === "bun" && !hasBun && "bun is not installed"

    it(`${bundler}: builds the fixture, runs it, and maps it to .vibe sources`, { skip }, async (t) => {
      const root = await fixture(t, bundler)
      const result = await bundleOnce(bundler, root)
      assert.deepEqual(result.event, { ok: true }, result.stderr)
      assert.equal(result.code, 0)
      assert.equal(await runBundle(bundler, root), expected)

      // "coffee" is at shop.vibe line 32, column 19.
      const code = await readFile(join(root, bundle), "utf8")
      const payload = JSON.parse(await readFile(join(root, bundle + ".map"), "utf8"))
      const source = payload.sources.findIndex((path) => path.endsWith("src/shop.vibe"))
      assert.ok(source >= 0, `no shop.vibe in ${payload.sources.join(", ")}`)
      const lines = code.split("\n")
      const line = lines.findIndex((text) => /"coffee"/.test(text))
      const entry = new SourceMap(payload).findEntry(line, lines[line].indexOf('"coffee"'))
      assert.match(entry.originalSource, /src\/shop\.vibe$/)
      if (bundler === "bun") {
        // Bun ignores plugin source maps: its map points into the compiled JavaScript.
        assert.ok(!payload.sourcesContent[source].includes("service Inventory"))
        return
      }
      assert.ok(payload.sourcesContent[source].includes("service Inventory"), "the map embeds the .vibe source")
      assert.deepEqual([entry.originalLine + 1, entry.originalColumn + 1], [32, 19])
      // format.vibe's module declaration is a module of its own; its map names format.vibe (D403).
      const joined = lines.findIndex((text) => text.includes("String(quantity)"))
      assert.ok(joined >= 0, "the bundle holds format.vibe's module declaration")
      const body = new SourceMap(payload).findEntry(joined, lines[joined].indexOf("String(quantity)"))
      assert.match(body.originalSource, /src\/format\.vibe$/)
      assert.equal(body.originalLine + 1, 9)
    })

    if (bundler === "bun") {
      // Bun 1.4.2 stops resolving Bun.build's in-memory `files` once a plugin's
      // onResolve matches their names, and panics on a `with { type: "file" }`
      // import once a plugin's onLoad matches every file, even when the hooks
      // return nothing.
      it("bun: an entry point from Bun.build's files keeps resolving and embedding files", { skip }, async (t) => {
        const root = await fixture(t, "bun-files")
        // Bun snapshots directories while resolving the entry and its plugins.
        // Every disk asset must exist before that resolver starts.
        const ready = join(root, "asset-ready.mjs")
        await writeFile(ready, `import { readFileSync } from "node:fs"
if (readFileSync(${JSON.stringify(join(root, "helper.bin"))}, "utf8") !== "helper") throw new Error("file asset was not prepared before Bun started")
`)
        const result = await spawned("bun", ["--preload", ready, "--no-warnings", build, "bun", "--files"], root)
        assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`)
        const run = await spawned("bun", ["out/virtual-main.js"], root)
        assert.equal(run.code, 0, run.stderr)
        assert.equal(run.stdout, expected)
      })

      it("bun: a failed file-asset build records the asset state before and after bundling", { skip }, async (t) => {
        const root = await fixture(t, "bun-files-failure")
        const asset = join(root, "helper.bin")
        const preload = join(root, "remove-asset.mjs")
        // Remove the asset after the harness records its inputs, at the
        // Bun.build boundary, to distinguish a missing file from a stale cache.
        await writeFile(preload, `import { unlinkSync } from "node:fs"
const build = Bun.build.bind(Bun)
Bun.build = (options) => { unlinkSync(${JSON.stringify(asset)}); return build(options) }
`)
        const result = await spawned("bun", ["--preload", preload, "--no-warnings", build, "bun", "--files"], root)
        assert.equal(result.code, 1, result.stdout + result.stderr)
        const event = JSON.parse(result.stdout.trim().split("\n").at(-1))
        assert.equal(event.ok, false)
        assert.ok(event.context, "failed Bun builds must retain file-asset diagnostics: " + result.stdout)
        assert.equal(event.context.stage, "build")
        assert.equal(event.context.asset, asset)
        assert.equal(typeof event.context.bun, "string")
        assert.equal(event.context.beforeBuild.asset.exists, true)
        assert.equal(event.context.beforeBuild.asset.size, 6)
        assert.deepEqual(event.context.afterBuild.asset, { exists: false, error: "ENOENT" })
        assert.equal(event.context.afterBuild.directory.exists, true)
      })
    }

    // Rollup bundles packages only through @rollup/plugin-node-resolve, which the fixture does not use.
    const bundlesPackages = bundler !== "rollup" || "Rollup resolves no packages without @rollup/plugin-node-resolve"
    it(`${bundler}: builds a workspace package's .vibe source with that package's own project`, { skip: skip || (bundlesPackages === true ? false : bundlesPackages) }, async (t) => {
      // dep lies beside the fixture, outside its root, as a workspace package
      // that the app imports by name through node_modules.
      const root = await fixture(t, bundler)
      const dep = `${root}-dep`
      t.after(() => rm(dep, { recursive: true, force: true }))
      await mkdir(join(dep, "src"), { recursive: true })
      await writeFile(join(dep, "package.json"), JSON.stringify({ name: "dep", type: "module", exports: { ".": "./src/index.vibe" } }))
      await cp(join(here, "fixture/tsconfig.json"), join(dep, "tsconfig.json"))
      await writeFile(join(dep, "src/index.vibe"), "export function greet(name: string): string {\n  return `hello, ${name}`\n}\n")
      await mkdir(join(root, "node_modules"), { recursive: true })
      await symlink(dep, join(root, "node_modules/dep"))
      await edit(join(root, "src/main.ts"), 'import { shop } from "./shop.vibe"', 'import { greet } from "dep"\nimport { shop } from "./shop.vibe"')
      await edit(join(root, "src/main.ts"), 'console.log(lines.join("\\n"))', 'console.log([...lines, greet("dep")].join("\\n"))')
      const result = await bundleOnce(bundler, root)
      assert.deepEqual(result.event, { ok: true }, result.stderr)
      assert.equal(await runBundle(bundler, root), expected.replace(/\n?$/, "\nhello, dep\n"))
    })

    it(`${bundler}: a type error fails the build at its .vibe position`, { skip }, async (t) => {
      const root = await fixture(t, `${bundler}-error`)
      const file = join(root, "src/shop.vibe")
      await writeFile(file, (await readFile(file, "utf8")) + 'export const broken: number = "wrong"\n')
      // Two .vibe modules load from the failed compile; it is reported once.
      await edit(join(root, "src/main.ts"), 'import { Effect }', 'import "./format.vibe"\nimport { Effect }')
      const result = await bundleOnce(bundler, root)
      assert.equal(result.code, 1)
      assert.equal(result.event.ok, false)
      assert.ok(result.event.message.includes(`${file}:35:14 - error TS2322: Type 'string' is not assignable to type 'number'.`),
        result.event.message)
      assert.equal(result.event.message.match(/TS2322/g).length, 1, "one report per compile")
    })

    if (bundler === "esbuild") {
      it("esbuild: a package that declares no side effects drops a .vibe module nothing uses", async (t) => {
        const root = await fixture(t, "esbuild-side-effects")
        await writeFile(join(root, "package.json"), JSON.stringify({ private: true, type: "module", sideEffects: false }))
        // A top-level call: without the package's word, esbuild must keep the module.
        await writeFile(join(root, "src", "unused.vibe"), 'export const marker = ["unused", "module", "marker"].join("-")\n')
        await writeFile(join(root, "src", "barrel.ts"), 'export * as Unused from "./unused.vibe"\nexport { shop } from "./shop.vibe"\n')
        await edit(join(root, "src", "main.ts"), 'from "./shop.vibe"', 'from "./barrel.ts"')
        const result = await bundleOnce("esbuild", root)
        assert.deepEqual(result.event, { ok: true }, result.stderr)
        assert.equal(await runBundle("esbuild", root), expected)
        const code = await readFile(join(root, "out/main.js"), "utf8")
        assert.ok(code.includes("service") || code.includes("coffee"), "the bundle holds the used modules")
        assert.ok(!code.includes("unused"), "the bundle keeps unused.vibe")
      })

      it("esbuild: a type error uses the .vibe source in its code frame", async (t) => {
        const root = await fixture(t, "esbuild-frame")
        const file = join(root, "src/shop.vibe")
        const lineText = 'export const broken: number = "wrong"'
        await writeFile(file, `export const answer = 42\n\n${lineText}\n`)
        await writeFile(join(root, "src/main.ts"), 'import "./shop.vibe"\n')
        const { build } = await import("esbuild")
        const { default: vibelang } = await import("vibelang-unplugin/esbuild")
        await assert.rejects(build({
          absWorkingDir: root, entryPoints: ["src/main.ts"], bundle: true,
          platform: "node", write: false, plugins: [vibelang()], logLevel: "silent"
        }), (error) => {
          assert.equal(error.errors.length, 1)
          const { location } = error.errors[0]
          assert.equal(resolve(root, location.file), file)
          assert.equal(location.line, 3, error.errors[0].text)
          assert.equal(location.column, 13)
          assert.equal(location.lineText, lineText)
          return true
        })
      })
    }

    if (!watch) continue
    it(`${bundler}: watch mode recompiles on .vibe, .ts and tsconfig changes`, async (t) => {
      const root = await fixture(t, `${bundler}-watch`)
      const watcher = watchBundle(bundler, root)
      try {
        await watchEdits(bundler, root, watcher)
      } finally {
        await watcher.close()
      }
    })

    it(`${bundler}: watch mode keeps a save made during a compile`, async (t) => {
      const root = await fixture(t, `${bundler}-save`)
      const watcher = watchBundle(bundler, root, {
        VIBELANG_BINARY: join(here, "save-during-compile.mjs"), VIBELANG_REAL: process.env.VIBELANG_BINARY
      })
      try {
        await watcher.next("success", (event) => event.ok)
        await new Promise((accept) => setTimeout(accept, 1000))
        // The rebuild's compiler reads "booked"; the save to "sold" lands before its output is used.
        await edit(join(root, "src/shop.vibe"), 'receipt("ordered"', 'receipt("booked"', watcher)
        await watcher.next("with the save made during the compile", (event) => event.ok && printsEventually(bundler, root, "sold 2 tea"))
      } finally {
        await watcher.close()
      }
    })
  }
})

for (const bundler of ["webpack", "rspack", "rollup", "esbuild"]) {
  it(`${bundler} reports a missing project instead of retrying forever`, async (t) => {
    const root = await fixture(t, `${bundler}-missing`)
    await rm(join(root, "tsconfig.json"))
    const result = spawnSync(process.execPath, ["--no-warnings", build, bundler], {
      cwd: root, encoding: "utf8", timeout: 15_000
    })
    assert.equal(result.error, undefined, result.stderr)
    assert.equal(result.status, 1, result.stdout + result.stderr)
    assert.match(result.stdout + result.stderr, /TS5058/)
  })
}
