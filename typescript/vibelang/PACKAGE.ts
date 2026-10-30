import { readdirSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Smithers as S } from "@smthrs/targets"
import { Package as Packages } from "../../packages/PACKAGE.ts"
import { Package as Typescript } from "../PACKAGE.ts"

// One cached test per compiler case: `//typescript/vibelang:<case>` runs
// `harness.mjs <case>`, keyed on the compiler binary's target, the runtime's
// dist/, the Effect install, the harness, and the case directory's own files.
// A change to one case reruns that case; a compiler change reruns them all.
// `smthrs test //typescript/vibelang/...` runs the suite.
const casesDir = join(dirname(fileURLToPath(import.meta.url)), "cases")
const cases = readdirSync(casesDir)
  .filter((name) => existsSync(join(casesDir, name, "tsconfig.json")))
  .sort()

// What every case reads besides its own directory. EFFECT_NODE_MODULES is
// experiments/node_modules, installed from experiments/bun.lock (the merge
// queue links it to a shared install of the same pinned Effect release).
const shared = [
  Typescript.compiler,
  Packages["runtime-dist"],
  Packages["runtime-published"],
  S.file("//packages/runtime/bun.lock"),
  S.file("//experiments/package.json"),
  S.file("//experiments/bun.lock"),
  S.file("harness.mjs"),
  S.file("harness-command.mjs"),
  S.file("late-start-scheduler.mjs"),
  S.file("rewrite-preservation.mjs")
]

// A label names a target with letters, digits, `_` and `-`; a case name's
// dots become `_`.
const label = (name: string) => name.replaceAll(".", "_")

const targets: Record<string, ReturnType<typeof S.Shell.Test>> = {}
for (const name of cases) {
  targets[label(name)] = S.Shell.Test({
    summary: `Compile and run the compiler case ${name}.`,
    shell: "cd typescript && EFFECT_NODE_MODULES=$PWD/../experiments/node_modules " +
      `VIBELANG_RUNTIME=$PWD/../packages/runtime node vibelang/harness.mjs --verbose ${name}`,
    data: [...shared, S.glob(`cases/${name}/**`)],
    tools: [S.Host.bin("node")],
    sandbox: "none",
    timeout: "5m"
  })
}

// Keep the startup regressions deterministic in the regular compiler suite.
// This aggregate overlaps per-case targets: keep its installs and emits private.
const startupCases = ["uninterruptible-using", "fork-named-region", "fork-arrow-body", "scopes-fork", "ch07-concurrency"]
targets["fork-late-start"] = S.Shell.Test({
  summary: "Fork lifetime checks wait for child readiness under delayed scheduling.",
  shell: "cd typescript && EFFECT_NODE_MODULES=$PWD/../experiments/node_modules " +
    "VIBELANG_RUNTIME=$PWD/../packages/runtime node vibelang/harness.mjs --isolated --late-start --verbose " + startupCases.join(" "),
  data: [...shared, ...startupCases.map((name) => S.glob(`cases/${name}/**`))],
  tools: [S.Host.bin("node")],
  sandbox: "none",
  timeout: "5m"
})

/** Every file in typescript/vibelang, for the repository-wide checks. */
const tree = S.Filegroup({ srcs: [...S.glob(["**"])] })

export const Package = S.Package({ targets: { ...targets, tree } })
