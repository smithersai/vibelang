import { strict as assert } from "node:assert"
import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

// vibe.sidecarDir moves every declaration sidecar into one directory that
// mirrors the source tree; tsconfig rootDirs merges the two, so stock
// TypeScript still resolves ./x.vibe (decided detail 268, amending VIP-27).
const repo = fileURLToPath(new URL("../../../", import.meta.url))
const native = process.env.VIBELANG_BINARY || join(repo, "typescript/built/local/tsc")
const modules = process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules")
const effect = join(modules, "effect")
const stockTsc = join(modules, "typescript/bin/tsc")
const runtime = join(repo, "packages/runtime")
const missing = [native, effect, stockTsc, join(runtime, "dist/index.js")].find((path) => !existsSync(path))
const skip = missing !== undefined && `run typescript/vibelang/smoke.sh first; missing ${missing}`

function project(t, files) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-sidecar-dir-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, "node_modules"))
  symlinkSync(realpathSync(effect), join(root, "node_modules/effect"))
  symlinkSync(runtime, join(root, "node_modules/vibelang-runtime"))
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, name)), { recursive: true })
    writeFileSync(join(root, name), text)
  }
  return root
}

const options = { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, types: [], skipLibCheck: true, noEmit: true, allowArbitraryExtensions: true, rewriteRelativeImportExtensions: true }
const sources = {
  "lib/src/name.vibe": "export type Name = { readonly first: string }\n",
  "lib/src/deep/greet.vibe": "import type { Name } from \"../name.vibe\"\n\nexport function greet(name: Name): string {\n  return `Hello, ${name.first}!`\n}\n",
  "lib/src/util.ts": "export type Loud = string\n",
  "lib/src/loud.vibe": "import type { Loud } from \"./util.ts\"\nimport { greet } from \"./deep/greet.vibe\"\n\nexport const loud = (first: string): Loud => greet({ first })\n",
  // A TypeScript consumer in the same project, which stock tsc checks.
  "lib/src/main.ts": "import { greet } from \"./deep/greet.vibe\"\nimport { loud } from \"./loud.vibe\"\n\nexport const ok: string = greet({ first: \"Ada\" }) + loud(\"Grace\")\n"
}
const config = (vibe, compilerOptions = {}) => JSON.stringify({ compilerOptions: { ...options, ...compilerOptions }, include: ["src"], ...(vibe === undefined ? {} : { vibe }) })
const directoryMode = () => config({ sidecarDir: ".vibe/declarations" }, { rootDirs: [".", ".vibe/declarations"] })
const vibeModules = ["name", "deep/greet", "loud"]

const run = (command, args, cwd) => spawnSync(command, args, { cwd, encoding: "utf8" })
const build = (root, ...args) => {
  const result = run(native, ["-p", "lib/tsconfig.json", "--pretty", "false", ...args], root)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  return result
}
const stock = (root) => run(process.execPath, [stockTsc, "-p", "lib/tsconfig.json", "--pretty", "false"], root)
const beside = (root, module) => join(root, "lib/src", module + ".d.vibe.ts")
const mirrored = (root, module) => join(root, "lib/.vibe/declarations/src", module + ".d.vibe.ts")

test("vibe.sidecarDir writes each sidecar under it, mirroring the source tree, and none beside the sources", { skip }, (t) => {
  const root = project(t, { ...sources, "lib/tsconfig.json": directoryMode() })
  build(root)
  for (const module of vibeModules) {
    assert.ok(existsSync(mirrored(root, module)), module)
    assert.equal(existsSync(beside(root, module)), false, module)
  }
  // Relative Vibe imports reach their mirrored companions; native TS imports reach their source even from another project.
  assert.equal(readFileSync(mirrored(root, "deep/greet"), "utf8"), "import type { Name } from \"../name.vibe\";\nexport declare function greet(name: Name): string;\n")
  assert.equal(readFileSync(mirrored(root, "loud"), "utf8"), "import type { Loud } from \"../../../src/util.ts\";\nexport declare const loud: (first: string) => Loud;\n")
  // A sidecar stays an output of its source, even where include names its directory.
  writeFileSync(join(root, "lib/tsconfig.json"), JSON.stringify({ ...JSON.parse(directoryMode()), include: ["src", ".vibe/declarations"] }))
  assert.doesNotMatch(build(root, "--listFiles").stdout, /\.d\.vibe\.ts/)
})

