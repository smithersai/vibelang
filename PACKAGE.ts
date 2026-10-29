import { Smithers as S } from "@smthrs/targets"
import { Package as Packages } from "./packages/PACKAGE.ts"
import { Package as Typescript } from "./typescript/PACKAGE.ts"
import { Package as Tsc } from "./typescript/tsc/PACKAGE.ts"
import { Package as Vibelang } from "./typescript/vibelang/PACKAGE.ts"

// The repository-wide checks: each reads files across the whole tree (docs,
// sources, manifests), so each takes `tree`, every tracked file, as its input
// and reruns on any change. Targets that read less are declared in their own
// packages. docs/maintainers/build.md has the graph.
const tree = S.Filegroup({
  srcs: [...S.glob(["**", "!.jj/**"]), Packages.tree, Typescript.tree, Tsc.tree, Vibelang.tree]
})

// The installs these checks read enter their keys as lockfiles, which `tree`
// holds; smthrs runs after `bun install --frozen-lockfile` in each directory.
// The Go tests run from typescript/tsc and read the cases' Effect install.
const effect = "EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules"
const bun = S.Host.bin("bun")
const node = S.Host.bin("node")
const go = S.Host.bin("go")

const check = (
  summary: string,
  shell: string,
  data: ReadonlyArray<unknown>,
  tools: ReadonlyArray<typeof bun>,
  timeout = "30m"
) => S.Shell.Test({ summary, shell, data: [tree, ...data] as Array<never>, tools: [...tools], sandbox: "none", timeout })

// The VibeLang Go packages' tests read cases, docs and installs through the
// repository root, so they take `tree` too. They run with -count=1: the graph
// caches their results, and Go's own test cache would first hash every file
// the tests opened (the fuzz suite opens about 25 million).
const goVibelang = (summary: string, shell: string, data: ReadonlyArray<unknown> = [], timeout?: string) =>
  check(summary, `cd typescript/tsc && GOCACHE=$HOME/.cache/go-build-smthrs ${shell}`, [
    Tsc.srcs,
    Packages["runtime-dist"],
    ...data
  ], [go, node], timeout)

// The Go tests that read docs/design: the registry against the
// specification's Appendix B, the settings oracle against the compiler, the
// fuzz suite's citations of the VIPs, its coverage of the accepted VIPs, its
// pending lines' VIP reasons, and the chapters its oracles still read. Their inputs are the specification and the
// Go sources, not the whole tree, so a specification edit runs them before it
// lands and they stay cached otherwise.
const specTests = [
  "TestRegistryMatchesSpec",
  "TestCompilerRegistryIsSpecified",
  "TestConfigOracleMatchesCompiler",
  "TestRegistryRowsSuggestRepairs",
  "TestCommandLineFlagsCoverSpec",
  "TestSpecFacts",
  "TestPendingLines",
  "TestSuperseded",
  "TestDataGeneratedMatchSeparators",
  "TestDataSpecRulesQuoted",
  "TestDataChapterWitnessesQuoted",
  "TestSpecRuleFacts",
  "TestSpecRuleTable",
  "TestSpecRuleCoverage",
  "TestRuntimeFeatureCitations",
  "TestToolsHelpers",
  "TestVIPTemplatesCited",
  "TestRunningRulesQuoted",
  "TestVIPCoverage",
  "TestSpecProductionsOnlyInAppendixA",
  "TestSpecCitedProductionsExist",
  "TestSpecCodesInAppendixB",
  "TestAppendixBRows"
]
// The cost guards of vibelang --fix. They count programs and parsed files, so
// a slower fix loop fails here in seconds; the rewrite cases, which meet it as
// a 30 s limit on a busy host, run after the merge.
const fixCostTests = ["TestFixProjectBoundsChecks", "TestFixProgramsShareParsedFiles"]
// The cost guards of flow narrowing. They count allocations, so a repeated
// union removal that rehashes fails here in seconds; match-flow-limit.fail,
// which meets it as a 120 s limit on a busy host, runs after the merge.
const narrowingCostTests = ["TestRemoveTypeRepeatAllocations", "TestLiteralPatternNarrowingAllocations"]
const design = S.Filegroup({ srcs: [...S.glob(["docs/design/**"])] })

// This check reads only the generated spec/VIP pages. Keep it independently
// cached: an unrelated source edit must not rerun the link inventory.
const siteSpecLinks = S.Shell.Test({
  summary: "Generated specification and VIP links resolve to site pages and anchors.",
  shell: "cd docs/tools && bun test site-spec-links.test.ts",
  data: [S.Filegroup({ srcs: [...S.glob([
    "site/src/pages/spec/**", "site/src/pages/vips/**", "docs/tools/site-spec-links.test.ts"
  ])] })],
  tools: [bun],
  sandbox: "none",
  timeout: "1m"
})

