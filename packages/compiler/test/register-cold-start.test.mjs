import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const register = fileURLToPath(new URL("../register.mjs", import.meta.url))
const native = process.env.VIBELANG_BINARY || join(repo, "typescript/built/local/tsc")
const skip = !existsSync(native) && `run typescript/vibelang/smoke.sh first; missing ${native}`

const tsconfig = JSON.stringify({
  compilerOptions: {
    target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, types: [], skipLibCheck: true,
    allowImportingTsExtensions: true, rewriteRelativeImportExtensions: true, noEmit: true
  },
  include: ["src/**/*"]
})

// A workspace whose app imports one .vibe package per letter. Its compiler
// holds each compile open until a second one is running, or gives up, so the
// log says how many compiles ever ran at once.
function workspace(t, letters = ["a", "b", "c", "d", "e"], bodies = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "vibelang-cold-start-")))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const active = join(root, "active")
  const log = join(root, "compiles.jsonl")
  mkdirSync(active)
  const compiler = join(root, "compiler.mjs")
  writeFileSync(compiler, `import { appendFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { join } from "node:path"
const args = process.argv.slice(2)
const active = ${JSON.stringify(active)}
const mine = join(active, String(process.pid))
writeFileSync(mine, "")
let peak = 1
const until = Date.now() + 1500
while (Date.now() < until && peak < 2) {
  peak = Math.max(peak, readdirSync(active).length)
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)
}
const run = spawnSync(${JSON.stringify(native)}, args, { encoding: "utf8" })
rmSync(mine, { force: true })
appendFileSync(${JSON.stringify(log)}, JSON.stringify({ project: args[args.indexOf("--project") + 1], peak }) + "\\n")
process.stdout.write(run.stdout ?? "")
process.stderr.write(run.stderr ?? "")
process.exit(run.status ?? 1)
`)
  const write = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  const dependencies = Object.fromEntries(letters.map((letter) => [`pkg-${letter}`, "workspace:*"]))
  write("app/package.json", JSON.stringify({ name: "app", type: "module", dependencies }))
  write("app/tsconfig.json", tsconfig)
  write("app/src/main.ts", [
    ...letters.map((letter) => `import { ${letter} } from "pkg-${letter}/${letter}.vibe"`),
    `console.log(${letters.map((letter) => `${letter}()`).join(" + ")})`,
    ""
  ].join("\n"))
  for (const letter of letters) {
    write(`packages/${letter}/package.json`, JSON.stringify({ name: `pkg-${letter}`, type: "module", exports: { [`./${letter}.vibe`]: `./src/${letter}.vibe` } }))
    write(`packages/${letter}/tsconfig.json`, tsconfig)
    write(`packages/${letter}/src/${letter}.vibe`, bodies[letter] ?? `export function ${letter}(): string { return "${letter}" }\n`)
    mkdirSync(join(root, "app/node_modules"), { recursive: true })
    symlinkSync(join(root, "packages", letter), join(root, "app/node_modules", `pkg-${letter}`))
  }
  const run = (env = {}) => spawnSync(process.execPath, ["--import", register, join(root, "app/src/main.ts")], {
    cwd: join(root, "app"), encoding: "utf8",
    env: { ...process.env, VIBELANG_BINARY: compiler, VIBELANG_PROJECT: "", VIBELANG_CACHE_DIR: join(root, ".cache"), ...env }
  })
  const compiles = () => existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : []
  return { root, run, compiles, active }
}

test("a cold start compiles the rest of a workspace's projects at once, each exactly once", { skip }, (t) => {
  const { run, compiles, active } = workspace(t)
  const first = run()
  assert.equal(first.status, 0, first.stderr)
  assert.equal(first.stdout.trim(), "abcde")
  const done = compiles()
  assert.deepEqual(done.map((entry) => entry.project).sort(), ["a", "b", "c", "d", "e"].map((letter) => done.find((entry) => entry.project.endsWith(`packages/${letter}/tsconfig.json`)).project).sort())
  assert.ok(Math.max(...done.map((entry) => entry.peak)) >= 2, `compiles ran one at a time: ${JSON.stringify(done)}`)
  assert.deepEqual(readdirSync(active), [])

  const second = run()
  assert.equal(second.status, 0, second.stderr)
  assert.equal(second.stdout.trim(), "abcde")
  assert.equal(compiles().length, 5, "a warm start compiles nothing")
})

test("a compile error in a project reached on a cold start is reported as it is without the prefill", { skip }, (t) => {
  const { run } = workspace(t, ["a", "b", "c", "d"], { c: "export function c(): string { return 1 }\n" })
  const result = run()
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /packages\/c\/tsconfig\.json did not compile/)
  assert.match(result.stderr, /TS2322/)
})

test("with the cache off no project is compiled twice", { skip }, (t) => {
  const { run, compiles } = workspace(t)
  const result = run({ VIBELANG_DISABLE_CACHE: "1" })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(compiles().length, 5)
})

test("editing one project recompiles only that project", { skip }, (t) => {
  const { root, run, compiles } = workspace(t)
  assert.equal(run().status, 0)
  writeFileSync(join(root, "packages/e/src/e.vibe"), `export function e(): string { return "edited" }\n`)
  const result = run()
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.trim(), "abcdedited")
  assert.equal(compiles().length, 6)
})

test("VIBELANG_PROJECT keeps one project's compile to itself", { skip }, (t) => {
  const { root, run, compiles } = workspace(t, ["a", "b", "c"])
  const result = run({ VIBELANG_PROJECT: join(root, "packages/a/tsconfig.json") })
  assert.equal(result.status, 0, result.stderr)
  assert.ok(Math.max(...compiles().map((entry) => entry.peak)) === 1)
})
