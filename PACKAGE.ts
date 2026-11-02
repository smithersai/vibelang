import { Smithers as S } from "@smthrs/targets"
import { fuzzTopics } from "./fuzz-topics.ts"
import { vibelangTopics } from "./vibelang-topics.ts"
import { migrationSources } from "./migration-inputs.ts"
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
const gofmt = S.Host.bin("gofmt")

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
  "TestDoForTryDiagnosticOwnerQuoted",
  "TestDoDeclarationBytesQuoted",
  "TestSpecifierWrittenJSX",

  "TestStockConsumerResolutionQuoted",
  "TestStockConsumerResolution",

  "TestCurrentFixCodesQuoted",
  "TestRegistryDebtLedger",
  "TestRegistryDebtWitnessIdentity",
  "TestRegistryUsesCurrentAppendix",
  "TestCurrentConfigFacts",
  "TestCurrentRegistryTables",
  "TestDiagnosticCodeNames",
  "TestImportedDiagnosticScope",
  "TestImportedLintCodes",

  "TestOptionMatchFixQuoted",
  "TestDeclarationPreludeModesQuoted",
  "TestNativeOutputSpecifierRulesQuoted",
  "TestLegacyConfigCommentsQuoted",
  "TestSeverityScopeQuoted",
  "TestUnrelatedSeverityKeepsDiagnosticDefaults",
  "TestDiagnosticSeverityScopeRegression",
  "TestCompileSeverityOverridesByCode",
  "TestAwaitPlacementQuickFixes",
  "TestSchemaBuiltinBindingsQuoted",
  "TestSchemaDeclarationCommentsQuoted",
  "TestDeclarationStyleRulesQuoted",
  "TestLegacyEffectAliasQuoted",
  "TestFixScopeRulesQuoted",
  "TestEffectQualifierQuoted",
  "TestServiceImplicitAnyQuoted",
  "TestInterimSeverityRulesQuoted",
  "TestAwaitAdvisoryPlacementQuoted",
  "TestAwaitAdvisoryPlacementRegression",
  "TestCurrentDiagnosticPolicyQuoted",
  "TestCurrentDiagnosticPolicyRegression",
  "TestCompileCurrentDiagnosticPolicy",
  "TestTrailingBlocksQuoted",
  "TestReviewColdConsoleQuoted",
  "TestPackageExportDeclarationQuoted",
  "TestEffectChannelsQuoted",
  "TestForeignCallbackSitesQuoted",
  "TestVibeResolutionTableQuoted",
  "TestDoJumpOperandQuoted",
  "TestPreludeGlobalMemberQuoted",
  "TestPlatformDerivedGlobalsQuoted",
  "TestSidecarIdentityQuoted",
  "TestFormatForHeadsQuoted",
  "TestPlainRunnersQuoted",
  "TestFormatFoldkitQuoted",
  "TestFormatLabelQuoted",
  "TestFormatReturnTypesQuoted",
  "TestEffectArrowHeadsQuoted",
  "TestFormatPrefixOperandsQuoted",
  "TestCatchArrowHeadsQuoted",
  "TestFiberUnaryOperandsQuoted",
  "TestDeclarationLineBreakQuoted",
  "TestSchemaDecodedKeyFlagsQuoted",
  "TestFormatBlockHeaderRulesQuoted",
  "TestFormatContractCommentQuote",
  "TestFormatContractCommentNeighbors",
  "TestFormatContractCommentNeighborhood",
  "TestFormatContractCommentEqualityTokens",
  "TestFormatContractCommentModules",
  "TestDataCounterpartQuoted",
  "TestAsyncRefactorBridgesQuoted",
  "TestLayerMergeAdviceQuoted",
  "TestMigrationEffectOperandsQuoted",
  "TestProvideServiceFixScopeQuoted",
  "TestMigrationEffectHeritageQuoted",
  "TestTryNestedQuoted",
  "TestMigrationGeneratorReturnsQuoted",
  "TestUnionDataMemberQuoted",
  "TestCheckerLayout",
  "TestVibeModuleBoundaryQuoted",
  "TestProvideParenthesizedExpressionsQuoted",
  "TestVibeModuleBoundaryRegression",
  "TestVibeModuleBoundaryEmission",
  "TestVibeModuleNativeCounterparts",
  "TestVIPCanonicalFieldNames",
  "TestVIPEncodedFieldNames",
  "TestProducerScopeInferenceQuoted",
  "TestRestorePlacementQuoted",
  "TestEffectBlockJumpsQuoted",
  "TestDoCompletionQuoted",
  "TestRegistryMatchesSpec",
  "TestSeverityCodesMatchAppendixB",
  "TestAppendixBSeveritySettingsTakeEffect",
  "TestCompilerRegistryIsSpecified",
  "TestConfigOracleMatchesCompiler",
  "TestConfigPathBasesQuoted",
  "TestWrittenSpecifierMigratedTargetQuoted",
  "TestConfigPathBases",
  "TestNativeAwaitOptionsQuoted",
  "TestNativeAwaitOptionsRegression",
  "TestNativeAwaitOptionsTypeScriptCompatibility",
  "TestRegistryRowsSuggestRepairs",
  "TestCommandLineFlagsCoverSpec",
  "TestToolingPublicCitationsQuoted",
  "TestCommandLineFixScopes",
  "TestSpecFacts",
  "TestDiagnosticCodesKeepFullOrdinal",
  "TestPendingLines",
  "TestLiteralMatchCorpusActive",
  "TestMatchFixedExtractorTypesQuoted",
  "TestSuperseded",
  "TestDataGeneratedMatchSeparators",
  "TestDataSpecRulesQuoted",
  "TestLabelChainRulesQuoted",
  "TestBindingRenameOwnershipQuoted",
  "TestMigrationDeclarationFixQuoted",
  "TestMigrationDeclarationCanonicalizationQuoted",
  "TestReviewDiagnosticTablesQuoted",
  "TestMigrationJSDocImportsQuoted",
  "TestPreludeShadowedQuoted",
  "TestDataChapterWitnessesQuoted",
  "TestFailuresSpecQuotes",
  "TestFailuresSpecCoverage",
  "TestSpecRuleFacts",
  "TestSpecRuleTable",
  "TestSpecRuleCoverage",
  "TestRuntimeFeatureCitations",
  "TestToolsFormatSemanticContract",
  "TestFormatIdenticalEmitQuoted",
  "TestToolsFormatIdenticalInvalidEmit",
  "TestToolsFormatInvalidEmitWitness",
  "TestFormatDeclarationRulesQuoted",
  "TestToolsHelpers",
  "TestCanonicalVIPExitRejectsInvalidReasonTags",
  "TestCanonicalVIPExitReasonTagControls",
  "TestVIPTemplatesCited",
  "TestRunningRulesQuoted",
  "TestMigrationForeignCallQuoted",
  "TestBangSlotGroupingQuoted",
  "TestMatchBindingTypesQuoted",
  "TestPreludeAmbientDeclarationsQuoted",
  "TestEffectLintConfigurationQuoted",
  "TestProvideCommaRecoveryQuoted",
  "TestMissingRuntimeQuoted",
  "TestWorkspaceDiagnosticOccurrencesQuoted",
  "TestAutomaticTracingKeysQuoted",
  "TestServicesRulesQuoted",
  "TestProducerBindingQuoted",
  "TestEffectTypeSpacingQuoted",
  "TestPipeEdgesQuoted",
  "TestPlatformGlobalAugmentationQuoted",
  "TestPlatformRulesQuoted",
  "TestNativePreludeWithoutRuntimeQuoted",
  "TestPlatformGlobalAugmentationQuoted",
  "TestEffectCollisionTypeofQuoted",
  "TestEffectPinQuoted",
  "TestCLISpecCommandFlags",
  "TestVIPFiberIDNumberEquality",
  "TestErrorDeclarationTwinQuoted",
  "TestFixExplicitEmptyErrorDeclarations",
  "TestUnaryPowQuoted",
  "TestFixFixedPointQuoted",
  "TestPlainHandlerThrowQuoted",
  "TestFunctionsSpecQuotes",
  "TestVIPCoverage",
  "TestSpecProductionsOnlyInAppendixA",
  "TestSpecCitedProductionsExist",
  "TestSpecCodesInAppendixB",
  "TestAppendixBRows",
  "TestFixGateQuoted",
  "TestShortTargetsBudgeted"
]
// The cost guards of vibelang --fix. They count programs and parsed files, and
// compare the time and memory of two project sizes, so a slower fix loop fails
// here in seconds; the rewrite cases, which meet it as a 30 s limit on a busy
// host, run after the merge.
const fixCostTests = ["TestFixProjectBoundsChecks", "TestFixProgramsShareParsedFiles", "TestFixProjectChecksAPassingRoundOnce", "TestFixGateChecksAFewTimes", "TestFixScalesWithTheProject", "TestFixHalvingChecksTheWholeProgramAFewTimes"]
// The cost guards of flow narrowing. They count allocations, so a repeated
// union removal that rehashes fails here in seconds; match-flow-limit.fail,
// which meets it as a 120 s limit on a busy host, runs after the merge.
const narrowingCostTests = ["TestRemoveTypeRepeatAllocations", "TestLiteralPatternNarrowingAllocations"]
const design = S.Filegroup({ srcs: [...S.glob(["docs/design/**"])] })