const targets = {
  "site-spec-links": siteSpecLinks,
  release: check(
    "The release and contributor scripts' node tests.",
    "node --test scripts/release/*.test.mjs scripts/*.test.mjs",
    [],
    [node]
  ),
  snippets: check(
    "Compile every code block in the docs.",
    "bun docs/tools/check-snippets.ts",
    [Typescript.compiler, Packages["runtime-dist"]],
    [bun, node]
  ),
  tokens: check("Token counts in the docs match a fresh count.", "bun docs/tools/token-counts.ts --check", [], [bun]),
  forms: check(
    "The forms table and its decisions match a fresh generation.",
    "bash scripts/check-forms-table.sh",
    [],
    [go, bun, node]
  ),
  "docs-tools": check(
    "docs/tools' bun tests, with cached specification links and without site contrast.",
    "cd docs/tools && bun test --timeout 60000 $(ls *.test.* | grep -vE '^site-(contrast|spec-links)\\.test\\.')",
    [Typescript.compiler, Packages["runtime-dist"], Packages["compiler-native"], siteSpecLinks],
    [bun, node]
  ),
  // It installs the site with `npm ci` and builds it, so it runs only when
  // selected: `smthrs test //... --include-exclusive` (the post-merge suite).
  "site-contrast": S.Shell.Test({
    summary: "The built site's pages have no contrast violations in either theme.",
    shell: "cd docs/tools && bun test site-contrast.test.ts",
    data: [tree],
    tools: [bun, node],
    sandbox: "none",
    exclusive: true,
    timeout: "30m"
  }),
  "docs-check": check("Generated docs and tracked-leak checks.", "cd .smithers && bun run docs:check", [], [bun, node]),
  "go-vibelang": goVibelang(
    "Go tests of internal/vibelang and its subpackages.",
    `CGO_ENABLED=0 ${effect} go test -count=1 -p 8 -timeout 45m -trimpath ./internal/vibelang/...`,
    [Tsc["vibelang-files"]],
    // The native corpus took 15m alone and exhausted 25m under shared load
    // while cases were still advancing. Go bounds the suite at 45m; the
    // outer budget also covers admission and compilation, as for fuzz.
    "70m"
  ),
  "go-vibelang-race": goVibelang(
    "Parallel declaration emit under the race detector.",
    "CGO_ENABLED=1 go test -race -count=1 -trimpath -run TestDeclarationEmitInParallel ./internal/vibelang/",
    [Tsc["vibelang-files"]]
  ),
  "go-vibelangmapper": goVibelang(
    "Go tests of internal/vibelangmapper.",
    `CGO_ENABLED=0 ${effect} go test -count=1 -p 8 -timeout 25m -trimpath ./internal/vibelangmapper/...`,
    [Tsc["vibelangmapper-files"]]
  ),
  // Shell targets do not inherit ambient Go controls. Declare the
  // post-merge fuzz budget: 24 seed workers and six build jobs.
  "go-vibelangfuzz": goVibelang(
    "The fuzz oracles over the seed corpus: cases, snippets and saved reproductions.",
    `CGO_ENABLED=0 GOMAXPROCS=$(n=$(getconf _NPROCESSORS_ONLN); [ "$n" -lt 24 ] && echo "$n" || echo 24) GOFLAGS=-p=6 VIBELANG_FUZZ_REQUIRE=1 VIBELANG_FUZZ_HANG=120s ${effect} ` +
      "go test -short -count=1 -timeout=20m -trimpath ./internal/vibelangfuzz/...",
    [Tsc["vibelangfuzz-files"]],
    // go test bounds the run at 20m and names a stuck test; the budget
    // adds the build of the test binaries. Under the post-merge suite's
    // load the target took 17m to 29m, and 30m killed it with no output;
    // most of that was Go's test cache hashing the files the tests opened,
    // which -count=1 skips (18m to 4m on an idle 48-core host).
    "45m"
  ),
  "spec-tests": S.Shell.Test({
    summary: "The Go tests that read docs/design (the registry, the VIP citations and coverage, the pending lines) and the cost guards of --fix and flow narrowing.",
    shell:
      `cd typescript/tsc && GOCACHE=$HOME/.cache/go-build-smthrs CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 ${effect} ` +
      `go test -count=1 -trimpath -run '^(${[...specTests, ...fixCostTests, ...narrowingCostTests].join("|")})$' ./internal/checker/ ./internal/vibelang/ ./internal/vibelangfuzz/`,
    data: [design, Tsc.srcs, Tsc["vibelang-files"], Tsc["vibelangfuzz-files"], Packages["runtime-dist"]] as Array<never>,
    tools: [go, node],
    sandbox: "none",
    timeout: "15m"
  })
}

export const Package = S.Package({ targets: { tree, "design-files": design, ...targets } })
