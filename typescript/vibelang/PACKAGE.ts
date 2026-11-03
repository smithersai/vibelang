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
  Packages["compiler-native"],
  Packages["runtime-dist"],
  Packages["runtime-published"],
  S.file("//packages/runtime/bun.lock"),
  S.file("//experiments/package.json"),
  S.file("//experiments/bun.lock"),
  S.file("harness.mjs"),
  S.file("harness-command.mjs"),
  S.file("late-start-scheduler.mjs"),
  S.file("rewrite-preservation.mjs"),
  S.file("cases/package.json"),
  S.glob("cases/*.mjs"),
  S.file("//scripts/api-identity.mjs"),
  S.file("//scripts/api-identity-nominal.mjs"),
  S.file("//docs/tools/package.json"),
  S.file("//docs/tools/bun.lock"),
  S.file("//packages/compiler/bin/vibelang"),
  S.file("//packages/compiler/format.mjs"),
  S.file("//packages/compiler/package.json"),
  S.file("//packages/compiler/bun.lock")
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

// The editor smoke shares the graph's compiler and runtime outputs. Its shell
// only links the fixture: it must not rebuild or mutate dependencies another
// target is reading. The compiler key includes the Go language service.
// Editor formatting runs packages/compiler/format.mjs, which loads the dprint
// plugin compiler-native writes beside it.
targets["lsp-smoke"] = S.Shell.Test({
  summary: "Headless language-server checks: diagnostics, hovers, quick fixes, refactors and watching.",
  shell: "EFFECT_NODE_MODULES=$PWD/experiments/node_modules " +
    "VIBELANG_RUNTIME=$PWD/packages/runtime sh typescript/vibelang/lsp-smoke.sh --no-build",
  data: [
    Typescript.compiler,
    Packages["compiler-native"],
    Packages["runtime-dist"],
    Packages["runtime-published"],
    S.file("//packages/compiler/format.mjs"),
    S.file("//packages/compiler/cache.mjs"),
    S.file("//packages/compiler/temporary.mjs"),
    S.file("//packages/compiler/package.json"),
    S.file("//packages/compiler/bun.lock"),
    S.file("//packages/runtime/bun.lock"),
    S.file("//experiments/package.json"),
    S.file("//experiments/bun.lock"),
    S.file("lsp-smoke.sh"),
    S.file("lsp-smoke.mjs"),
    S.file("lsp-format-shape.mjs"),
    S.file("lsp-connection.mjs"),
    S.glob("lsp-fixture/**")
  ],
  tools: [S.Host.bin("node")],
  sandbox: "none",
  timeout: "10m"
})

// These controls exercise the parity oracle itself using real stock
// TypeScript declarations and Effect Exit values, without building VibeLang.
targets["coverage-twin-oracle"] = S.Shell.Test({
  summary: "Coverage parity rejects mismatched success, error, services and Exit values.",
  shell: "EFFECT_NODE_MODULES=$PWD/experiments/node_modules " +
    "node --test typescript/vibelang/coverage-twin.test.mjs",
  data: [
    S.file("coverage-twin.test.mjs"),
    S.file("test/coverage-twin.mjs"),
    S.file("//experiments/package.json"),
    S.file("//experiments/bun.lock"),
    S.file("//packages/runtime/package.json")
  ],
  tools: [S.Host.bin("node")],
  sandbox: "none",
  timeout: "5m"
})

/** Every file in typescript/vibelang, for the repository-wide checks. */
const tree = S.Filegroup({ srcs: [...S.glob(["**"])] })

export const Package = S.Package({ targets: { ...targets, tree } })
