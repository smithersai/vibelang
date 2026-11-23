import { Smithers as S } from "@smthrs/targets"
import { Package as Packages } from "../../packages/PACKAGE.ts"
import { Package as Tsc } from "../../typescript/tsc/PACKAGE.ts"

const node = S.Host.bin("node")
const go = S.Host.bin("go")
const python3 = S.Host.bin("python3")

const harnessFiles = [S.file("lib/harness.mjs")]
const goRunnerFiles = [S.file("lib/go-bench-runner.mjs"), S.file("lib/harness.mjs")]

const runtimeDeps = [
  Packages["runtime-dist"],
  S.file("//packages/runtime/package.json"),
  S.file("//packages/runtime/bun.lock")
]

const compilerE2eDeps = [
  Packages["compiler-native"],
  Packages["runtime-dist"],
  Packages["runtime-published"],
  S.file("//experiments/package.json"),
  S.file("//experiments/bun.lock"),
  S.file("modules.sh")
]

const benchBuild = (
  name: string,
  summary: string,
  script: string,
  data: ReadonlyArray<unknown>,
  tools: ReadonlyArray<typeof node> = [node],
  timeout = "5m"
) => {
  const outFile = `//.cache/bench/results/${name}.json`
  return S.Shell.Build({
    summary,
    shell: `node scripts/bench/suites/${script} --out .cache/bench/results/${name}.json`,
    data: [...harnessFiles, S.file(`suites/${script}`), ...data] as Array<never>,
    tools: [...tools],
    outFiles: [outFile],
    sandbox: "none",
    timeout
  })
}

const goBenchBuild = (
  name: string,
  summary: string,
  pkg: string,
  benchRegex: string,
  extraData: ReadonlyArray<unknown>
) => {
  const outFile = `//.cache/bench/results/${name}.json`
  return S.Shell.Build({
    summary,
    shell: `node scripts/bench/lib/go-bench-runner.mjs --suite ${name} --pkg ${pkg} --bench '${benchRegex}' --benchtime 150ms --count 5 --out .cache/bench/results/${name}.json`,
    data: [...goRunnerFiles, Tsc.srcs, ...extraData] as Array<never>,
    tools: [node, go],
    outFiles: [outFile],
    sandbox: "none",
    timeout: "10m"
  })
}

// ---------------------------------------------------------------------------
// Runtime benchmarks (keyed ONLY on packages/runtime)
// ---------------------------------------------------------------------------
const runtimeFastcalls = benchBuild(
  "runtime-fastcalls",
  "Benchmark runtime fast-call protocol ($direct, $fast, $done, $settle, $isRun) vs Effect.fn.",
  "runtime-fastcalls.bench.mjs",
  runtimeDeps
)

const runtimeProvide = benchBuild(
  "runtime-provide",
  "Benchmark runtime service and layer provision ($provideEntries, $provideService).",
  "runtime-provide.bench.mjs",
  runtimeDeps
)

const runtimeMatch = benchBuild(
  "runtime-match",
  "Benchmark runtime pattern matching helpers ($is, $extract, $rest, $relation, $matchCache).",
  "runtime-match.bench.mjs",
  runtimeDeps
)

const runtimeConcurrency = benchBuild(
  "runtime-concurrency",
  "Benchmark runtime fibers, $forConcurrent, $tryAll/$tryRace, $catch, and $produce streams.",
  "runtime-concurrency.bench.mjs",
  runtimeDeps
)

const runtimeCompiledLoops = benchBuild(
  "runtime-compiled-loops",
  "Benchmark compiled .vibe try/catch/plain loops against hand-written Effect TS loops.",
  "runtime-compiled-loops.bench.mjs",
  [
    ...compilerE2eDeps,
    S.file("//docs/user/benchmarks/runtime-cost/tsconfig.json"),
    S.file("//docs/user/benchmarks/runtime-cost/src/vibe-loops.vibe"),
    S.file("//docs/user/benchmarks/runtime-cost/src/effect-loops.ts")
  ]
)

