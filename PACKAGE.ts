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
// specification's Appendix B, the fuzz suite's citations of the VIPs, its
// coverage of the accepted VIPs, its pending lines' VIP reasons, and the
// chapters its oracles still read. Their inputs are the specification and the
// Go sources, not the whole tree, so a specification edit runs them before it
// lands and they stay cached otherwise.
const specTests = [
  "TestRegistryMatchesSpec",
  "TestRegistryRowsSuggestRepairs",
  "TestCommandLineFlagsCoverSpec",
  "TestSpecFacts",
  "TestPendingLines",
  "TestSuperseded",
  "TestSpecRuleFacts",
  "TestSpecRuleTable",
  "TestSpecRuleCoverage",
  "TestRuntimeFeatureCitations",
  "TestToolsHelpers",
  "TestVIPTemplatesCited",
  "TestVIPCoverage",
  "TestSpecProductionsOnlyInAppendixA",
  "TestSpecCitedProductionsExist",
  "TestSpecCodesInAppendixB"
]
const design = S.Filegroup({ srcs: [...S.glob(["docs/design/**"])] })

const targets = {
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
    "docs/tools' bun tests, except the site contrast check.",
    "cd docs/tools && bun test $(ls *.test.* | grep -v '^site-contrast\\.test\\.')",
    [Typescript.compiler, Packages["runtime-dist"], Packages["compiler-native"]],
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
    `CGO_ENABLED=0 ${effect} go test -count=1 -p 8 -timeout 25m -trimpath ./internal/vibelang/...`,
    [Tsc["vibelang-files"]]
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
  "go-vibelangfuzz": goVibelang(
    "The fuzz oracles over the seed corpus: cases, snippets and saved reproductions.",
    `CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 VIBELANG_FUZZ_HANG=120s ${effect} ` +
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
    summary: "The Go tests that read docs/design: the registry, the VIP citations and coverage, the pending lines.",
    shell:
      `cd typescript/tsc && GOCACHE=$HOME/.cache/go-build-smthrs CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 ${effect} ` +
      `go test -count=1 -trimpath -run '^(${specTests.join("|")})$' ./internal/vibelang/ ./internal/vibelangfuzz/`,
    data: [design, Tsc.srcs, Tsc["vibelang-files"], Tsc["vibelangfuzz-files"], Packages["runtime-dist"]] as Array<never>,
    tools: [go, node],
    sandbox: "none",
    timeout: "15m"
  })
}

export const Package = S.Package({ targets: { tree, "design-files": design, ...targets } })