for (const mode of ["beside", "directory"]) {
  test("stock tsc --noEmit checks a .ts consumer of ./x.vibe in " + mode + " mode", { skip }, (t) => {
    const root = project(t, { ...sources, "lib/tsconfig.json": mode === "beside" ? config(undefined) : directoryMode() })
    const before = stock(root)
    assert.match(before.stdout, /TS2307: Cannot find module '\.\/deep\/greet\.vibe'/)
    build(root)
    const passed = stock(root)
    assert.equal(passed.status, 0, passed.stdout + passed.stderr)
    // The types are the module's, not any: a wrong use is an error.
    writeFileSync(join(root, "lib/src/wrong.ts"), "import { greet } from \"./deep/greet.vibe\"\nexport const wrong: number = greet({ first: \"Ada\" })\n")
    const failed = stock(root)
    assert.equal(failed.stdout.trim().split("\n").length, 1, failed.stdout)
    assert.match(failed.stdout, /wrong\.ts\(2,14\): error TS2322: Type 'string' is not assignable to type 'number'/)
  })
}

test("switching vibe.sidecarDir on and off leaves one sidecar per module, in the chosen place", { skip }, (t) => {
  const root = project(t, { ...sources, "lib/tsconfig.json": config(undefined) })
  build(root)
  for (const module of vibeModules) assert.ok(existsSync(beside(root, module)), module)

  writeFileSync(join(root, "lib/tsconfig.json"), directoryMode())
  build(root)
  for (const module of vibeModules) {
    assert.ok(existsSync(mirrored(root, module)), module)
    assert.equal(existsSync(beside(root, module)), false, "stale " + module)
  }
  assert.equal(stock(root).status, 0)

  writeFileSync(join(root, "lib/tsconfig.json"), config(undefined))
  build(root)
  for (const module of vibeModules) assert.ok(existsSync(beside(root, module)), module)
  // The emptied conventional directory goes with its sidecars.
  assert.equal(existsSync(join(root, "lib/.vibe")), false)
  assert.equal(stock(root).status, 0)
})

test("the conventional directory keeps files the compiler did not write", { skip }, (t) => {
  const root = project(t, { ...sources, "lib/tsconfig.json": directoryMode() })
  build(root)
  writeFileSync(join(root, "lib/.vibe/notes.txt"), "mine\n")
  writeFileSync(join(root, "lib/tsconfig.json"), config(undefined))
  build(root)
  assert.equal(existsSync(join(root, "lib/.vibe/declarations")), false)
  assert.equal(readFileSync(join(root, "lib/.vibe/notes.txt"), "utf8"), "mine\n")
})

test("a base config's ${configDir} sidecarDir is the selected project's, and showConfig prints it relative", { skip }, (t) => {
  const root = project(t, {
    ...sources,
    "base.json": JSON.stringify({ compilerOptions: { ...options, rootDirs: ["${configDir}", "${configDir}/types"] }, vibe: { sidecarDir: "${configDir}/types" } }),
    "lib/tsconfig.json": JSON.stringify({ extends: "../base.json", include: ["src"] })
  })
  build(root)
  assert.ok(existsSync(join(root, "lib/types/src/deep/greet.d.vibe.ts")))
  assert.equal(existsSync(join(root, "types")), false)
  assert.equal(stock(root).status, 0, stock(root).stdout)
  const shown = JSON.parse(run(native, ["-p", "lib/tsconfig.json", "--showConfig"], root).stdout)
  assert.deepEqual(shown.vibe, { sidecarDir: "types" })
})

for (const [value, label] of [[true, "a boolean"], [null, "null"], [["a"], "an array"]]) {
  test("vibe.sidecarDir rejects " + label + " with EK3007", { skip }, (t) => {
    const root = project(t, { ...sources, "lib/tsconfig.json": config({ sidecarDir: value }) })
    const result = run(native, ["-p", "lib/tsconfig.json", "--pretty", "false"], root)
    assert.notEqual(result.status, 0)
    assert.match(result.stdout + result.stderr, /EK3007: vibe\.sidecarDir must be a path string/)
  })
}

