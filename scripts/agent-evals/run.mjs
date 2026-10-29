#!/usr/bin/env node
// Coding agent evals: runs Claude Code, Codex and opencode headless on small
// .vibe tasks, with and without `vibelang agents init`, and grades each result
// from outside. docs/maintainers/coding-agents.md has the method and results.
//
//   node scripts/agent-evals/run.mjs prepare <dir> [--binary <native vibelang>]
//   node scripts/agent-evals/run.mjs all <dir> [--trials 3] [--jobs 6] [--tasks retry,port] [--agents claude,codex]
//   node scripts/agent-evals/run.mjs trial <dir> <task> <agent> <with|without> <n>
//   node scripts/agent-evals/run.mjs grade <dir>
//   node scripts/agent-evals/run.mjs summary <dir>
//
// prepare packs this checkout's compiler, runtime and Vite plugin into
// <dir>/base, installs them, and puts the native compiler (the checkout's
// build, or --binary for another platform's) in node_modules. The agents run
// with the machine's own login and configuration, and edit files without asking.
import { execFileSync, spawn, spawnSync } from "node:child_process"
import { copyFileSync, cpSync, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = fileURLToPath(new URL(".", import.meta.url))
const repo = resolve(here, "../..")
const agents = {
  claude: (prompt, using) => ["claude", "-p", prompt, "--permission-mode", "bypassPermissions", "--output-format", "stream-json", "--verbose",
    ...(using ? ["--plugin-dir", ".claude/skills/vibelang-lsp"] : [])],
  codex: (prompt, using) => ["codex", "exec", ...(using ? ["--dangerously-bypass-hook-trust"] : []), "-m", "gpt-6.1-sol", "-s", "workspace-write", "--json", prompt],
  opencode: (prompt) => ["opencode", "run", "-m", "kimi-code-plan-global/k3", "--auto", "--format", "json", prompt]
}
const tasks = readdirSync(join(here, "tasks")).sort()
const task = (name) => JSON.parse(readFileSync(join(here, "tasks", name, "task.json"), "utf8"))
const sh = (args, cwd) => spawnSync(args[0], args.slice(1), { cwd, encoding: "utf8", maxBuffer: 1 << 26, timeout: 600_000 })
const strip = (text) => text.replace(/\x1b\[[0-9;]*m/g, "")
// A VibeLang diagnostic in a tool's result: the compiler's, vitest's, or opencode's LSP block.
const diagnostic = /\.vibe[(:]\d+[,:]\d+\)?:? -? ?(?:error|warning) (?:TS|EK)\d+|LSP errors detected/g

function prepare(dir, binary) {
  const base = join(dir, "base")
  rmSync(base, { recursive: true, force: true })
  cpSync(join(here, "sample"), base, { recursive: true })
  mkdirSync(join(base, "vendor"))
  for (const [pkg, name] of [["compiler", "vibelang"], ["runtime", "vibelang-runtime"], ["vite", "vibelang-vite"]]) {
    const file = execFileSync("npm", ["pack", "--silent", "--pack-destination", join(base, "vendor")], { cwd: join(repo, "packages", pkg), encoding: "utf8" }).trim().split("\n").at(-1)
    copyFileSync(join(base, "vendor", file), join(base, "vendor", `${name}.tgz`))
    rmSync(join(base, "vendor", file))
  }
  execFileSync("npm", ["install", "--no-audit", "--no-fund"], { cwd: base, stdio: "inherit" })
  mkdirSync(join(base, "node_modules/vibelang/native"), { recursive: true })
  copyFileSync(binary ?? join(repo, "packages/compiler/native/vibelang"), join(base, "node_modules/vibelang/native/vibelang"))
  execFileSync("chmod", ["+x", join(base, "node_modules/vibelang/native/vibelang")])
  console.log(`prepared ${base}`)
}

const runName = (name, agent, condition, n) => `${name}-${agent}-${condition}-${n}`

async function trial(dir, name, agent, condition, n) {
  const spec = task(name)
  const run = join(dir, "runs", runName(name, agent, condition, n))
  rmSync(run, { recursive: true, force: true })
  mkdirSync(join(dir, "runs"), { recursive: true })
  execFileSync("cp", [process.platform === "darwin" ? "-cR" : "-R", join(dir, "base"), run])
  for (const [from, to] of Object.entries(spec.files)) copyFileSync(join(here, "tasks", name, from), join(run, to))
  writeFileSync(join(run, ".gitignore"), "node_modules\ndist\n")
  if (condition === "with") execFileSync("npx", ["--no", "--", "vibelang", "agents", "init"], { cwd: run })
  execFileSync("jj", ["git", "init", "--colocate"], { cwd: run, stdio: "ignore" })
  execFileSync("jj", ["commit", "-m", "base"], { cwd: run, stdio: "ignore" })
  const before = digest(join(run, spec.test))
  const [command, ...args] = agents[agent](spec.prompt, condition === "with")
  const started = Date.now()
  // opencode reads PWD, not the process's working directory.
  const child = spawn(command, args, { cwd: run, env: { ...process.env, PWD: run }, stdio: ["ignore", "pipe", "pipe"] })
  child.stdout.pipe(createWriteStream(`${run}.transcript.jsonl`))
  child.stderr.pipe(createWriteStream(`${run}.stderr`))
  const timer = setTimeout(() => child.kill("SIGKILL"), 25 * 60_000)
  const exit = await new Promise((done) => child.on("exit", (code, signal) => done(signal ?? code)))
  clearTimeout(timer)
  writeFileSync(`${run}.result.json`, JSON.stringify({ task: name, agent, condition, trial: n, seconds: Math.round((Date.now() - started) / 1000), agentExit: exit, testDigest: before }, null, 2))
  return grade(dir, `${run}.result.json`)
}

function digest(file) {
  return existsSync(file) ? createHash("sha256").update(readFileSync(file)).digest("hex") : null
}

// grade checks a finished run: the test unchanged, the project compiles, the task's test passes.
function grade(dir, resultFile) {
  const result = JSON.parse(readFileSync(resultFile, "utf8"))
  const run = resultFile.slice(0, -".result.json".length)
  // Something on a host may delete node_modules from idle copies; the base's is the same install.
  if (!existsSync(join(run, "node_modules"))) execFileSync("cp", ["-R", join(dir, "base/node_modules"), join(run, "node_modules")])
  const spec = task(result.task)
  const transcript = readFileSync(`${run}.transcript.jsonl`, "utf8")
  const compiled = sh(["npx", "--no", "--", "vibelang", "-p", "tsconfig.test.json", "--noEmit", "--pretty", "false"], run)
  const tested = sh(["npx", "--no", "--", "vitest", "run", spec.test], run)
  const seen = [...transcript.matchAll(diagnostic)].map((match) => match[0])
  Object.assign(result, {
    testsUnchanged: digest(join(run, spec.test)) === result.testDigest,
    compiles: compiled.status === 0,
    testsPass: tested.status === 0,
    sawDiagnostic: seen.length > 0,
    diagnosticCodes: [...new Set(seen.flatMap((text) => text.match(/(?:TS|EK)\d{4}/g) ?? []))].sort(),
    compileOutput: strip(`${compiled.stdout}${compiled.stderr}`).slice(-1500),
    testOutput: strip(`${tested.stdout}${tested.stderr}`).slice(-1500)
  })
  result.pass = result.testsUnchanged && result.compiles && result.testsPass
  writeFileSync(resultFile, JSON.stringify(result, null, 2))
  console.log(`${runName(result.task, result.agent, result.condition, result.trial)}: ${result.pass ? "pass" : "FAIL"}${result.diagnosticCodes.length ? ` saw ${result.diagnosticCodes.join(" ")}` : ""}`)
  return result
}

function results(dir) {
  const runs = join(dir, "runs")
  return existsSync(runs) ? readdirSync(runs).filter((file) => file.endsWith(".result.json")).map((file) => join(runs, file)) : []
}

function summary(dir) {
  const rows = results(dir).map((file) => JSON.parse(readFileSync(file, "utf8")))
  const toolCalls = (r) => {
    const text = readFileSync(join(dir, "runs", `${runName(r.task, r.agent, r.condition, r.trial)}.transcript.jsonl`), "utf8")
    return r.agent === "codex"
      ? (text.match(/"type":"item.completed","item":\{"id":"[^"]+","type":"(?:command_execution|file_change|mcp_tool_call)/g) ?? []).length
      : (text.match(/"type":\s*"tool_use"/g) ?? []).length
  }
  const mean = (rs, f) => (rs.length ? Math.round(rs.reduce((sum, r) => sum + f(r), 0) / rs.length) : "-")
  const lines = ["| Task | Agent | With | Without | Saw a diagnostic (with / without) | Mean seconds (with / without) | Mean tool calls (with / without) |", "| --- | --- | --- | --- | --- | --- | --- |"]
  for (const name of tasks) {
    for (const agent of Object.keys(agents)) {
      const of = (condition) => rows.filter((r) => r.task === name && r.agent === agent && r.condition === condition)
      const [w, wo] = [of("with"), of("without")]
      if (!w.length && !wo.length) continue
      const rate = (rs) => `${rs.filter((r) => r.pass).length}/${rs.length}`
      const saw = (rs) => rs.filter((r) => r.sawDiagnostic).length
      lines.push(`| ${name} | ${agent} | ${rate(w)} | ${rate(wo)} | ${saw(w)} / ${saw(wo)} | ${mean(w, (r) => r.seconds)} / ${mean(wo, (r) => r.seconds)} | ${mean(w, toolCalls)} / ${mean(wo, toolCalls)} |`)
    }
  }
  console.log(lines.join("\n"))
}

async function all(dir, options) {
  const names = options.tasks?.split(",") ?? tasks
  const which = options.agents?.split(",") ?? Object.keys(agents)
  const jobs = []
  for (let n = 1; n <= Number(options.trials ?? 3); n++) {
    for (const name of names) for (const agent of which) for (const condition of ["with", "without"]) jobs.push([name, agent, condition, n])
  }
  const workers = Array.from({ length: Number(options.jobs ?? 6) }, async () => {
    for (let job = jobs.shift(); job; job = jobs.shift()) await trial(dir, ...job)
  })
  await Promise.all(workers)
  summary(dir)
}

const [command, dir, ...rest] = process.argv.slice(2)
const options = Object.fromEntries(rest.flatMap((arg, i) => (arg.startsWith("--") ? [[arg.slice(2), rest[i + 1]]] : [])))
if (!dir) {
  console.error("usage: run.mjs prepare|all|trial|grade|summary <dir> ...")
  process.exit(2)
}
const target = resolve(dir)
if (command === "prepare") prepare(target, options.binary)
else if (command === "all") await all(target, options)
else if (command === "trial") await trial(target, rest[0], rest[1], rest[2], rest[3])
else if (command === "grade") for (const file of results(target)) grade(target, file)
else if (command === "summary") summary(target)
else {
  console.error(`run.mjs: unknown command ${command}`)
  process.exit(2)
}