// Named pending seeds skip known hangs; only TestPendingHangs can reject a
// stale hang marker. Cache that bounded process check separately and require
// it from the existing merge-gate label.
const pendingHangs = goVibelang(
  "Pending hang reproductions still time out instead of completing as XPASS.",
  `CGO_ENABLED=0 GOMAXPROCS=8 GOFLAGS=-p=8 VIBELANG_FUZZ_REQUIRE=1 VIBELANG_FUZZ_HANG_PROBE=0 ${effect} ` +
    "go test -v -short -count=1 -timeout=5m -trimpath -run '^(TestPendingHangs|TestHangProbeDiagnosticSummary)$' ./internal/vibelangfuzz/",
  [Tsc["vibelangfuzz-files"]],
  "30m"
)

// This check reads only the generated spec/VIP pages. Keep it independently
// cached: an unrelated source edit must not rerun the link inventory.
const siteSpecLinks = S.Shell.Test({
  summary: "Generated specification and VIP links resolve to site pages and anchors.",
  shell: "cd docs/tools && bun test --timeout 60000 site-spec-links.test.ts",
  data: [S.Filegroup({ srcs: [...S.glob([
    "site/src/pages/spec/**", "site/src/pages/vips/**", "docs/tools/site-spec-links.test.ts"
  ])] })],
  tools: [bun],
  sandbox: "none",
  timeout: "1m"
})