// ---------------------------------------------------------------------------
// End-to-end native compiler, LSP, and register benchmarks
// ---------------------------------------------------------------------------
const compilerE2e = benchBuild(
  "compiler-e2e",
  "Benchmark native compiler check+emit wall time and RSS on synthetic chain/dense/single projects.",
  "compiler-e2e.bench.mjs",
  [...compilerE2eDeps, S.file("gen-synthetic.mjs"), S.file("measure.py")],
  [node, python3],
  "10m"
)

const lspE2e = benchBuild(
  "lsp-e2e",
  "Benchmark headless LSP initialize, cold/warm diagnostics, and hover latency.",
  "lsp-e2e.bench.mjs",
  [...compilerE2eDeps, S.file("gen-synthetic.mjs"), S.file("//typescript/vibelang/lsp-framing.mjs")],
  [node],
  "10m"
)

const registerE2e = benchBuild(
  "register-e2e",
  "Benchmark vibelang/register cold vs warm startup latency across multi-package workspaces.",
  "register-e2e.bench.mjs",
  [
    ...compilerE2eDeps,
    S.file("register.mjs"),
    S.file("//packages/compiler/register.mjs"),
    S.file("//packages/compiler/register-prefill.mjs"),
    S.file("//packages/compiler/project.mjs"),
    S.file("//packages/compiler/cache.mjs"),
    S.file("//packages/compiler/binary.mjs"),
    S.file("//packages/compiler/compiler-override.mjs"),
    S.file("//packages/compiler/paths-imports.mjs"),
    S.file("//packages/compiler/relative-imports.mjs"),
    S.file("//packages/compiler/vibe-directive.mjs"),
    S.file("//packages/compiler/emitted-js.mjs"),
    S.file("//packages/compiler/temporary.mjs")
  ],
  [node],
  "10m"
)

// ---------------------------------------------------------------------------
// JS compiler package, adapters, bundlers, and CLI startup benchmarks
// ---------------------------------------------------------------------------
const compilerJs = benchBuild(
  "compiler-js-helpers",
  "Benchmark packages/compiler hot JS helpers (paths-imports, relative-imports, directive, JSONC, oxlint spans).",
  "compiler-js.bench.mjs",
  [
    S.file("//packages/compiler/paths-imports.mjs"),
    S.file("//packages/compiler/relative-imports.mjs"),
    S.file("//packages/compiler/vibe-directive.mjs"),
    S.file("//packages/compiler/emitted-js.mjs"),
    S.file("//packages/compiler/cache.mjs"),
    S.file("//packages/compiler/oxlint.mjs"),
    S.file("//packages/compiler/binary.mjs"),
    S.file("//packages/compiler/compiler-override.mjs"),
    S.file("//packages/compiler/temporary.mjs")
  ]
)

const compilerTools = benchBuild(
  "compiler-tools",
  "Benchmark packages/compiler ESLint parser (parseForESLint) and formatter (formatSource) adapters.",
  "compiler-tools.bench.mjs",
  [
    Packages["compiler-native"],
    S.file("//packages/compiler/eslint.mjs"),
    S.file("//packages/compiler/format.mjs"),
    S.file("//packages/compiler/binary.mjs"),
    S.file("//packages/compiler/compiler-override.mjs"),
    S.file("//packages/compiler/cache.mjs"),
    S.file("//packages/compiler/temporary.mjs"),
    S.file("//packages/compiler/package.json"),
    S.file("//packages/compiler/bun.lock"),
    S.file("//packages/compiler/test/eslint/package.json"),
    S.file("//packages/compiler/test/eslint/bun.lock")
  ]
)

const bundlers = benchBuild(
  "bundlers",
  "Benchmark packages/vite and packages/unplugin resolver, directive, and filter helpers.",
  "bundlers.bench.mjs",
  [
    S.file("//packages/vite/src/paths-imports.js"),
    S.file("//packages/vite/src/relative-imports.js"),
    S.file("//packages/vite/src/vibe-directive.js"),
    S.file("//packages/unplugin/src/index.js"),
    S.file("//packages/unplugin/src/vibe-directive.js"),
    S.file("//packages/unplugin/src/relative-imports.js"),
    S.file("//packages/unplugin/src/relative-output.js"),
    S.file("//packages/unplugin/src/declarations.js"),
    S.file("//packages/unplugin/src/jsx-config.js"),
    S.file("//packages/unplugin/src/bundler-api.js"),
    S.file("//packages/unplugin/src/bun-migrated-imports.js"),
    S.file("//packages/unplugin/src/missing-watcher.js"),
    S.file("//packages/unplugin/src/deferred.js"),
    S.file("//packages/unplugin/package.json"),
    S.file("//packages/unplugin/bun.lock")
  ]
)