// vibelang --watch keeps the chosen place current and settles: a rewritten
// sidecar may start one more build, which finds it unchanged and writes
// nothing, so the builds stop.
for (const mode of ["beside", "directory"]) {
  test("vibelang --watch rewrites the sidecar in " + mode + " mode and settles", { skip, timeout: 90000 }, async (t) => {
    const root = project(t, { ...sources, "lib/tsconfig.json": mode === "beside" ? config(undefined) : directoryMode() })
    const sidecar = (mode === "beside" ? beside : mirrored)(root, "deep/greet")
    const other = (mode === "beside" ? mirrored : beside)(root, "deep/greet")
    const child = spawn(native, ["-w", "-p", "lib/tsconfig.json", "--pretty", "false", "--preserveWatchOutput"], { cwd: root })
    t.after(async () => {
      if (child.exitCode === null) {
        const exited = new Promise((resolve) => child.once("exit", resolve))
        child.kill()
        await exited
      }
    })
    let output = ""
    let waiting
    const builds = () => (output.match(/Watching for file changes\./g) ?? []).length
    child.stdout.on("data", (chunk) => { output += chunk; waiting?.() })
    child.stderr.on("data", (chunk) => { output += chunk })
    // Waits for a condition the watch's output or files reach, polling as well:
    // a loaded host may coalesce or split the builds an edit starts.
    const until = (reached, what) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => { clearInterval(poll); reject(new Error("watch never " + what + ":\n" + output)) }, 60000)
      const poll = setInterval(() => waiting?.(), 200)
      waiting = () => { if (reached()) { clearTimeout(timer); clearInterval(poll); waiting = undefined; resolve() } }
      waiting()
    })
    const text = () => existsSync(sidecar) ? readFileSync(sidecar, "utf8") : ""
    await until(() => builds() >= 1, "finished its first build")
    assert.match(text(), /greet\(name: Name\): string;/)
    assert.equal(existsSync(other), false)
    writeFileSync(join(root, "lib/src/deep/greet.vibe"), readFileSync(join(root, "lib/src/deep/greet.vibe"), "utf8") + "\nexport const version = 2\n")
    await until(() => /export declare const version = 2;/.test(text()), "rewrote the sidecar")
    const quiet = async () => {
      for (let count = -1; count !== builds();) {
        count = builds()
        await new Promise((resolve) => setTimeout(resolve, 1500))
      }
      return builds()
    }
    const settled = await quiet()
    assert.equal(existsSync(other), false)
    assert.ok(settled <= 4, "the edit started builds without end:\n" + output)
    await new Promise((resolve) => setTimeout(resolve, 2500))
    assert.equal(builds(), settled, "watch did not settle:\n" + output)
  })
}

// Detail 271: an empty string is a path to the declaring config directory,
// and a child's present empty path overrides the inherited directory.
test("an empty sidecarDir overrides an inherited path with the declaring config directory", { skip }, (t) => {
  const root = project(t, {
    ...sources,
    "base.json": JSON.stringify({ compilerOptions: options, vibe: { sidecarDir: "types" } }),
    "lib/tsconfig.json": JSON.stringify({ extends: "../base.json", include: ["src"], vibe: { sidecarDir: "" } })
  })
  build(root)
  for (const module of vibeModules) assert.ok(existsSync(beside(root, module)), module)
  assert.equal(existsSync(join(root, "types")), false)
  assert.equal(stock(root).status, 0, stock(root).stdout)
  const shown = JSON.parse(run(native, ["-p", "lib/tsconfig.json", "--showConfig"], root).stdout)
  assert.equal(shown.vibe.sidecarDir, "")
})

// A path string can name an ancestor or overlap the source tree. The compiler
// still mirrors config-relative paths without introducing a source ban.
for (const sidecarDir of ["..", "src"]) {
  test("sidecarDir " + JSON.stringify(sidecarDir) + " mirrors sources even when output and source roots overlap", { skip }, (t) => {
    const root = project(t, {
      "lib/a.vibe": "export type Outer = string\n",
      "lib/src/b.vibe": "export type Inner = number\n",
      "lib/consumer.ts": 'import type { Outer } from "./a.vibe"\nimport type { Inner } from "./src/b.vibe"\nexport type Both = [Outer, Inner]\n',
      "lib/tsconfig.json": JSON.stringify({ compilerOptions: { ...options, rootDirs: [".", sidecarDir] }, include: ["."], vibe: { sidecarDir } })
    })
    for (const source of ["a", "src/b"]) {
      // Start with stale colocated declarations in both source folders.
      writeFileSync(join(root, "lib", source + ".d.vibe.ts"), "export type Stale = never\n")
    }
    for (let buildNumber = 0; buildNumber < 2; buildNumber++) {
      build(root)
      for (const source of ["a", "src/b"]) assert.ok(existsSync(join(root, "lib", sidecarDir, source + ".d.vibe.ts")), source)
      if (sidecarDir === "..") {
        const checked = stock(root)
        assert.equal(checked.status, 0, checked.stdout + checked.stderr)
      }
    }
  })
}


for (const [module, diagnostic] of [["a", "TS2305"], ["b", "TS2307"]]) {
  test("overlapping rootDirs use native TypeScript precedence for ./src/" + module, { skip }, (t) => {
    // Native arbitrary-extension control: a longest matching root can shadow
    // a declaration or change its virtual path, independently of VibeLang.
    const root = project(t, {
      "lib/src/a.d.css.ts": "export type Outer = string\n",
      ["lib/src/src/" + module + ".d.css.ts"]: "export type Inner = number\n",
      "lib/consumer.ts": 'import type { Inner } from "./src/' + module + '.css"\nexport type Result = Inner\n',
      "lib/tsconfig.json": JSON.stringify({ compilerOptions: { ...options, rootDirs: [".", "src"] }, include: ["consumer.ts"] })
    })
    const native = stock(root)
    assert.notEqual(native.status, 0)
    assert.ok(native.stdout.includes(diagnostic), native.stdout)
  })
}
