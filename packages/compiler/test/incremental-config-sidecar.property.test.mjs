// Metamorphic incremental-build and sidecar-lifecycle differential fuzzer.
//
// Why this exists:
//   - Issue #664: Incremental build info (.tsbuildinfo) never recorded the
//     `vibe` section, causing stale diagnostics after removing/changing `vibe`
//     settings.
//   - Issue #497: Stale `.d.vibe.ts` sidecars survived deleted `.vibe` files,
//     failed builds rewrote them, and `--build` mode failed to restore missing
//     sidecars.
//
// Universal metamorphic oracle:
//   After ANY sequence of edits to `tsconfig.json` (including adding, changing,
//   or removing `vibe` settings) and `.vibe` sources (edit, error, recover,
//   delete), an incremental `vibelang --incremental -p <dir>` build MUST agree
//   with a fresh clean `vibelang -p <cleanDir>` build on:
//     1. Diagnostic multiset (normalized relative path + diagnostic code).
//     2. Set of `.d.vibe.ts` sidecar files on disk (no stale sidecars, no missing sidecars).
//     3. Emitted `.js` outputs when compilation succeeds.

import { strict as assert } from "node:assert"
import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import fc from "fast-check"
import { checkProperty } from "../../../scripts/testing/property.mjs"

const repo = fileURLToPath(new URL("../../../", import.meta.url))
const compilerBin = process.env.VIBELANG_BINARY || join(repo, "packages/compiler/native/vibelang")
const effectNodeModules = process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules")
const runtimePackageDir = join(repo, "packages/runtime")
const regressions = new URL("./property-regressions/", import.meta.url)
const propertyName = "incremental-config-and-sidecar-equivalence"

const VIBE_CONFIGS = [
  "omitted",
  "globals-true",
  "globals-false",
  "modules-false",
  "sidecar-relocated",
]

const DEP_STATES = ["present-num", "present-str", "absent"]
const MAIN_STATES = ["uses-global", "uses-module", "clean-plain", "type-error"]

function makeTsconfig(vibeMode, noEmitOnError) {
  const cfg = {
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      outDir: "./out",
      rootDir: "./src",
      allowImportingTsExtensions: false,
      noEmitOnError,
      ...(vibeMode === "sidecar-relocated" ? { rootDirs: [".", ".vibe-types"] } : {}),
    },
    include: ["src/**/*.vibe"],
  }
  switch (vibeMode) {
    case "omitted":
      break
    case "globals-true":
      cfg.vibe = { effectGlobals: true }
      break
    case "globals-false":
      cfg.vibe = { effectGlobals: false }
      break
    case "modules-false":
      cfg.vibe = { effectModules: false }
      break
    case "sidecar-relocated":
      cfg.vibe = { sidecarDir: ".vibe-types" }
      break
    default:
      throw new Error(`unknown vibeMode: ${vibeMode}`)
  }
  return JSON.stringify(cfg, null, 2) + "\n"
}

function makeSources(depState, mainState) {
  const files = {}
  if (depState === "present-num") {
    files["src/dep.vibe"] = "export const depValue: number = 42\n"
  } else if (depState === "present-str") {
    files["src/dep.vibe"] = 'export const depValue: string = "hello"\n'
  }

  const depImport = depState !== "absent" ? 'import { depValue } from "./dep.js"\n' : ""
  const depUse = depState !== "absent" ? "export const forwarded = depValue\n" : ""

  switch (mainState) {
    case "uses-global":
      files["src/main.vibe"] =
        `${depImport}${depUse}export effect function run() { try sleep("1 millis"); return 1 }\n`
      break
    case "uses-module":
      files["src/main.vibe"] =
        `${depImport}${depUse}export const dur = Duration.millis(5)\n`
      break
    case "clean-plain":
      files["src/main.vibe"] = `${depImport}${depUse}export const answer = 7\n`
      break
    case "type-error":
      files["src/main.vibe"] = `${depImport}${depUse}export const broken: number = "not-a-number"\n`
      break
    default:
      throw new Error(`unknown mainState: ${mainState}`)
  }
  return files
}

