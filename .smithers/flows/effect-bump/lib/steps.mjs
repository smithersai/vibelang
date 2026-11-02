// The effect-bump flow's steps. Each reads the run directory, does its work in
// the repository the run names, and writes <run>/<step>.json; a step whose
// result exists returns it, so a stopped run resumes where it stopped.
import { spawnSync } from "node:child_process"
import { existsSync, lstatSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import path from "node:path"
import { guard, literals as rewriteLiterals } from "./literals.mjs"

export const STEPS = ["pin", "literals", "install", "build", "regenerate", "probe", "report"]

// The directories whose installs the probes read, beside those whose lockfile
// pin --write names.
const INSTALLS = ["packages/runtime", "experiments", "docs/tools"]

// The checks that compare VibeLang with the installed Effect. Each failure
// names what to change; docs/maintainers/effect-upgrade.md lists them.
export const PROBES = [
  { name: "pins", cwd: ".", command: "node scripts/effect-pin.mjs" },
  { name: "runtime", cwd: "packages/runtime", command: "bun test" },
  { name: "kernel", cwd: "experiments", command: "bun test --timeout=30000" },
  {
    name: "compiler-tables",
    cwd: "typescript/tsc",
    command: "go test -count=1 -trimpath -run '^(TestEffectRootNamesMatchEffect|TestEffectSubpathNamesMatchEffect|TestEffectNameCollisionsDocumented|TestPlatformServicesTable|TestModuleServicesDocumented)$' ./internal/vibelang/",
    env: { CGO_ENABLED: "0" }
  },
  {
    name: "mapper-tables",
    cwd: "typescript/tsc",
    command: "go test -count=1 -trimpath -run '^TestBuiltinContractsGenerated$' ./internal/vibelangmapper/",
    env: { CGO_ENABLED: "0" }
  },
  { name: "forms", cwd: ".", command: "FORMS_NODE_MODULES=$PWD/docs/tools/node_modules bash scripts/check-forms-table.sh" }
]

export const paths = (run) => Object.fromEntries([["options", path.join(run, "options.json")], ...STEPS.map((s) => [s, path.join(run, `${s}.json`)])])

const read = (file) => JSON.parse(readFileSync(file, "utf8"))
const save = (file, value) => {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(value, null, 2) + "\n")
  return value
}

function sh(command, cwd, env = {}) {
  const started = Date.now()
  const p = spawnSync("bash", ["-c", command], { cwd, env: { ...process.env, ...env }, encoding: "utf8", maxBuffer: 256 << 20 })
  const output = (p.stdout ?? "") + (p.stderr ?? "")
  return { command, cwd, code: p.status ?? 1, seconds: Math.round((Date.now() - started) / 1000), output }
}

const tail = (text, lines = 40) => text.trimEnd().split("\n").slice(-lines).join("\n")

function once(run, step, work) {
  const file = paths(run)[step]
  if (existsSync(file)) return read(file)
  return save(file, work(read(paths(run).options)))
}

// pin moves every manifest and version literal to the target version, and
// records the version it moved from.
export const pin = (run) => once(run, "pin", ({ repo, version }) => {
  const from = JSON.parse(readFileSync(path.join(repo, "packages/runtime/package.json"), "utf8")).peerDependencies?.effect
  const r = sh(`node scripts/effect-pin.mjs --write ${version}`, repo)
  if (r.code !== 0) throw new Error(`pin: ${tail(r.output, 10)}`)
  const files = Number(/(\d+) files now pin/.exec(r.output)?.[1] ?? 0)
  const installs = [...r.output.matchAll(/reinstall (\S+)/g)].map((m) => m[1])
  return { ok: true, version, from, files, installs, summary: `${files} files now pin effect ${version} (from ${from})` }
})

// literals moves the old version wherever a tracked file states it as the
// current one: docs, tests, cases and stubs (lib/literals.mjs). The pin guards
// and fixtures it keeps are listed in literals.json, for the fix commits.
export const literals = (run) => once(run, "literals", ({ repo, version }) => {
  const { from } = read(paths(run).pin)
  if (!from || from === version) return { ok: true, changed: [], kept: [], summary: "no version to move" }
  const { changed, kept } = rewriteLiterals(repo, from, version)
  return { ok: true, from, changed, kept, summary: `${changed.length} files now write ${version} for ${from}; ${kept.length} keep ${from} on purpose` }
})

// install refreshes each lockfile pin named and the probes' installs. A
// node_modules that is a link points into a shared install, which an install
// must never write through: the link is removed and a private install made.
export const install = (run) => once(run, "install", ({ repo }) => {
  const dirs = [...new Set([...read(paths(run).pin).installs, ...INSTALLS])].filter((d) => existsSync(path.join(repo, d, "package.json")))
  const results = []
  for (const dir of dirs) {
    const modules = path.join(repo, dir, "node_modules")
    if (existsSync(modules) && lstatSync(modules).isSymbolicLink()) unlinkSync(modules)
    const npm = existsSync(path.join(repo, dir, "package-lock.json"))
    const r = sh(npm ? "npm install --no-audit --no-fund" : "bun install", path.join(repo, dir))
    results.push({ dir, code: r.code, seconds: r.seconds, output: r.code ? tail(r.output, 15) : "" })
  }
  const failed = results.filter((r) => r.code)
  if (failed.length) throw new Error(`install: ${failed.map((r) => `${r.dir}: ${r.output}`).join("\n")}`)
  return { ok: true, results, summary: `installed ${dirs.join(", ")}` }
})

