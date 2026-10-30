#!/usr/bin/env node
// Cold-start benchmark for vibelang/register. It writes a workspace of
// --packages packages, each a chain of --modules .vibe modules, each with an
// Effect TypeScript module beside it, and its own tsconfig.json. A package's
// first module calls the previous package's last one through the package's
// name, as workspace packages linked to their sources do. Node runs an entry that imports the last package, so the register hook
// compiles every package, each with its own project.
//
//   node scripts/bench/register.mjs [--packages 12] [--modules 24] [--runs 3] [--budget 4.5] [--register <file>] [--out <dir>]
//
// The compiler is $VIBELANG, else packages/compiler/native/vibelang; the hook
// is --register, else this checkout's packages/compiler/register.mjs. Needs a
// built packages/runtime (scripts/bench/modules.sh links it and effect).
//
// Each run measures, in this order:
//   start  vibelang -p <a one-module package> --noEmit: what every compile
//          costs before its own files, mostly reading Effect's declarations
//   check  vibelang -p <last package> --noEmit: one program that checks every
//          package once, the type-checking a cold start cannot avoid
//   cold   node --import <register> main.ts with an empty cache
//   warm   the same command again, reading the cache the cold run wrote
// cold - warm is the time the hook spent compiling. Without one start per
// package, it is a multiple of what checking the workspace once costs:
//
//   ratio = (cold - warm - packages * start) / (check - start)
//
// The run fails when the median ratio exceeds --budget. A compile that also
// checked every package its project imports checked the last package's whole
// chain, then the chain below it, and so on: about (packages + 1) / 2 checks of
// the workspace, 6.5 at 12 packages. A compile that checks only its own
// package checks the workspace once, plus parsing the packages below each one
// for their types: about 2.5 at 12 packages on the build host, where the
// budget's 4.5 sits between the two (typescript/VIBELANG.md has the results). Timings on a shared host move with its load, and the ratio
// less so; run it where nothing else runs when the numbers matter.
import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const usage = "usage: register.mjs [--packages 12] [--modules 24] [--runs 3] [--budget 4.5] [--register <file>] [--out <dir>]"
const options = { packages: 12, modules: 24, runs: 3, budget: 4.5, register: path.join(root, "packages/compiler/register.mjs"), out: "" }
for (let i = 2; i < process.argv.length; i += 2) {
  const name = process.argv[i].replace(/^--/, "")
  const value = process.argv[i + 1]
  if (!(name in options) || value === undefined) {
    console.error(usage)
    process.exit(2)
  }
  options[name] = typeof options[name] === "number" ? Number(value) : path.resolve(value)
}
if (!(options.packages >= 2 && options.modules >= 1 && options.runs >= 1)) {
  console.error(usage)
  process.exit(2)
}
const compiler = path.resolve(process.env.VIBELANG || path.join(root, "packages/compiler/native/vibelang"))
for (const [file, setup] of [[compiler, "run sh scripts/build-vibelang.sh, or set VIBELANG"], [options.register, "pass --register <file>"]]) {
  if (!existsSync(file)) {
    console.error(`register.mjs: missing ${file}; ${setup}`)
    process.exit(1)
  }
}
const out = options.out || mkdtempSync(path.join(tmpdir(), "vibelang-register-bench-"))
// Own temporary output even when setup or a child command exits early.
if (!options.out) process.on("exit", () => rmSync(out, { recursive: true, force: true }))

const tsconfig = JSON.stringify({
  compilerOptions: {
    target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true, skipLibCheck: true, types: [],
    allowImportingTsExtensions: true, rewriteRelativeImportExtensions: true, noEmit: true
  },
  include: ["src/**/*"]
}, null, 2) + "\n"

// Module i of package p, m<i>.vibe: an error, a schema, a service and its
// layer, a function that catches with match, and a run that calls the
// previous module's run once, forks and joins two fibers, and calls its
// TypeScript module. A run adds 2 * (i + 1).
function module(p, i) {
  const name = `${p}_${i}`
  const previous = i > 0 ? { from: `./m${i - 1}.vibe`, run: `run${p}_${i - 1}` }
    : p > 0 ? { from: `@bench/p${p - 1}`, run: `run${p - 1}_${options.modules - 1}` } : undefined
  return `${previous ? `import { ${previous.run} } from "${previous.from}"\n` : ""}import { step${name} } from "./t${i}.ts"

export error Missing${name} { id: string }

export schema Rec${name} {
  id: string
  count: number
  tag?: "a" | "b"
}

export service Store${name} {
  get(id: string): number!Missing${name}
  size: number
}

export const Store${name}Live = Layer.effect(Store${name}) {
  const items = new Map<string, number>([["k1", ${i}]])
  return {
    get(id) {
      const item = items.get(id)
      if (item === undefined) throw new Missing${name}({ id })
      return item
    },
    size: 1
  }
}

export function load${name}(id: string) {
  try {
    return Store${name}.get(id) + 1
  } catch (e) {
    return match (e) {
      when Missing${name}: 0;
    }
  }
}

export function run${name}(): number!! {
  const before = ${previous ? `${previous.run}()` : "0"}
  provide Store${name}Live {
    const left = fork load${name}("k1")
    const right = fork load${name}("k2")
    return before + left.join() + right.join() + step${name}("k1")
  }
}
`
}