function initDir(prefix) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  const nm = join(dir, "node_modules")
  mkdirSync(nm, { recursive: true })
  symlinkSync(join(effectNodeModules, "effect"), join(nm, "effect"))
  symlinkSync(runtimePackageDir, join(nm, "vibelang-runtime"))
  return dir
}

function syncSources(dir, tsconfigText, sourceFiles) {
  const tsconfigPath = join(dir, "tsconfig.json")
  if (!existsSync(tsconfigPath) || readFileSync(tsconfigPath, "utf8") !== tsconfigText) {
    writeFileSync(tsconfigPath, tsconfigText)
  }
  const srcDir = join(dir, "src")
  mkdirSync(srcDir, { recursive: true })
  // Remove .vibe sources not in sourceFiles (preserve sidecars so we test pruning!).
  for (const name of readdirSync(srcDir)) {
    if (name.endsWith(".vibe") && !(`src/${name}` in sourceFiles)) {
      rmSync(join(srcDir, name), { force: true })
    }
  }
  for (const [rel, content] of Object.entries(sourceFiles)) {
    const abs = join(dir, rel)
    mkdirSync(dirname(abs), { recursive: true })
    // Preserve mtime when file content is unchanged so --incremental exercises .tsbuildinfo reuse!
    if (!existsSync(abs) || readFileSync(abs, "utf8") !== content) {
      writeFileSync(abs, content)
    }
  }
}

function runCompiler(dir, extraArgs = []) {
  const result = spawnSync(compilerBin, [...extraArgs, "-p", dir], {
    cwd: dir,
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, NO_COLOR: "1" },
  })
  assert.ifError(result.error)
  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim(),
  }
}

function parseDiagnostics(dir, output) {
  const entries = []
  for (const line of output.split(/\r?\n/)) {
    const m = line.match(/^(.+?)\(\d+,\d+\): (error|warning) ([A-Z]{2}\d+):/)
    if (m) {
      const rel = m[1].startsWith(dir) ? relative(dir, m[1]) : m[1]
      entries.push(`${rel.replaceAll("\\", "/")}:${m[2]}:${m[3]}`)
    } else {
      const gm = line.match(/^(error|warning) ([A-Z]{2}\d+):/)
      if (gm) entries.push(`<global>:${gm[1]}:${gm[2]}`)
    }
  }
  return entries.sort()
}