// One target per fuzz topic (fuzz-topics.ts): the Fuzz functions of
// internal/vibelangfuzz/<topic>_*_test.go over their seeds. The
// merge gate runs a topic for a change to a compiler source file or a fuzz
// test of that topic (ls/gate-cases.sh), where //:go-vibelangfuzz runs only
// post-merge: 58bb695700ad changed the note in prelude_collision_diagnostic.go
// and main 54735153d416 went RED on FuzzPreludeGlobalMember. Post-merge names
// its labels, so these targets run only when selected.
const fuzzTopicTargets = Object.fromEntries(
  [...fuzzTopics].map(([topic, names]) => [
    `go-vibelangfuzz-topic-${topic}`,
    goVibelang(
      `The ${topic} fuzz oracles over their seeds: ${names.join(", ")}.`,
      `CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 VIBELANG_FUZZ_HANG=120s ${effect} ` +
        `go test -short -count=1 -timeout=15m -trimpath -run '^(${names.join("|")})$' ./internal/vibelangfuzz/`,
      [Tsc["vibelangfuzz-files"]],
      "30m"
    )
  ])
)

// One target per internal/vibelang test topic (vibelang-topics.ts): the Test
// functions of internal/vibelang/<topic>_test.go and <topic>_*_test.go. The
// merge gate runs a topic for a change to a source or test file of
// internal/vibelang the topic names (ls/gate-cases.sh), where //:go-vibelang
// runs only post-merge: c87f85092cc6 changed fix.go and main 0d0c6b46ee6e went
// RED on TestFixReachesFixedPoint. Post-merge names its labels, so these
// targets run only when selected.
const vibelangTopicTargets = Object.fromEntries(
  [...vibelangTopics].map(([topic, names]) => [
    `go-vibelang-topic-${topic}`,
    goVibelang(
      `The ${topic} Go tests of internal/vibelang: ${names.join(", ")}.`,
      `CGO_ENABLED=0 ${effect} go test -count=1 -timeout=15m -trimpath -run '^(${names.join("|")})$' ./internal/vibelang/`,
      [Tsc["vibelang-files"]],
      "30m"
    )
  ])
)