// Its TypeScript module, t<i>.ts, in Effect TypeScript: an error, a schema, a
// service and its layer, and a generator that decodes, calls the service and
// catches by tag. step("k1") is i + 1.
function typescript(p, i) {
  const name = `${p}_${i}`
  return `import { Context, Data, Effect, Layer, Schema } from "effect"

export class Gone${name} extends Data.TaggedError("Gone${name}")<{ readonly id: string }> {}

export const Row${name} = Schema.Struct({
  id: Schema.String,
  count: Schema.Number,
  tag: Schema.optional(Schema.Literals(["a", "b"]))
})

export class Repo${name} extends Context.Service<Repo${name}, {
  get(id: string): Effect.Effect<number, Gone${name}>
}>()("Repo${name}") {}

export const Repo${name}Live = Layer.succeed(Repo${name}, Repo${name}.of({
  get: (id) => id === "k1" ? Effect.succeed(${i + 1}) : Effect.fail(new Gone${name}({ id }))
}))

export const step${name} = (id: string): Effect.Effect<number> =>
  Effect.gen(function* () {
    const repo = yield* Repo${name}
    const row = yield* Schema.decodeUnknownEffect(Row${name})({ id, count: 1 }).pipe(Effect.orDie)
    return yield* repo.get(row.id).pipe(Effect.catchTag("Gone${name}", () => Effect.succeed(0)))
  }).pipe(Effect.provide(Repo${name}Live))
`
}

function write(file, text) {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, text)
}

function writePackage(dir, name, p, modules) {
  write(path.join(dir, "package.json"), JSON.stringify({ name, type: "module", exports: { ".": "./src/index.ts" } }) + "\n")
  write(path.join(dir, "tsconfig.json"), tsconfig)
  for (let i = 0; i < modules; i++) {
    write(path.join(dir, "src", `m${i}.vibe`), module(p, i))
    write(path.join(dir, "src", `t${i}.ts`), typescript(p, i))
  }
}

rmSync(path.join(out, "packages"), { recursive: true, force: true })
execFileSync("sh", [path.join(root, "scripts/bench/modules.sh"), out], { stdio: "inherit" })
rmSync(path.join(out, "node_modules/@bench"), { recursive: true, force: true })
mkdirSync(path.join(out, "node_modules/@bench"), { recursive: true })
const lastModule = options.modules - 1
for (let p = 0; p < options.packages; p++) {
  const dir = path.join(out, "packages", `p${p}`)
  writePackage(dir, `@bench/p${p}`, p, options.modules)
  write(path.join(dir, "src/index.ts"), `export { run${p}_${lastModule} } from "./m${lastModule}.vibe"\n`)
  symlinkSync(dir, path.join(out, "node_modules/@bench", `p${p}`), "dir")
}
writePackage(path.join(out, "packages/start"), "@bench/start", 0, 1)
const last = `run${options.packages - 1}_${lastModule}`
write(path.join(out, "main.ts"), `import { Effect } from "effect"\nimport { ${last} } from "@bench/p${options.packages - 1}"\nconsole.log(await Effect.runPromise(${last}()))\n`)
const expected = String(options.packages * options.modules * (options.modules + 1))

function timed(command, args, env = {}) {
  const started = performance.now()
  const result = spawnSync(command, args, { cwd: out, encoding: "utf8", env: { ...process.env, ...env }, maxBuffer: 1 << 28 })
  const ms = performance.now() - started
  if (result.status !== 0) {
    console.error(`register.mjs: ${command} ${args.join(" ")} exited with ${result.status}\n${result.stdout}${result.stderr}`)
    process.exit(1)
  }
  return { ms, result }
}

const check = (dir) => timed(compiler, ["-p", path.join(out, "packages", dir, "tsconfig.json"), "--noEmit", "--pretty", "false"]).ms
const samples = { start: [], check: [], cold: [], warm: [], ratio: [] }
let summary = ""
for (let run = 0; run < options.runs; run++) {
  const sample = { start: check("start"), check: check(`p${options.packages - 1}`) }
  const cache = mkdtempSync(path.join(out, "cache-"))
  const env = { VIBELANG_BINARY: compiler, VIBELANG_CACHE_DIR: cache, VIBELANG_DISABLE_CACHE: "", VIBELANG_PROJECT: "", VIBELANG_REGISTER_DEBUG: "1" }
  for (const phase of ["cold", "warm"]) {
    const { ms, result } = timed(process.execPath, ["--import", options.register, "main.ts"], env)
    if (result.stdout.trim() !== expected) {
      console.error(`register.mjs: main.ts printed ${result.stdout.trim()}, not ${expected}`)
      process.exit(1)
    }
    sample[phase] = ms
    if (phase === "cold") summary = result.stderr.trim().split("\n").at(-1)
  }
  rmSync(cache, { recursive: true, force: true })
  sample.ratio = (sample.cold - sample.warm - options.packages * sample.start) / (sample.check - sample.start)
  for (const key of Object.keys(samples)) samples[key].push(sample[key])
}

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const seconds = (ms) => (ms / 1000).toFixed(2)
const [start, checked, cold, warm, ratio] = ["start", "check", "cold", "warm", "ratio"].map((key) => median(samples[key]))
console.log(`${options.packages} packages of ${options.modules} modules, medians of ${options.runs} runs, in ${out}`)
console.log(`start ${seconds(start)} s, check ${seconds(checked)} s, cold ${seconds(cold)} s, warm ${seconds(warm)} s`)
console.log(`ratio ${ratio.toFixed(2)} (budget ${options.budget}); each run: ${samples.ratio.map((value) => value.toFixed(2)).join(", ")}`)
console.log(`last cold run: ${summary}`)
if (ratio > options.budget) {
  console.error(`register.mjs: over budget: the cold start compiled for ${ratio.toFixed(2)} checks of the workspace`)
  process.exit(1)
}