function collectOutputs(dir, predicate) {
  const found = {}
  const walk = (cur) => {
    for (const entry of readdirSync(cur, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue
      const abs = join(cur, entry.name)
      const rel = relative(dir, abs).replaceAll("\\", "/")
      if (entry.isDirectory()) walk(abs)
      else if (predicate(rel)) found[rel] = readFileSync(abs, "utf8")
    }
  }
  walk(dir)
  return found
}

class IncrementalVibeConfigBug extends Error {}

function checkTransitionSequence(input) {
  assert.ok(existsSync(compilerBin), `missing compiler binary: ${compilerBin}`)
  assert.ok(existsSync(effectNodeModules), `missing effect node_modules: ${effectNodeModules}`)

  const incDir = initDir("vl-inc-fuzz-")
  try {
    for (let stepIndex = 0; stepIndex < input.steps.length; stepIndex++) {
      const step = input.steps[stepIndex]
      const tsconfig = makeTsconfig(step.vibeMode, step.noEmitOnError)
      const sources = makeSources(step.depState, step.mainState)
      syncSources(incDir, tsconfig, sources)

      const incRes = runCompiler(incDir, ["--incremental"])

      const cleanDir = initDir("vl-clean-fuzz-")
      try {
        syncSources(cleanDir, tsconfig, sources)
        const cleanRes = runCompiler(cleanDir, [])

        const incDiags = parseDiagnostics(incDir, incRes.output)
        const cleanDiags = parseDiagnostics(cleanDir, cleanRes.output)

        if (JSON.stringify(incDiags) !== JSON.stringify(cleanDiags)) {
          const prevVibe = stepIndex > 0 ? input.steps[stepIndex - 1].vibeMode : "initial"
          const msg =
            `step ${stepIndex} (${prevVibe} -> ${step.vibeMode}): incremental diagnostics diverged from clean build\n` +
            `  incremental: ${JSON.stringify(incDiags)}\n` +
            `  clean:       ${JSON.stringify(cleanDiags)}\n` +
            `  inc out:\n${incRes.output}\n  clean out:\n${cleanRes.output}`
          if (stepIndex > 0 && prevVibe !== step.vibeMode) {
            throw new IncrementalVibeConfigBug(`#664: ${msg}`)
          }
          assert.fail(msg)
        }

        const incSidecars = collectOutputs(incDir, (p) => /\.d\.vibex?\.ts$/.test(p))
        const cleanSidecars = collectOutputs(cleanDir, (p) => /\.d\.vibex?\.ts$/.test(p))
        if (cleanRes.status === 0 || !step.noEmitOnError) {
          assert.deepEqual(
            Object.keys(incSidecars).sort(),
            Object.keys(cleanSidecars).sort(),
            `step ${stepIndex}: incremental sidecar file set diverged from clean build`,
          )
        }
      } finally {
        rmSync(cleanDir, { recursive: true, force: true })
      }
    }
  } finally {
    rmSync(incDir, { recursive: true, force: true })
  }
}

test("property: incremental builds with vibe config mutations and file deletions match clean builds", async () => {
  const initialArb = fc.record({
    vibeMode: fc.constantFrom(...VIBE_CONFIGS),
    depState: fc.constantFrom(...DEP_STATES),
    mainState: fc.constantFrom(...MAIN_STATES),
    noEmitOnError: fc.boolean(),
  })
  const mutationArb = fc.oneof(
    // Config-only mutation: sources stay untouched (same content & mtime) so .tsbuildinfo must invalidate on vibe changes!
    fc.record({ kind: fc.constant("config-only"), vibeMode: fc.constantFrom(...VIBE_CONFIGS), noEmitOnError: fc.boolean() }),
    // Source-only mutation: tsconfig stays untouched while files are edited/deleted/restored.
    fc.record({ kind: fc.constant("source-only"), depState: fc.constantFrom(...DEP_STATES), mainState: fc.constantFrom(...MAIN_STATES) }),
    // Combined mutation.
    fc.record({
      kind: fc.constant("both"),
      vibeMode: fc.constantFrom(...VIBE_CONFIGS),
      depState: fc.constantFrom(...DEP_STATES),
      mainState: fc.constantFrom(...MAIN_STATES),
      noEmitOnError: fc.boolean(),
    }),
  )

  const expandSteps = (input) => {
    const steps = [input.initial]
    let cur = input.initial
    for (const m of input.mutations) {
      cur = {
        vibeMode: m.vibeMode ?? cur.vibeMode,
        depState: m.depState ?? cur.depState,
        mainState: m.mainState ?? cur.mainState,
        noEmitOnError: m.noEmitOnError ?? cur.noEmitOnError,
      }
      steps.push(cur)
    }
    return { steps }
  }

  await checkProperty(fc, {
    name: propertyName,
    rule: "Chapter 7 / #664 / #497: incremental compilation across vibe config changes, edits, and deletions matches clean compilation.",
    command: "cd packages/compiler && node --test test/incremental-config-sidecar.property.test.mjs",
    regressions,
    numRuns: 20,
    arbitrary: fc.record({
      initial: initialArb,
      mutations: fc.array(mutationArb, { minLength: 1, maxLength: 2 }),
    }),
    check(input) {
      checkTransitionSequence(expandSteps(input))
    },
  })
})