const cliStartup = benchBuild(
  "cli-startup",
  "Benchmark CLI startup latency across native binary, vibelang bin, and typescript-shim.",
  "typescript-shim.bench.mjs",
  [
    Packages["compiler-native"],
    S.file("//packages/compiler/bin/vibelang"),
    S.file("//packages/compiler/binary.mjs"),
    S.file("//packages/compiler/compiler-override.mjs"),
    S.file("//packages/compiler/package.json"),
    S.file("//packages/typescript-shim/bin/tsc"),
    S.file("//packages/typescript-shim/launcher.mjs"),
    S.file("//packages/typescript-shim/package.json")
  ]
)

// ---------------------------------------------------------------------------
// Repository tooling, API identity, migration, and docs benchmarks
// ---------------------------------------------------------------------------
const apiIdentity = benchBuild(
  "api-identity",
  "Benchmark published declaration identity comparator (scripts/api-identity.mjs).",
  "api-identity.bench.mjs",
  [
    S.file("//scripts/api-identity.mjs"),
    S.file("//scripts/api-identity-nominal.mjs"),
    S.file("//scripts/api-identity-ambient.mjs"),
    S.file("//scripts/api-identity-ownership.mjs"),
    S.file("//scripts/api-identity-diagnostics-cache.mjs"),
    S.file("//docs/tools/package.json"),
    S.file("//docs/tools/bun.lock")
  ]
)

const migrateFlow = benchBuild(
  "migrate-flow",
  "Benchmark migration static analyzers (reference-mask comment scan and source-path glob rewriter).",
  "migrate-flow.bench.mjs",
  [
    S.file("//packages/runtime/package.json"),
    S.file("//packages/runtime/bun.lock"),
    S.file("//.smithers/flows/migrate/lib/references.mjs"),
    S.file("//.smithers/flows/migrate/lib/source-paths.mjs"),
    S.file("//.smithers/flows/migrate/test/corpus/alchemy-generated-service-comment-scan.json"),
    S.file("//.smithers/flows/migrate/test/corpus/foldkit-selector-brace-literals.json")
  ]
)

const docsTools = benchBuild(
  "docs-tools",
  "Benchmark docs tooling (throws-inventory declaration scan and serialization).",
  "docs-tools.bench.mjs",
  [
    Packages["runtime-dist"],
    S.file("//docs/tools/throws-inventory.mjs"),
    S.file("//docs/tools/package.json"),
    S.file("//docs/tools/bun.lock"),
    S.file("//docs/design/inventory/throws.json"),
    S.file("//experiments/package.json"),
    S.file("//experiments/bun.lock")
  ]
)

// ---------------------------------------------------------------------------
// Go compiler internal microbenchmarks (each keyed on its own Go package)
// ---------------------------------------------------------------------------
const goScanner = goBenchBuild(
  "go-scanner",
  "Go microbenchmarks for internal/scanner lexing VibeLang sources.",
  "./internal/scanner",
  "^BenchmarkScannerVibeLang$",
  [S.file("//typescript/tsc/internal/scanner/vibelang_bench_test.go")]
)

const goParser = goBenchBuild(
  "go-parser",
  "Go microbenchmarks for internal/parser parsing .vibe and .vibex sources.",
  "./internal/parser",
  "^BenchmarkParserVibeLang$",
  [S.file("//typescript/tsc/internal/parser/vibelang_bench_test.go")]
)

const goVibelang = goBenchBuild(
  "go-vibelang",
  "Go microbenchmarks for internal/vibelang check+emit and bangTypes.",
  "./internal/vibelang",
  "^Benchmark(BangTypes|VibeLangCheckAndEmit)$",
  [Tsc["vibelang-files"]]
)

