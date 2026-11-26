// Uses the current checkout's compiler, runtime and Vite plugin. Run the
// documented workspace setup first, then node --test test/e2e.test.mjs.
import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { on } from "node:events"
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"
import { createInterface } from "node:readline"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("../../../", import.meta.url))
const binary = process.env.VIBELANG_BINARY || join(root, "typescript/built/local/tsc")

function run(command, args, cwd, extraEnv = {}) {
  const result = spawnSync(command, args, {
    cwd, encoding: "utf8", timeout: 120_000,
    env: { ...process.env, VIBELANG_BINARY: binary, NO_COLOR: "1", ...extraEnv }
  })
  assert.equal(result.error, undefined, result.error?.message)
  return { ...result, output: result.stdout + result.stderr }
}

async function checkDev(app) {
  const source = join(app, "src/main.vibe")
  const original = readFileSync(source, "utf8")
  const child = spawn(process.execPath, ["scripts/dev.mjs"], {
    cwd: app, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, VIBELANG_BINARY: binary, PATH: join(app, "node_modules/.bin") + delimiter + process.env.PATH }
  })
  let stderr = ""
  child.stderr.setEncoding("utf8").on("data", chunk => { stderr += chunk })
  child.on("error", error => { stderr += error.message })
  const closed = new Promise(resolve => child.once("close", resolve))
  const lines = createInterface({ input: child.stdout })
  try {
    let watching = false, edited = false
    for await (const [line] of on(lines, "line", {
      signal: AbortSignal.timeout(60_000), close: ["close"]
    })) {
      if (line.includes("dev: compiler is watching")) watching = true
      if (watching && !edited && line.includes("Hello, VibeLang!")) {
        edited = true
        writeFileSync(source, original.replace('greet("VibeLang")', 'greet("watch edit")'))
      }
      if (edited && line.includes("Hello, watch edit!")) return
    }
    assert.fail("starter dev exited before the edit was rendered\n" + stderr)
  } finally {
    lines.close()
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      try {
        if (process.platform === "win32") child.kill()
        else process.kill(-child.pid, "SIGTERM")
      } catch (error) { if (error.code !== "ESRCH") throw error }
    }
    await closed
    writeFileSync(source, original)
  }
}