// BUILDS rebuild what the probes run. A build that fails against the new
// Effect is a finding, not a stop: the runtime's sources name Effect's
// modules, so their compile errors are part of what to change.
export const BUILDS = [
  { name: "runtime-build", cwd: "packages/runtime", command: "bun run build" },
  { name: "compiler-build", cwd: ".", command: "sh scripts/build-vibelang.sh" }
]

// check runs one build or probe and records its result and failures.
function check(repo, p, env = {}) {
  const r = sh(p.command, path.join(repo, p.cwd), { ...env, ...p.env })
  return { name: p.name, command: p.command, code: r.code, seconds: r.seconds, failures: r.code ? failures(r.output) : [], output: r.code ? tail(r.output) : "" }
}

const outcome = (results) => {
  const red = results.filter((r) => r.code)
  return { ok: red.length === 0, results, summary: red.length ? `${red.length} of ${results.length} fail: ${red.map((r) => r.name).join(", ")}` : `all ${results.length} pass` }
}

// build rebuilds the runtime and the compiler.
export const build = (run) => once(run, "build", ({ repo }) => outcome(BUILDS.map((b) => check(repo, b))))

// REGENERATE rewrites the generated files whose inputs include Effect's
// declarations or the pin: the compiler's subpath module table (new modules,
// such as 4.1.1's effect/jose), the D252 data methods, the forms table, the
// inventories and docs that docs:generate writes, and the token counts. Like a
// build, a failure is a finding: the forms table refuses a moved decision until
// forms_decisions_approved.txt explains it.
export const REGENERATE = [
  { name: "effect-subpaths", cwd: ".", command: "EFFECT_NODE_MODULES=$PWD/docs/tools/node_modules node scripts/generate-effect-subpaths.mjs --write" },
  { name: "data-methods", cwd: ".", command: "(cd typescript/tsc/cmd/vibelang-data-methods && bun install --frozen-lockfile) && bun typescript/tsc/cmd/vibelang-data-methods/generate.ts" },
  { name: "forms-table", cwd: ".", command: "FORMS_NODE_MODULES=$PWD/docs/tools/node_modules bash scripts/check-forms-table.sh --write" },
  { name: "docs-generate", cwd: ".smithers", command: "bun install --frozen-lockfile && bun run docs:generate" },
  { name: "token-counts", cwd: ".", command: "bun docs/tools/token-counts.ts --write" }
]

// regenerate runs each generator in order against the new install.
export const regenerate = (run) => once(run, "regenerate", ({ repo }) =>
  outcome(REGENERATE.map((g) => check(repo, g, { EFFECT_NODE_MODULES: path.join(repo, "experiments/node_modules") }))))

// failures lists the failing Go tests, bun tests and named checks in a probe's output.
export function failures(output) {
  const out = new Set()
  for (const m of output.matchAll(/^\s*--- FAIL: (\S+)/gm)) out.add(m[1])
  for (const m of output.matchAll(/^\(fail\) (.+?)(?: \[[\d.]+m?s\])?$/gm)) out.add(m[1])
  for (const m of output.matchAll(/^(\S+\(\d+,\d+\): error TS\d+: .*)$/gm)) out.add(m[1])
  for (const m of output.matchAll(/^\s+(\S+: Cannot find module .*)$/gm)) out.add(m[1])
  return [...out]
}

// probe runs every check against the new install and records what failed.
export const probe = (run) => once(run, "probe", ({ repo }) =>
  outcome(PROBES.map((p) => check(repo, p, { EFFECT_NODE_MODULES: path.join(repo, "experiments/node_modules") }))))

// report writes report.md: each failing build and probe, its failing tests
// and the end of its output.
export const report = (run) => once(run, "report", ({ version }) => {
  const results = [...read(paths(run).build).results, ...read(paths(run).regenerate).results, ...read(paths(run).probe).results]
  const moved = read(paths(run).literals)
  const lines = [`# Effect ${version}: what to change`, "", "| Check | Result | Failures |", "| --- | --- | --- |"]
  for (const r of results) lines.push(`| ${r.name} | ${r.code ? "fail" : "pass"} (${r.seconds} s) | ${r.failures.map((f) => "`" + f + "`").join(", ")} |`)
  for (const r of results.filter((r) => r.code)) lines.push("", `## ${r.name}`, "", "`" + r.command + "`", "", "```text", r.output, "```")
  // The pin guards wait for a person; manifests, lockfiles and fixtures keep the old version on purpose.
  const byHand = (moved.kept ?? []).filter((k) => guard(k.glob))
  if (byHand.length) {
    lines.push("", `## Pin guards to move by hand`, "", `The literals step moved ${moved.changed.length} files. These test the versions around the pin: the previous patch is now ${moved.from}, the pin ${version}.`, "")
    for (const k of byHand) lines.push(`- \`${k.file}\` (\`${k.glob}\`)`)
  }
  lines.push("", "docs/maintainers/effect-upgrade.md says what each probe's tables are.")
  writeFileSync(path.join(run, "report.md"), lines.join("\n") + "\n")
  const red = results.filter((r) => r.code)
  return { ok: red.length === 0, failing: red.flatMap((r) => r.failures.length ? r.failures : [r.name]), summary: `report.md: ${red.length} of ${results.length} checks fail` }
})

export const run = { pin, literals, install, build, regenerate, probe, report }

// start records the run's options; the steps read them.
export function start(runDir, options) {
  const file = paths(runDir).options
  if (existsSync(file)) {
    const old = read(file)
    if (old.repo !== options.repo || old.version !== options.version) throw new Error(`${runDir} is a run of effect ${old.version} on ${old.repo}`)
    return old
  }
  return save(file, options)
}