const targets = {
  "go-vibelangfuzz-hangs": pendingHangs,
  "site-spec-links": siteSpecLinks,
  release: check(
    "The release and contributor scripts' node tests, the effect-bump, ts-bump, ci-health and first-bad flows' steps, and their evals' step keys.",
    "node --test scripts/release/*.test.mjs scripts/*.test.mjs typescript/vibelang/harness.test.mjs docs/redirect/*.test.mjs " +
      ".smithers/flows/effect-bump/test/*.test.mjs .smithers/flows/ts-bump/test/*.test.mjs .smithers/flows/ci-health/test/*.test.mjs .smithers/flows/first-bad/test/*.test.mjs " +
      ".smithers/flows/test/*.test.mjs",
    [Packages["compiler-native"], Packages["runtime-dist"]],
    [node, gofmt, S.Host.bin("diff3")]
  ),
  snippets: check(
    "Compile every code block in the docs.",
    "bun docs/tools/check-snippets.ts",
    [Typescript.compiler, Packages["runtime-dist"], Packages["compiler-native"]],
    [bun, node]
  ),
  tokens: check("Token counts in the docs match a fresh count.", "bun docs/tools/token-counts.ts --check", [], [bun]),
  // The executable is source-keyed; generation still reads the entire tree.
  forms: check(
    "The forms table and its decisions match a fresh generation.",
    "FORMS_BINARY=$PWD/typescript/built/local/vibelang-forms " +
      "GOCACHE=$HOME/.cache/go-build-smthrs bash scripts/check-forms-table.sh",
    [Typescript["forms-generator"]],
    [bun, node]
  ),
  "docs-tools": check(
    "docs/tools' bun tests, with cached specification links and without site contrast.",
    "cd docs/tools && bun test --timeout 60000 $(ls *.test.* | grep -vE '^site-(contrast|spec-links)\\.test\\.')",
    [Typescript.compiler, Packages["runtime-dist"], Packages["compiler-native"], siteSpecLinks],
    [bun, node]
  ),
  // It installs and builds a private copy of site/ (docs/tools/site-scratch.ts),
  // so it runs beside the other targets.
  "site-contrast": S.Shell.Test({
    summary: "The built site's pages have no contrast violations in either theme.",
    shell: "cd docs/tools && bun test --timeout 60000 site-contrast.test.ts",
    data: [tree],
    tools: [bun, node],
    sandbox: "none",
    timeout: "30m"
  }),
  "docs-check": check("Generated docs and tracked-leak checks.", "cd .smithers && bun run docs:check", [], [bun, node, gofmt]),
  // The compiler corpus runs as `//typescript/vibelang/...`, one cached target
  // per case, through the binary users run.
  "go-vibelang": goVibelang(
    "Go tests of internal/vibelang and its subpackages.",
    `CGO_ENABLED=0 ${effect} go test -count=1 -p 8 -timeout 45m -trimpath -exec "$PWD/../../scripts/go-test-shards.sh" ./internal/vibelang/...`,
    [Tsc["vibelang-files"], S.file("//scripts/go-test-shards.sh")],
    // Go bounds the tests; the outer budget also covers admission and a cold
    // compile, which took 30m under load on 2026-10-31.
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
  // The merge gate runs it with the compiler step, where //:go-vibelangfuzz
  // runs only post-merge: a fix that makes a pending input pass without
  // deleting its line fails before it lands, not on main (four times on
  // 2026-10-30).
  "go-vibelangfuzz-pending": goVibelang(
    "The inputs testdata/pending/ lists still fail, and every probe passes or is pending: a change that makes one pass deletes its line.",
    `CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 VIBELANG_FUZZ_HANG=120s ${effect} sh internal/vibelangfuzz/pending.sh`,
    [Tsc["vibelangfuzz-files"], pendingHangs],
    "30m"
  ),
  // The merge gate runs it for a change to the documentation or a case, which
  // seed its sample, where //:go-vibelangfuzz runs only post-merge: an example
  // the editor cannot answer for fails before it lands, not on main
  // (d2f2bc108caf on 2026-10-30). Marking a known gap takes a compiler-gap
  // pending line, as testdata/pending/tools.txt shows.
  "go-vibelangfuzz-editor": goVibelang(
    "The editor oracles over their short sample of documentation examples and cases.",
    `CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 VIBELANG_FUZZ_HANG=120s ${effect} ` +
      "go test -short -count=1 -timeout=15m -trimpath -run '^(FuzzEditor|FuzzEditorConsistency|FuzzEffectArrowHeads|FuzzAsyncRefactorBridges)$' ./internal/vibelangfuzz/",
    [Tsc["vibelangfuzz-files"]],
    "30m"
  ),
  // The merge gate runs it for a change to a case, the documentation or the
  // fuzz oracles, which seed its sample or judge it, where //:go-vibelangfuzz
  // runs only post-merge. Seven new cases in e63e99956706 moved FuzzCompile's
  // short sample onto vibe-severities, and 9759d61e40ed went RED post-merge on
  // an oracle bug the sample had skipped; the oracle fix c19c6f98fb79 then
  // turned cd8d8fb8ca22 RED on fibers-await.fail.
  "go-vibelangfuzz-compile": goVibelang(
    "The compile oracles over their short sample of cases and documentation examples.",
    `CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 VIBELANG_FUZZ_HANG=120s ${effect} ` +
      "go test -short -count=1 -timeout=15m -trimpath -run '^FuzzCompile$' ./internal/vibelangfuzz/",
    [Tsc["vibelangfuzz-files"]],
    "30m"
  ),
  // The merge gate runs it for a change to a case, the specification, the
  // fuzz oracles or the compiler's project settings: each case's vibelang
  // section seeds FuzzConfig, where //:go-vibelangfuzz runs only post-merge.
  // The cases 04db4f250ebf added seeded vibelang.declarationImportStyle,
  // which the oracle did not yet know, and 19f055973410 went RED post-merge.
  "go-vibelangfuzz-config": goVibelang(
    "The project-settings oracles over every case's vibelang section and the settings the specification lists.",
    `CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 VIBELANG_FUZZ_HANG=120s ${effect} ` +
      "go test -short -count=1 -timeout=15m -trimpath -run '^FuzzConfig$' ./internal/vibelangfuzz/",
    [Tsc["vibelangfuzz-files"]],
    "30m"
  ),
  // Shell targets do not inherit ambient Go controls. Declare the
  // post-merge fuzz budget: 24 seed workers and six build jobs.
  "go-vibelangfuzz": goVibelang(
    "The fuzz oracles over the seed corpus: cases, snippets and saved reproductions.",
    `CGO_ENABLED=0 GOMAXPROCS=$(n=$(getconf _NPROCESSORS_ONLN); [ "$n" -lt 24 ] && echo "$n" || echo 24) GOFLAGS=-p=6 VIBELANG_FUZZ_REQUIRE=1 VIBELANG_FUZZ_HANG=120s ${effect} ` +
      `go test -short -count=1 -timeout=40m -trimpath -exec "$PWD/../../scripts/go-test-shards.sh" ./internal/vibelangfuzz/...`,
    [Tsc["vibelangfuzz-files"], S.file("//scripts/go-test-shards.sh")],
    // The package's tests and seed corpora run one after another, so the
    // binary runs as six processes at once (scripts/go-test-shards.sh); each
    // keeps the documented 40m corpus deadline. Admission and compilation
    // retain their separate 25m allowance before the task's 65m limit.
    "65m"
  ),
  "spec-tests": S.Shell.Test({
    summary: "The Go tests that read docs/design (the registry, the VIP citations and coverage, the pending lines) and the cost guards of --fix and flow narrowing.",
    shell:
      `cd typescript/tsc && GOCACHE=$HOME/.cache/go-build-smthrs CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 VIBELANG_FUZZ_HANG=120s ${effect} ` +
      `go test -count=1 -trimpath -run '^(${[...specTests, ...fixCostTests, ...narrowingCostTests].join("|")})$' ./internal/checker/ ./internal/vibelang/ ./internal/vibelangfuzz/ ./internal/effecttsgo/shim/checker/`,
    data: [design, Tsc.srcs, Tsc["effect-shim-files"], Tsc["vibelang-files"], Tsc["vibelangfuzz-files"], Packages["runtime-dist"]] as Array<never>,
    tools: [go, node],
    sandbox: "none",
    timeout: "15m"
  })
}

export const Package = S.Package({ targets: {
    "migration-sources": migrationSources, tree, "design-files": design, ...targets, ...fuzzTopicTargets, ...vibelangTopicTargets } })