// The test is deliberately opt-in until workspace setup builds the compiler
// and runtime. CLI unit tests remain runnable in an unpacked npm package.
test("a scaffold installs, tests source without a build, builds, starts, and reports assertion positions", {
  skip: !existsSync(binary) || !existsSync(join(root, "packages/runtime/dist/index.js"))
    ? "run the documented workspace setup to build the compiler and runtime" : false,
  timeout: 180_000
}, async (t) => {
  const scratch = mkdtempSync(join(tmpdir(), "vibelang-scaffold-e2e-"))
  t.after(() => rmSync(scratch, { recursive: true, force: true }))
  const app = join(scratch, "hello app")
  const created = run(process.execPath, [join(root, "packages/create-vibelang/bin/create-vibelang.mjs"), app, "--no-install"], scratch)
  assert.equal(created.status, 0, created.output)
  const manifestPath = join(app, "package.json")
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
  // Pack rather than symlink the runtime: its Effect import must resolve to
  // the same physical installation as the app's Effect import (D120).
  const packed = run("npm", ["pack", join(root, "packages/runtime"), "--pack-destination", scratch, "--ignore-scripts", "--json", "--silent"], scratch)
  assert.equal(packed.status, 0, packed.output)
  manifest.dependencies["vibelang-runtime"] = `file:${join(scratch, JSON.parse(packed.stdout)[0].filename)}`
  manifest.devDependencies.vibelang = `file:${join(root, "packages/compiler")}`
  manifest.devDependencies["vibelang-vite"] = `file:${join(root, "packages/vite")}`
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n")
  const installed = run("bun", ["install"], app)
  assert.equal(installed.status, 0, installed.output)

  assert.ok(!existsSync(join(app, "dist")), "source tests start without emitted files")
  const tested = run("bun", ["run", "test"], app)
  assert.equal(tested.status, 0, tested.output)
  assert.match(tested.output, /2 passed/)

  const cli = join(app, "src/cli.ts")
  writeFileSync(cli, 'export const greeting: string = "from TypeScript"\n')
  const built = run("bun", ["run", "build"], app)
  assert.equal(built.status, 0, built.output)
  // The starter turns Effect's lint rules on, and its own code reports none.
  assert.doesNotMatch(built.output, /\b(?:error|warning|suggestion) [A-Z]+\d+/, "the starter builds without diagnostics")
  assert.ok(existsSync(join(app, "dist/cli.js")), "standalone TypeScript is emitted")
  assert.ok(!existsSync(join(app, "dist/greeting.test.js")), "source tests are not emitted")
  assert.ok(existsSync(join(app, "dist/main.js")))
  assert.ok(existsSync(join(app, "dist/greeting.js.map")))
  const started = run("bun", ["run", "start"], app)
  assert.equal(started.status, 0, started.output)
  assert.match(started.output, /Hello, VibeLang!/)
  assert.match(started.output, /Recovered from EmptyName/)
  const greeting = readFileSync(join(app, "dist/greeting.js"), "utf8")

  // After start and test, src/ holds only sources, and a first commit of the
  // project tracks no generated declaration, receipt or build output.
  assert.deepEqual(readdirSync(join(app, "src")).sort(), ["cli.ts", "greeting.test.vibe", "greeting.vibe", "main.vibe"])
  assert.ok(existsSync(join(app, ".vibe/declarations/greeting.d.vibe.ts")), "declarations go to vibe.sidecarDir")
  const git = (...args) => run("git", ["-c", "user.name=starter", "-c", "user.email=starter@example.invalid", ...args], app)
  assert.equal(git("init", "-q").status, 0)
  assert.equal(git("add", "-A").status, 0)
  assert.equal(git("commit", "-qm", "starter").status, 0)
  assert.equal(git("status", "--porcelain").stdout, "")
  const tracked = git("ls-files").stdout.split("\n").filter(Boolean)
  const generated = tracked.filter((file) => /\.d\.(?:vibe\.|vibex\.)?ts$|\.vibelang-sidecar-|^dist\/|^\.vibe\/|^node_modules\//.test(file))
  assert.deepEqual(generated, [], "the first commit tracks generated files")
  rmSync(join(app, ".git"), { recursive: true, force: true })
  assert.doesNotMatch(greeting, /\.vibe["']/)
  await checkDev(app)

  // A TypeScript entry point need not be imported by any .vibe file.
  writeFileSync(join(app, "src/t5.vibe"), `export effect function clampAll(values: ReadonlyArray<number>) {
  return try forEach(values, (value) => succeed(Math.min(10, Math.max(0, value))))
}
export effect function later() { try sleep("1 millis"); return 7 }
export function plain(value: number): number { return value + 1 }
`)
  for (const script of ["format", "lint", "check"]) {
    const ran = run("bun", ["run", script], app)
    assert.equal(ran.status, 0, `${script}: ${ran.output}`)
  }
  const ugly = join(app, "src/ugly.vibe")
  writeFileSync(ugly, "export const   value=1\n")
  const unformatted = run("bun", ["run", "check"], app)
  assert.equal(unformatted.status, 1, unformatted.output)
  assert.match(unformatted.output, /ugly\.vibe/)
  assert.equal(run("bun", ["run", "format"], app).status, 0)
  assert.equal(readFileSync(ugly, "utf8"), "export const value = 1\n")
  rmSync(ugly)
  const testDrop = join(app, "src/drop.test.vibe")
  writeFileSync(testDrop, 'import { it } from "@effect/vitest"\nit.effect("drops", effect () => { Effect.succeed(1) })\n')
  const lintedTests = run("bun", ["run", "lint"], app)
  assert.equal(lintedTests.status, 1, lintedTests.output)
  assert.match(lintedTests.output, /drop\.test\.vibe.*EK3801/, "lint covers the test files")
  rmSync(testDrop)
  const floating = join(app, "src/floating.vibe")
  writeFileSync(floating, "export effect function dropped() { Effect.succeed(1) }\n")
  const linted = run(join(app, "node_modules/.bin/vibelang"), ["lint"], app)
  assert.equal(linted.status, 1, linted.output)
  assert.match(linted.output, /error EK3801: floatingEffect/, "vibelang lint runs Effect's rules on the starter")
  rmSync(floating)
  const caller = join(app, "src/use.ts")
  const source = `import { Effect } from "effect"
import { clampAll, later, plain } from "./t5.vibe"
console.log(JSON.stringify(Effect.runSync(clampAll([-2, 4, 15]))))
console.log(await Effect.runPromise(later()))
console.log(plain(4))
`
  writeFileSync(caller, source)
  const mixed = run("bun", ["run", "build"], app)
  assert.equal(mixed.status, 0, mixed.output)
  assert.ok(existsSync(join(app, "dist/use.js")), "build must emit an unreferenced TypeScript entry point")
  assert.match(readFileSync(join(app, "dist/use.js"), "utf8"), /from "\.\/t5\.js"/)
  const called = run(process.execPath, ["dist/use.js"], app)
  assert.equal(called.status, 0, called.output)
  assert.equal(called.stdout.trim(), "[0,4,10]\n7\n5")
  writeFileSync(caller, source + '\nconst invalid: number = "a string"\n')
  const rejected = run("bun", ["run", "build"], app)
  assert.equal(rejected.status, 1, rejected.output)
  assert.match(rejected.output, /use\.ts.*TS2322/)
  writeFileSync(caller, source)

  writeFileSync(cli, 'export const greeting: string = 123\n')
  const badType = run("bun", ["run", "build"], app)
  assert.notEqual(badType.status, 0, badType.output)
  assert.match(badType.output, /TS2322/)
  writeFileSync(cli, 'export const greeting: string = "from TypeScript"\n')

  const main = join(app, "src/main.vibe")
  const original = readFileSync(main, "utf8")
  writeFileSync(main, 'import * as NodeRuntime from "@effect/platform-node/NodeRuntime"\nservice Required { read(): string!! }\neffect function main() { const required = try Required; try Console.log(try required.read()) }\nNodeRuntime.runMain(main())\n')
  rmSync(join(app, "dist"), { recursive: true, force: true })
  const missing = run("bun", ["run", "build"], app)
  assert.notEqual(missing.status, 0, missing.output)
  assert.match(missing.output, /error EK9211: Nothing provides Required/)
  assert.ok(!existsSync(join(app, "dist/main.js")), "missing provider prevents emit")
  writeFileSync(main, original)

  const testFile = join(app, "src/greeting.test.vibe")
  writeFileSync(testFile, readFileSync(testFile, "utf8").replace('"Hello, Ada!"', '"deliberately wrong"'))
  const failed = run("bun", ["run", "test"], app)
  assert.equal(failed.status, 1, failed.output)
  assert.match(failed.output, /1 failed/)
  assert.match(failed.output, /greeting\.test\.vibe:6:\d+/)
})

test("create-vibelang --smithers produces a project where smthrs ci passes", {
  skip: !existsSync(binary) || !existsSync(join(root, "packages/runtime/dist/index.js"))
    ? "run the documented workspace setup to build the compiler and runtime" : false,
  timeout: 180_000
}, (t) => {
  const scratch = mkdtempSync(join(tmpdir(), "vibelang-smithers-e2e-"))
  t.after(() => rmSync(scratch, { recursive: true, force: true }))
  const app = join(scratch, "smithers-app")
  const created = run(process.execPath, [join(root, "packages/create-vibelang/bin/create-vibelang.mjs"), app, "--smithers", "--no-install"], scratch)
  assert.equal(created.status, 0, created.output)
  const manifestPath = join(app, "package.json")
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
  const packed = run("npm", ["pack", join(root, "packages/runtime"), "--pack-destination", scratch, "--ignore-scripts", "--json", "--silent"], scratch)
  assert.equal(packed.status, 0, packed.output)
  const runtimeTarball = `file:${join(scratch, JSON.parse(packed.stdout)[0].filename)}`
  const packedVite = run("npm", ["pack", join(root, "packages/vite"), "--pack-destination", scratch, "--ignore-scripts", "--json", "--silent"], scratch)
  assert.equal(packedVite.status, 0, packedVite.output)
  const viteTarball = `file:${join(scratch, JSON.parse(packedVite.stdout)[0].filename)}`
  const stagedCompiler = join(scratch, "compiler")
  const compilerManifest = JSON.parse(readFileSync(join(root, "packages/compiler/package.json"), "utf8"))
  cpSync(join(root, "packages/compiler"), stagedCompiler, {
    recursive: true,
    filter: (path) => !/\/(?:native|node_modules|test)$/.test(path) && !path.endsWith(".zip")
  })
  const exeName = process.platform === "win32" ? "vibelang.exe" : "vibelang"
  mkdirSync(join(stagedCompiler, "native"), { recursive: true })
  copyFileSync(binary, join(stagedCompiler, "native", exeName))
  const plugin = run(join(stagedCompiler, "native", exeName), ["--write-dprint-plugin", stagedCompiler], scratch)
  assert.equal(plugin.status, 0, plugin.output)
  delete compilerManifest.optionalDependencies
  compilerManifest.files = [...new Set([...(compilerManifest.files ?? []), "native", "dprint-plugin.json"])]
  writeFileSync(join(stagedCompiler, "package.json"), JSON.stringify(compilerManifest, null, 2) + "\n")
  const packedCompiler = run("npm", ["pack", stagedCompiler, "--pack-destination", scratch, "--ignore-scripts", "--json", "--silent"], scratch)
  assert.equal(packedCompiler.status, 0, packedCompiler.output)
  const compilerTarball = `file:${join(scratch, JSON.parse(packedCompiler.stdout)[0].filename)}`
  manifest.dependencies["vibelang-runtime"] = runtimeTarball
  manifest.devDependencies["vibelang"] = compilerTarball
  manifest.devDependencies["vibelang-vite"] = viteTarball
  manifest.overrides = { ...manifest.overrides, "vibelang-runtime": runtimeTarball }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n")
  const installed = run("bun", ["install"], app)
  assert.equal(installed.status, 0, installed.output)
  const ci = run(join(app, "node_modules/.bin/smthrs"), ["ci", "//...", "--format", "json"], app)
  assert.equal(ci.status, 0, ci.output)
  const report = JSON.parse(ci.stdout)
  assert.equal(report.ok, true, ci.output)
  assert.equal(report.counts.failed, 0, ci.output)
  for (const label of ["//:build", "//:test", "//:check"]) {
    assert.equal(report.results.find((entry) => entry.label === label)?.status, "ran", `${label} must run`)
  }
  const cached = run(join(app, "node_modules/.bin/smthrs"), ["ci", "//...", "--format", "json"], app)
  assert.equal(cached.status, 0, cached.output)
  const cachedReport = JSON.parse(cached.stdout)
  assert.equal(cachedReport.ok, true, cached.output)
  assert.equal(cachedReport.counts.failed, 0, cached.output)
  assert.equal(cachedReport.counts.ran, 0, cached.output)
  assert.equal(cachedReport.counts.hit, cachedReport.results.length, cached.output)
})