const goVibelangfmt = goBenchBuild(
  "go-vibelangfmt",
  "Go microbenchmarks for internal/vibelangfmt Format, encode/decode, SameProgram, and ZIP packing.",
  "./internal/vibelangfmt",
  "^Benchmark(Format|EncodeDecode|WriteArchive)$",
  [S.file("//typescript/tsc/internal/vibelangfmt/vibelangfmt_bench_test.go")]
)

const goVibelangestree = goBenchBuild(
  "go-vibelangestree",
  "Go microbenchmarks for internal/vibelangestree ESTree JSON export.",
  "./internal/vibelangestree",
  "^BenchmarkEstreeParse$",
  [S.file("//typescript/tsc/internal/vibelangestree/estree_bench_test.go")]
)

const goVibelangmapper = goBenchBuild(
  "go-vibelangmapper",
  "Go microbenchmarks for internal/vibelangmapper Project and Emit.",
  "./internal/vibelangmapper",
  "^BenchmarkMapperProjectAndEmit$",
  [Tsc["vibelangmapper-files"]]
)

const goLs = goBenchBuild(
  "go-ls",
  "Go microbenchmarks for internal/ls diagnostics, hover, completions, and incremental DidChange.",
  "./internal/ls",
  "^BenchmarkLanguageServiceVibeLang$",
  [S.file("//typescript/tsc/internal/ls/vibelang_bench_test.go")]
)

const jsBenchTargets = [
  runtimeFastcalls,
  runtimeProvide,
  runtimeMatch,
  runtimeConcurrency,
  runtimeCompiledLoops,
  compilerE2e,
  lspE2e,
  registerE2e,
  compilerJs,
  compilerTools,
  bundlers,
  cliStartup,
  apiIdentity,
  migrateFlow,
  docsTools
]

const goBenchTargets = [
  goScanner,
  goParser,
  goVibelang,
  goVibelangfmt,
  goVibelangestree,
  goVibelangmapper,
  goLs
]

const jsResultPaths = [
  "runtime-fastcalls",
  "runtime-provide",
  "runtime-match",
  "runtime-concurrency",
  "runtime-compiled-loops",
  "compiler-e2e",
  "lsp-e2e",
  "register-e2e",
  "compiler-js-helpers",
  "compiler-tools",
  "bundlers",
  "cli-startup",
  "api-identity",
  "migrate-flow",
  "docs-tools"
].map((name) => `.cache/bench/results/${name}.json`)

const goResultPaths = [
  "go-scanner",
  "go-parser",
  "go-vibelang",
  "go-vibelangfmt",
  "go-vibelangestree",
  "go-vibelangmapper",
  "go-ls"
].map((name) => `.cache/bench/results/${name}.json`)

const reportCommand = (files: ReadonlyArray<string>, outBase: string) =>
  `node scripts/bench/report.mjs ${files.join(" ")} --baseline scripts/bench/baseline.json --json ${outBase}.json --md ${outBase}.md --html ${outBase}.html`

const reportJs = S.Shell.Build({
  summary: "Aggregate all JS, runtime, bundler, tooling, and E2E benchmark results into JSON, Markdown, and HTML reports.",
  shell: reportCommand(jsResultPaths, ".cache/bench/report-js"),
  data: [...jsBenchTargets, S.file("report.mjs"), S.file("baseline.json")],
  tools: [node],
  outFiles: [
    "//.cache/bench/report-js.json",
    "//.cache/bench/report-js.md",
    "//.cache/bench/report-js.html"
  ],
  sandbox: "none",
  timeout: "2m"
})

const reportGo = S.Shell.Build({
  summary: "Aggregate all Go compiler internal microbenchmark results into JSON, Markdown, and HTML reports.",
  shell: reportCommand(goResultPaths, ".cache/bench/report-go"),
  data: [...goBenchTargets, S.file("report.mjs"), S.file("baseline.json")],
  tools: [node],
  outFiles: [
    "//.cache/bench/report-go.json",
    "//.cache/bench/report-go.md",
    "//.cache/bench/report-go.html"
  ],
  sandbox: "none",
  timeout: "2m"
})

