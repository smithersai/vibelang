import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { isDeepStrictEqual } from "node:util"
import { BENCHMARK_VERSION, CATEGORIES, TASKS } from "./index.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))
export const DEFAULT_REPO = path.resolve(here, "../../../..")

const stripAnsi = (text) => String(text ?? "").replace(/\x1b\[[0-9;]*m/g, "")

function normalizeJson(value) {
  return JSON.parse(JSON.stringify(value))
}

function deepEqualJson(a, b) {
  return isDeepStrictEqual(normalizeJson(a), normalizeJson(b))
}

export function resolveBenchmarkToolchain(repo = DEFAULT_REPO) {
  const binary =
    process.env.VIBELANG_BINARY ||
    process.env.VIBELANG ||
    path.join(repo, "packages/compiler/native/vibelang")
  const runtimeDir = process.env.VIBELANG_RUNTIME || path.join(repo, "packages/runtime")
  const runtimeNodeModules = path.join(runtimeDir, "node_modules")
  const docsToolsNodeModules = path.join(repo, "docs/tools/node_modules")
  const nodeModules = existsSync(path.join(runtimeNodeModules, "effect"))
    ? runtimeNodeModules
    : docsToolsNodeModules
  const tscBin = [
    path.join(runtimeNodeModules, "typescript/bin/tsc"),
    path.join(docsToolsNodeModules, "typescript/bin/tsc"),
  ].find((p) => existsSync(p))

  if (!existsSync(binary)) {
    throw new Error(`benchmark-30: missing vibelang native compiler at ${binary} (run sh scripts/build-vibelang.sh)`)
  }
  if (!existsSync(path.join(runtimeDir, "dist"))) {
    throw new Error(`benchmark-30: missing built runtime dist at ${path.join(runtimeDir, "dist")}`)
  }
  if (!existsSync(path.join(nodeModules, "effect"))) {
    throw new Error(`benchmark-30: missing effect installation under ${nodeModules}`)
  }
  if (!tscBin) {
    throw new Error("benchmark-30: missing typescript/bin/tsc in packages/runtime/node_modules or docs/tools/node_modules")
  }

  return {
    repo,
    binary,
    runtimeDir,
    nodeModules,
    docsToolsNodeModules,
    tscBin,
  }
}

function linkBenchmarkModules(workdir, toolchain) {
  const nm = path.join(workdir, "node_modules")
  mkdirSync(nm, { recursive: true })
  symlinkSync(path.join(toolchain.nodeModules, "effect"), path.join(nm, "effect"))
  if (existsSync(path.join(toolchain.nodeModules, "@effect"))) {
    symlinkSync(path.join(toolchain.nodeModules, "@effect"), path.join(nm, "@effect"))
  }
  if (existsSync(path.join(toolchain.nodeModules, "@types"))) {
    symlinkSync(path.join(toolchain.nodeModules, "@types"), path.join(nm, "@types"))
  }
  symlinkSync(toolchain.runtimeDir, path.join(nm, "vibelang-runtime"))
}

function writeTsConfig(dir, fileName, rootDir, include, outDir) {
  const cfg = {
    compilerOptions: {
      target: "ES2022",
      lib: ["ESNext"],
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      types: [],
      skipLibCheck: true,
      rootDir,
      outDir,
    },
    include,
  }
  writeFileSync(path.join(dir, fileName), JSON.stringify(cfg, null, 2))
}

async function runCompiledEffect(jsPath, effectModulePath) {
  const effectMod = await import(pathToFileURL(effectModulePath).href)
  const mod = await import(`${pathToFileURL(jsPath).href}?t=${Date.now()}-${Math.random()}`)
  const eff = typeof mod.run === "function" ? mod.run() : mod.run
  return await effectMod.Effect.runPromise(eff)
}

async function measureTokens(tasks, docsToolsNodeModules) {
  const tiktokenPath = path.join(docsToolsNodeModules, "js-tiktoken/dist/index.js")
  if (!existsSync(tiktokenPath)) return null
  try {
    const { getEncoding } = await import(pathToFileURL(tiktokenPath).href)
    const enc = getEncoding("o200k_base")
    let vibeTokens = 0
    let effectTsTokens = 0
    const perTask = {}
    for (const task of tasks) {
      const v = enc.encode(task.vibe).length
      const e = enc.encode(task.effectTs).length
      vibeTokens += v
      effectTsTokens += e
      perTask[task.id] = { vibe: v, effectTs: e }
    }
    const reductionPct = Number((((effectTsTokens - vibeTokens) / effectTsTokens) * 100).toFixed(1))
    return { encoding: "o200k_base", vibeTokens, effectTsTokens, reductionPct, perTask }
  } catch {
    return null
  }
}

export async function verifySingleTask(task, mode, toolchain = resolveBenchmarkToolchain()) {
  const workdir = mkdtempSync(path.join(os.tmpdir(), `vibe-bench30-${task.id}-${mode}-`))
  try {
    writeFileSync(path.join(workdir, "package.json"), JSON.stringify({ name: "benchmark-30", type: "module" }))
    linkBenchmarkModules(workdir, toolchain)
    const effectIndex = path.join(workdir, "node_modules/effect/dist/index.js")

    if (mode === "vibe-reference") {
      mkdirSync(path.join(workdir, "src"), { recursive: true })
      writeFileSync(path.join(workdir, "src/task.vibe"), task.vibe)
      writeTsConfig(workdir, "tsconfig.json", "src", ["src/task.vibe"], "out")
      const compiled = spawnSync(toolchain.binary, ["-p", "tsconfig.json"], {
        cwd: workdir,
        encoding: "utf8",
        timeout: 30_000,
      })
      const output = stripAnsi(`${compiled.stdout ?? ""}${compiled.stderr ?? ""}`).trim()
      if (compiled.status !== 0) {
        return { pass: false, mode, taskId: task.id, stage: "compile", detail: output }
      }
      try {
        const actual = await runCompiledEffect(path.join(workdir, "out/task.js"), effectIndex)
        const ok = deepEqualJson(actual, task.expectedOutput)
        return {
          pass: ok,
          mode,
          taskId: task.id,
          stage: "runtime",
          detail: ok ? "ok" : `expected ${JSON.stringify(task.expectedOutput)}, got ${JSON.stringify(actual)}`,
        }
      } catch (err) {
        return { pass: false, mode, taskId: task.id, stage: "runtime", detail: String(err) }
      }
    }

    if (mode === "effect-ts-reference") {
      mkdirSync(path.join(workdir, "src"), { recursive: true })
      writeFileSync(path.join(workdir, "src/task.ts"), task.effectTs)
      writeTsConfig(workdir, "tsconfig.json", "src", ["src/task.ts"], "out")
      const compiled = spawnSync(process.execPath, [toolchain.tscBin, "-p", "tsconfig.json"], {
        cwd: workdir,
        encoding: "utf8",
        timeout: 30_000,
      })
      const output = stripAnsi(`${compiled.stdout ?? ""}${compiled.stderr ?? ""}`).trim()
      if (compiled.status !== 0) {
        return { pass: false, mode, taskId: task.id, stage: "compile", detail: output }
      }
      try {
        const actual = await runCompiledEffect(path.join(workdir, "out/task.js"), effectIndex)
        const ok = deepEqualJson(actual, task.expectedOutput)
        return {
          pass: ok,
          mode,
          taskId: task.id,
          stage: "runtime",
          detail: ok ? "ok" : `expected ${JSON.stringify(task.expectedOutput)}, got ${JSON.stringify(actual)}`,
        }
      } catch (err) {
        return { pass: false, mode, taskId: task.id, stage: "runtime", detail: String(err) }
      }
    }

    if (mode === "fault-control") {
      mkdirSync(path.join(workdir, "src"), { recursive: true })
      writeFileSync(path.join(workdir, "src/fault.vibe"), task.fault.vibe)
      writeTsConfig(workdir, "tsconfig.json", "src", ["src/fault.vibe"], "out")
      const compiled = spawnSync(toolchain.binary, ["-p", "tsconfig.json"], {
        cwd: workdir,
        encoding: "utf8",
        timeout: 30_000,
      })
      const output = stripAnsi(`${compiled.stdout ?? ""}${compiled.stderr ?? ""}`).trim()
      if (task.fault.kind === "compile-error") {
        const pattern = task.fault.expectedPattern ? new RegExp(task.fault.expectedPattern) : /error (?:EK|TS)\d+/
        const ok = compiled.status !== 0 && pattern.test(output)
        return {
          pass: ok,
          mode,
          taskId: task.id,
          stage: "fault-compile",
          detail: ok ? `caught (${task.fault.expectedPattern ?? "error"})` : `expected compile error ${pattern}, exit=${compiled.status}: ${output}`,
        }
      }
      if (compiled.status !== 0) {
        return {
          pass: false,
          mode,
          taskId: task.id,
          stage: "fault-compile",
          detail: `runtime-fail control unexpectedly failed to compile: ${output}`,
        }
      }
      try {
        const actual = await runCompiledEffect(path.join(workdir, "out/fault.js"), effectIndex)
        const ok = !deepEqualJson(actual, task.expectedOutput)
        return {
          pass: ok,
          mode,
          taskId: task.id,
          stage: "fault-runtime",
          detail: ok ? "caught runtime mismatch" : `fault control unexpectedly matched expected output ${JSON.stringify(actual)}`,
        }
      } catch (err) {
        return {
          pass: true,
          mode,
          taskId: task.id,
          stage: "fault-runtime",
          detail: `caught runtime failure: ${String(err).slice(0, 120)}`,
        }
      }
    }

    throw new Error(`benchmark-30: unknown mode ${mode}`)
  } finally {
    rmSync(workdir, { recursive: true, force: true })
  }
}

export async function verifyBenchmark30(options = {}) {
  const toolchain = resolveBenchmarkToolchain(options.repo ?? DEFAULT_REPO)
  const selected = TASKS.filter((t) => {
    if (options.task && t.id !== options.task) return false
    if (options.category && t.category !== options.category) return false
    return true
  })
  if (selected.length === 0) {
    throw new Error("benchmark-30: no tasks matched selection")
  }

  const workdir = mkdtempSync(path.join(os.tmpdir(), "vibe-bench30-batch-"))
  const started = Date.now()
  try {
    writeFileSync(path.join(workdir, "package.json"), JSON.stringify({ name: "benchmark-30", type: "module" }))
    linkBenchmarkModules(workdir, toolchain)
    mkdirSync(path.join(workdir, "vibe-src"), { recursive: true })
    mkdirSync(path.join(workdir, "ts-src"), { recursive: true })
    mkdirSync(path.join(workdir, "fault-rt-src"), { recursive: true })

    for (const task of selected) {
      writeFileSync(path.join(workdir, "vibe-src", `${task.id}.vibe`), task.vibe)
      writeFileSync(path.join(workdir, "ts-src", `${task.id}.ts`), task.effectTs)
      if (task.fault.kind === "runtime-fail") {
        writeFileSync(path.join(workdir, "fault-rt-src", `${task.id}.vibe`), task.fault.vibe)
      }
    }

    writeTsConfig(workdir, "tsconfig.vibe.json", "vibe-src", ["vibe-src/*.vibe"], "out-vibe")
    writeTsConfig(workdir, "tsconfig.ts.json", "ts-src", ["ts-src/*.ts"], "out-ts")
    const hasRuntimeFaults = selected.some((t) => t.fault.kind === "runtime-fail")
    if (hasRuntimeFaults) {
      writeTsConfig(workdir, "tsconfig.fault-rt.json", "fault-rt-src", ["fault-rt-src/*.vibe"], "out-fault-rt")
    }

    const vibeCompile = spawnSync(toolchain.binary, ["-p", "tsconfig.vibe.json"], {
      cwd: workdir,
      encoding: "utf8",
      timeout: 60_000,
    })
    const tsCompile = spawnSync(process.execPath, [toolchain.tscBin, "-p", "tsconfig.ts.json"], {
      cwd: workdir,
      encoding: "utf8",
      timeout: 60_000,
    })
    const faultRtCompile = hasRuntimeFaults
      ? spawnSync(toolchain.binary, ["-p", "tsconfig.fault-rt.json"], {
          cwd: workdir,
          encoding: "utf8",
          timeout: 60_000,
        })
      : { status: 0, stdout: "", stderr: "" }

    const effectIndex = path.join(workdir, "node_modules/effect/dist/index.js")
    const results = []

    for (const task of selected) {
      const vibeJs = path.join(workdir, "out-vibe", `${task.id}.js`)
      let vibeCheck
      if (vibeCompile.status !== 0 || !existsSync(vibeJs)) {
        vibeCheck = await verifySingleTask(task, "vibe-reference", toolchain)
      } else {
        try {
          const actual = await runCompiledEffect(vibeJs, effectIndex)
          const ok = deepEqualJson(actual, task.expectedOutput)
          vibeCheck = {
            pass: ok,
            mode: "vibe-reference",
            taskId: task.id,
            stage: "runtime",
            detail: ok ? "ok" : `expected ${JSON.stringify(task.expectedOutput)}, got ${JSON.stringify(actual)}`,
          }
        } catch (err) {
          vibeCheck = { pass: false, mode: "vibe-reference", taskId: task.id, stage: "runtime", detail: String(err) }
        }
      }

      const tsJs = path.join(workdir, "out-ts", `${task.id}.js`)
      let tsCheck
      if (tsCompile.status !== 0 || !existsSync(tsJs)) {
        tsCheck = await verifySingleTask(task, "effect-ts-reference", toolchain)
      } else {
        try {
          const actual = await runCompiledEffect(tsJs, effectIndex)
          const ok = deepEqualJson(actual, task.expectedOutput)
          tsCheck = {
            pass: ok,
            mode: "effect-ts-reference",
            taskId: task.id,
            stage: "runtime",
            detail: ok ? "ok" : `expected ${JSON.stringify(task.expectedOutput)}, got ${JSON.stringify(actual)}`,
          }
        } catch (err) {
          tsCheck = { pass: false, mode: "effect-ts-reference", taskId: task.id, stage: "runtime", detail: String(err) }
        }
      }

      let faultCheck
      if (task.fault.kind === "compile-error") {
        faultCheck = await verifySingleTask(task, "fault-control", toolchain)
      } else {
        const faultJs = path.join(workdir, "out-fault-rt", `${task.id}.js`)
        if (faultRtCompile.status !== 0 || !existsSync(faultJs)) {
          faultCheck = await verifySingleTask(task, "fault-control", toolchain)
        } else {
          try {
            const actual = await runCompiledEffect(faultJs, effectIndex)
            const ok = !deepEqualJson(actual, task.expectedOutput)
            faultCheck = {
              pass: ok,
              mode: "fault-control",
              taskId: task.id,
              stage: "fault-runtime",
              detail: ok ? "caught runtime mismatch" : `fault unexpectedly matched expected output`,
            }
          } catch (err) {
            faultCheck = {
              pass: true,
              mode: "fault-control",
              taskId: task.id,
              stage: "fault-runtime",
              detail: `caught runtime failure: ${String(err).slice(0, 120)}`,
            }
          }
        }
      }

      results.push({
        id: task.id,
        category: task.category,
        title: task.title,
        vibe: vibeCheck,
        effectTs: tsCheck,
        fault: faultCheck,
        pass: vibeCheck.pass && tsCheck.pass && faultCheck.pass,
      })
    }

    const tokens = await measureTokens(selected, toolchain.docsToolsNodeModules)
    const compilerVersion = stripAnsi(
      spawnSync(toolchain.binary, ["--version"], { encoding: "utf8" }).stdout ?? ""
    ).trim()
    const effectPkg = JSON.parse(readFileSync(path.join(toolchain.nodeModules, "effect/package.json"), "utf8"))
    const tsPkg = JSON.parse(readFileSync(path.join(path.dirname(toolchain.tscBin), "../package.json"), "utf8"))

    const summary = {
      benchmark: BENCHMARK_VERSION,
      elapsedMs: Date.now() - started,
      versions: {
        vibelang: compilerVersion,
        effect: effectPkg.version,
        typescript: tsPkg.version,
        runtime: process.version,
      },
      categories: CATEGORIES.map((c) => c.id),
      totals: {
        tasks: results.length,
        tasksPassed: results.filter((r) => r.pass).length,
        vibePassed: results.filter((r) => r.vibe.pass).length,
        effectTsPassed: results.filter((r) => r.effectTs.pass).length,
        faultsCaught: results.filter((r) => r.fault.pass).length,
        compileTimeFaults: selected.filter((t) => t.fault.kind === "compile-error").length,
        runtimeFaults: selected.filter((t) => t.fault.kind === "runtime-fail").length,
      },
      tokens,
      manifestDigest: createHash("sha256").update(JSON.stringify(selected)).digest("hex").slice(0, 16),
      results,
    }
    return summary
  } finally {
    rmSync(workdir, { recursive: true, force: true })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  const jsonMode = args.includes("--json")
  const categoryArg = args.find((a) => a.startsWith("--category="))?.split("=")[1]
  const taskArg = args.find((a) => a.startsWith("--task="))?.split("=")[1]

  const report = await verifyBenchmark30({ category: categoryArg, task: taskArg })
  if (jsonMode) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(`VibeLang ${report.benchmark} (${report.versions.vibelang}, effect@${report.versions.effect}, ts@${report.versions.typescript})`)
    for (const r of report.results) {
      const mark = r.pass ? "PASS" : "FAIL"
      console.log(`  [${mark}] ${r.id} (${r.category}) — vibe:${r.vibe.pass ? "ok" : "FAIL"} effectTs:${r.effectTs.pass ? "ok" : "FAIL"} fault:${r.fault.pass ? r.fault.detail : "FAIL"}`)
      if (!r.vibe.pass) console.log(`         vibe detail: ${r.vibe.detail}`)
      if (!r.effectTs.pass) console.log(`         effectTs detail: ${r.effectTs.detail}`)
      if (!r.fault.pass) console.log(`         fault detail: ${r.fault.detail}`)
    }
    console.log(
      `Summary: ${report.totals.tasksPassed}/${report.totals.tasks} tasks passed ` +
        `(vibe ${report.totals.vibePassed}/${report.totals.tasks}, effectTs ${report.totals.effectTsPassed}/${report.totals.tasks}, faults ${report.totals.faultsCaught}/${report.totals.tasks}) ` +
        `in ${report.elapsedMs}ms`
    )
    if (report.tokens) {
      console.log(
        `Tokens (${report.tokens.encoding}): Vibe=${report.tokens.vibeTokens} vs EffectTS=${report.tokens.effectTsTokens} (${report.tokens.reductionPct}% fewer tokens)`
      )
    }
  }
  if (report.totals.tasksPassed !== report.totals.tasks) {
    process.exitCode = 1
  }
}