const report = S.Shell.Build({
  summary: "Aggregate every VibeLang benchmark suite (Go compiler, E2E, runtime, packages, bundlers, tooling) into JSON, Markdown, and HTML.",
  shell: reportCommand([...goResultPaths, ...jsResultPaths], ".cache/bench/report"),
  data: [...goBenchTargets, ...jsBenchTargets, S.file("report.mjs"), S.file("baseline.json")],
  tools: [node],
  outFiles: [
    "//.cache/bench/report.json",
    "//.cache/bench/report.md",
    "//.cache/bench/report.html"
  ],
  sandbox: "none",
  timeout: "2m"
})

// Exclusive long-running scaling benchmarks (omitted from wildcard ci unless --include-exclusive).
const compilerScaling = S.Shell.Test({
  summary: "Full multi-size compiler scaling matrix (50/100/200/400 modules x chain/dense/single + examples + docs corpus).",
  shell: "sh scripts/bench/compiler.sh --runs 3",
  data: [...compilerE2eDeps, S.file("compiler.sh"), S.file("gen-synthetic.mjs"), S.file("measure.py")],
  tools: [node, S.Host.bin("bun"), python3],
  sandbox: "none",
  exclusive: true,
  timeout: "30m"
})

const registerScaling = S.Shell.Test({
  summary: "Full 12-package x 24-module vibelang/register cold-start budget check.",
  shell: "node scripts/bench/register.mjs --packages 12 --modules 24 --runs 3",
  data: [
    ...compilerE2eDeps,
    S.file("register.mjs"),
    S.file("//packages/compiler/register.mjs"),
    S.file("//packages/compiler/project.mjs"),
    S.file("//packages/compiler/cache.mjs")
  ],
  tools: [node],
  sandbox: "none",
  exclusive: true,
  timeout: "15m"
})

export const Package = S.Package({
  targets: {
    synthetic: S.Shell.Test({
      summary: "Both synthetic benchmark languages compile and run equivalently across project shapes and fan-in boundaries.",
      shell: "SYNTHETIC_REQUIRE=1 node --test scripts/bench/gen-synthetic.test.mjs",
      data: [
        Packages["compiler-native"], Packages["runtime-dist"], Packages["runtime-published"],
        S.file("//experiments/package.json"), S.file("//experiments/bun.lock"),
        S.file("gen-synthetic.mjs"), S.file("gen-synthetic.test.mjs"),
        S.file("//packages/compiler/package.json"), S.file("//packages/compiler/bun.lock"),
        S.file("//scripts/testing/property.mjs"), S.file("//scripts/testing/property-slice.mjs")
      ],
      tools: [node],
      sandbox: "none",
      timeout: "5m"
    }),
    "report-test": S.Shell.Test({
      summary: "Benchmark harness calibration, verify guard, report aggregation, HTML rendering, and regression checks.",
      shell: "node --test scripts/bench/report.test.mjs",
      data: [S.file("lib/harness.mjs"), S.file("report.mjs"), S.file("report.test.mjs")],
      tools: [node],
      sandbox: "none",
      timeout: "2m"
    }),
    "runtime-fastcalls": runtimeFastcalls,
    "runtime-provide": runtimeProvide,
    "runtime-match": runtimeMatch,
    "runtime-concurrency": runtimeConcurrency,
    "runtime-compiled-loops": runtimeCompiledLoops,
    "compiler-e2e": compilerE2e,
    "lsp-e2e": lspE2e,
    "register-e2e": registerE2e,
    "compiler-js-helpers": compilerJs,
    "compiler-tools": compilerTools,
    bundlers,
    "cli-startup": cliStartup,
    "api-identity": apiIdentity,
    "migrate-flow": migrateFlow,
    "docs-tools": docsTools,
    "go-scanner": goScanner,
    "go-parser": goParser,
    "go-vibelang": goVibelang,
    "go-vibelangfmt": goVibelangfmt,
    "go-vibelangestree": goVibelangestree,
    "go-vibelangmapper": goVibelangmapper,
    "go-ls": goLs,
    "report-js": reportJs,
    "report-go": reportGo,
    report,
    "compiler-scaling": compilerScaling,
    "register-scaling": registerScaling
  }
})
