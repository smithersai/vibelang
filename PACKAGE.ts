import { Smithers as S } from "@smthrs/targets"
import { fuzzTopics } from "./fuzz-topics.ts"
import { vibelangTopics } from "./vibelang-topics.ts"
import { migrationSources } from "./migration-inputs.ts"
import { createApiIdentityInputs } from "./api-inputs.ts"
import { buildContractExclusions, buildContractSuites, createBuildContractInputs } from "./build-contract-inputs.ts"
import { Package as Packages } from "./packages/PACKAGE.ts"
import { Package as Typescript } from "./typescript/PACKAGE.ts"
import { Package as Tsc } from "./typescript/tsc/PACKAGE.ts"
import { Package as Vibelang } from "./typescript/vibelang/PACKAGE.ts"

// Most repository-wide checks read the whole tree (docs, sources, manifests)
// and retain `tree` as their input. The API identity check uses its Node,
// corpus and specification inputs below. docs/maintainers/build.md has the graph.
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
// Shell targets receive only declared environment. Keep the optional append
// destination in the key as well, so a different log path reruns the target.
const fuzzBudgetEnv = { VIBELANG_FUZZ_BUDGET_LOG: process.env.VIBELANG_FUZZ_BUDGET_LOG ?? "" }

const check = (
  summary: string,
  shell: string,
  data: ReadonlyArray<unknown>,
  tools: ReadonlyArray<typeof bun>,
  timeout = "30m",
  env: Readonly<Record<string, string>> = {},
  inputs: ReadonlyArray<unknown> = [tree]
) => S.Shell.Test({ summary, shell, data: [...inputs, ...data] as Array<never>, tools: [...tools], sandbox: "none", timeout, env })

// The VibeLang Go packages' tests read cases, docs and installs through the
// repository root, so they take `tree` too. They run with -count=1: the graph
// caches their results, and Go's own test cache would first hash every file
// the tests opened (the fuzz suite opens about 25 million).
const goVibelang = (summary: string, shell: string, data: ReadonlyArray<unknown> = [], timeout?: string,
  env: Readonly<Record<string, string>> = {}) =>
  check(summary, `cd typescript/tsc && GOCACHE=$HOME/.cache/go-build-smthrs ${shell}`, [
    Tsc.srcs,
    Packages["runtime-dist"],
    ...data
  ], [go, node], timeout, env)

// Compile each package once, then distribute its test binary to independent
// workers. The inventory check requires every package under internal/vibelang
// to appear here; new files within a package enter Go's discovery automatically.
const goVibelangPackages = ["internal/vibelang"]
const goVibelangBinaries = goVibelangPackages.map((pkg, index) => {
  const output = `typescript/built/local/go-vibelang-${index + 1}.test`
  return {
    pkg, output,
    target: S.Shell.Build({
      summary: `Compile the ${pkg} Go test binary, including the default vet checks.`,
      shell: `cd typescript/tsc && GOCACHE=$HOME/.cache/go-build-smthrs CGO_ENABLED=0 go test -c -count=1 -p 8 -trimpath -o ../../${output} ./${pkg}`,
      data: [tree, Tsc.srcs, Tsc["vibelang-files"], Packages["runtime-dist"]],
      tools: [go, node], outFiles: [output], sandbox: "none", timeout: "10m", env: { GOMAXPROCS: "4" }
    })
  }
})
const goVibelangShardCount = 64
const goVibelangShards = Object.fromEntries(
  Array.from({ length: goVibelangShardCount }, (_, index) => [
    `go-vibelang-shard-${String(index + 1).padStart(2, "0")}`,
    goVibelang(
      `Go tests of internal/vibelang, slice ${index + 1}/${goVibelangShardCount}.`,
      `CGO_ENABLED=0 ${effect} TYPESCRIPT_REPO_ROOT=$PWD sh -c '` +
        "status=0\n" +
        goVibelangBinaries.map(({ pkg, output }) =>
          `(cd "$TYPESCRIPT_REPO_ROOT/${pkg}" && "$TYPESCRIPT_REPO_ROOT/../../scripts/go-test-shards.sh" ` +
          `"$TYPESCRIPT_REPO_ROOT/../../${output}" -test.v -test.paniconexit0 -test.count=1 -test.timeout=8m) || status=$?\n`
        ).join("") + 'exit "$status"' + "'",
      [Tsc["vibelang-files"], S.file("//scripts/go-test-shards.sh"), ...goVibelangBinaries.map(({ target }) => target)],
      "10m",
      { GO_TEST_SLICE: `${index + 1}/${goVibelangShardCount}`, GO_TEST_SHARDS: "1", GOMAXPROCS: "4" }
    )
  ])
)

// The Go tests that read docs/design: the registry against the
// specification's Appendix B, the settings oracle against the compiler, the
// fuzz suite's citations of the VIPs, its coverage of the accepted VIPs, its
// pending lines' VIP reasons, and the chapters its oracles still read. Their inputs are the specification and the
// Go sources and the migration comparator the counterpart controls exercise,
// so either specification or comparator edits rerun them before landing.
// Every Test...Quoted in the target's packages runs by its name (fuzz coverage RULES #9), so a new quote
// test needs no line here; scripts/spec-tests.test.mjs checks both.
const specTests = [
  "TestVIPFocusInput",
  "TestVIPFocusAvailability",
  "TestVIPObjectMemberKeyCorpusCoverage",
  "FuzzObjectMemberKeyContext",
  
  "FuzzEffectSlotRecovery",
  "FuzzEffectRequirementContinuations",
  "FuzzFreshAsyncNonThenable",
  "TestEffectFactoriesAreOrdinaryValues",
  "TestEffectFactoryKeepsNativeReturnMismatch",
  "FuzzNativeEffectFactoryDestinations",
  "TestSpecifierWrittenJSX",

  "TestStockConsumerResolution",

  "TestRegistryDebtLedger",
  "TestRegistryDebtWitnessIdentity",
  "TestRegistryUsesCurrentAppendix",
  "TestCurrentConfigFacts",
  "TestCurrentRegistryTables",
  "TestDiagnosticCodeNames",
  "TestImportedDiagnosticScope",
  "TestImportedLintCodes",

  "TestUnrelatedSeverityKeepsDiagnosticDefaults",
  "TestDiagnosticSeverityScopeRegression",
  "TestCompileSeverityOverridesByCode",
  "TestLintLeavesProjectUnchanged",
  "TestCompileKeepsCompatibilitySidecars",
  "TestAwaitAdvisoryPlacementRegression",
  "TestGrammarAdmissionInventory",
  "TestGrammarAdmissionInventoryReverts",
  "TestGrammarAdmissionPipes",
  "TestGrammarAdmissionCore",
  "TestGrammarAdmissionForAwait",
  "TestGrammarAdmissionDiagnostics",
  "TestGrammarAdmissionForOfAsyncName",
  "TestGrammarAdmissionAsyncForOfContext",
  "TestGrammarAdmissionAssertedForHeads",
  "TestGrammarAdmissionArithmetic",
  "TestGrammarAdmissionTypeScriptSubset",
  "TestGrammarAdmissionCases",
  "TestGrammarAdmissionAbstractErrorKeys",
  "TestGrammarAdmissionAbstractErrorRegression",
  "TestGrammarAdmissionDeclareExpression",
  "TestGrammarAdmissionEffectIdentifierBeforeIs",
  "TestGrammarAdmissionFiberPatternKeys",
  "TestGrammarAdmissionFiberPatternRegression",
  "TestGrammarAdmissionPatternRestEllipsisKeys",
  "TestGrammarAdmissionPatternRestEllipsisRegression",
  "TestGrammarAdmissionTryInHatchKeys",
  "TestGrammarAdmissionTryInHatchRegression",
  "TestGrammarAdmissionCoalesceMixing",
  "TestGrammarAdmissionDataEmptyTypeParametersKeys",
  "TestGrammarAdmissionDataEmptyTypeParametersRegression",
  "TestGrammarAdmissionProducerCoverKeys",
  "TestGrammarAdmissionProducerCoverRegression",
  "TestGrammarAdmissionTryMatchStatementKeys",
  "TestGrammarAdmissionTryMatchStatementRegression",
  "TestGrammarAdmissionComputedKeyContext",
  "TestGrammarAdmissionInitializerContext",
  "TestGrammarAdmissionServiceRejectedMembers",
  "TestGrammarAdmissionArithmeticGrouping",
  "TestGrammarAdmissionAssertedIs",
  "TestGrammarAdmissionAssertedIsRegression",
  "TestGrammarAdmissionOptionalClassMemberKeys",
  "TestGrammarAdmissionOptionalClassMemberKeepsBodyGap",
  "TestGrammarAdmissionOptionalClassMember",
  "TestGrammarAdmissionNativeOptionalClassMember",
  "FuzzGrammarArithmeticOperators",
  "TestGrammarAdmissionForAwaitAsyncHead",
  "TestGrammarAdmissionForOfAsyncModuleKeys",
  "TestGrammarAdmissionForOfAsyncModuleRegression",
  "TestGrammarAdmissionPatternMemberRegression",
  "TestGrammarAdmissionPatternMemberKeys",
  "TestGrammarAdmissionPatternMemberLogicalKeys",
  "TestGrammarAdmissionPatternMemberLogicalRegression",
  "TestGrammarAdmissionImportClauses",
  "TestGrammarAdmissionModuleModifiers",
  "TestGrammarAdmissionDefaultExports",
  "TestGrammarAdmissionExportNames",
  "TestGrammarAdmissionTypeExports",
  "TestGrammarAdmissionExportModifiers",
  "TestGrammarAdmissionJoinForHead",
  "TestGrammarAdmissionSchemaTypeDiagnostic",
  "TestGrammarAdmissionModuleRequireKeys",
  "TestGrammarAdmissionModuleRequireRegression",
  "TestGrammarAdmissionModuleSpecifierKeywordKeys",
  "TestGrammarAdmissionModuleSpecifierKeywordRegression",
  "TestGrammarAdmissionModuleReExports",
  "TestGrammarAdmissionModuleRequireReservedKeys",
  "TestGrammarAdmissionImportMetaSpecifierKeys",
  "TestGrammarAdmissionImportMetaSpecifierRegression",
  "TestGrammarAdmissionImportRelationalKeys",
  "TestGrammarAdmissionImportRelationalRegression",
  "TestGrammarAdmissionBitwise",
  "TestGrammarAdmissionIsPrefixPrecedenceKeys",
  "TestGrammarAdmissionContextualDeclarationKeys",
  "TestGrammarAdmissionContextualDeclarationRegression",
  "TestGrammarAdmissionRelationalReadingDropsTypeArguments",
  "TestGrammarAdmissionLabTypeScriptReadings",
  "TestGrammarAdmissionDeclarationOperatorPrefixes",
  "TestGrammarAdmissionDeclarationOperatorRegression",
  "TestGrammarAdmissionIndexSignatureGrammar",
  "TestGrammarAdmissionIsPrefixPrecedenceRegression",
  "TestGrammarAdmissionIsPrefixCorpusReplay",
  "TestGrammarAdmissionSchemaJSDocKeys",
  "TestGrammarAdmissionSchemaJSDocRegression",
  "TestGrammarAdmissionOptionalTuples",
  "TestGrammarAdmissionDynamicImport",
  "TestGrammarAdmissionSchemaAliasMemberKeys",
  "TestGrammarAdmissionSchemaAliasMemberRegression",
  "TestGrammarAdmissionSchemaDuplicateReadonlyKeys",
  "TestGrammarAdmissionSchemaAsyncUntypedAliasKeys",
  "TestGrammarAdmissionSchemaDuplicateReadonlyRegression",
  "TestGrammarAdmissionSchemaStaticKeys",
  "TestGrammarAdmissionSchemaStaticRegression",
  "TestGrammarAdmissionSchemaAsyncKeys",
  "TestGrammarAdmissionSchemaAsyncRegression",
  "TestGrammarAdmissionSchemaMixedModifierKeys",
  "TestGrammarAdmissionSchemaMixedModifierRegression",
  "TestGrammarAdmissionDeepNative",
  "TestGrammarAdmissionDeepRejected",
  "TestGrammarAdmissionDeepKeys",
  "TestGrammarAdmissionMetaPropertyKeys",
  "TestGrammarAdmissionMetaPropertyNative",
  "TestGrammarAdmissionMetaPropertyRegression",
  "TestGrammarAdmissionImportArityKeys",
  "TestGrammarAdmissionImportArityRegression",
  "TestGrammarAdmissionMutationKeys",
  "TestGrammarAdmissionDeclarationExports",
  "TestGrammarAdmissionDeclarationExportRegression",
  "TestGrammarAdmissionRegExpSyntaxDiagnostics",
  "TestGrammarAdmissionRegExpSyntaxRegression",
  "TestGrammarAdmissionProvideIdentifier",
  "TestGrammarAdmissionProvideIdentifierRegression",
  "TestGrammarAdmissionSchemaInterruptionKeys",
  "TestGrammarAdmissionSchemaInterruptionRegression",
  "TestGrammarAdmissionInstantiationASI",
  "TestGrammarAdmissionInstantiationASIRegression",
  "TestGrammarAdmissionRegExpLexing",
  "TestGrammarAdmissionRegExpTokenCategory",
  "TestGrammarAdmissionRegExpKeys",
  "TestGrammarAdmissionRegExpRegression",
  "TestGrammarAdmissionParenthesizedEffectKeys",
  "TestGrammarAdmissionParenthesizedEffectRegression",
  "TestCurrentDiagnosticPolicyRegression",
  "TestCompileCurrentDiagnosticPolicy",

  "TestFormatContractCommentQuote",
  "TestFormatContractCommentNeighbors",
  "TestFormatContractCommentNeighborhood",
  "TestFormatContractCommentEqualityTokens",
  "TestFormatContractCommentModules",
  "TestCheckerLayout",
  "TestSidecarPortabilityRegression",
  "TestVibeModuleBoundaryRegression",
  "TestVibeModuleBoundaryEmission",
  "TestVibeModuleNativeCounterparts",
  "TestVIPCanonicalFieldNames",
  "TestVIPEncodedFieldNames",
  "TestRegistryMatchesSpec",
  "TestSeverityCodesMatchAppendixB",
  "TestRegistryCategoriesMatchAppendixB",
  "TestAppendixBSeveritySettingsTakeEffect",
  "TestCompilerRegistryIsSpecified",
  "TestConfigOracleMatchesCompiler",
  "TestConfigPathBases",
  "TestNativeAwaitOptionsRegression",
  "TestNativeAwaitOptionsTypeScriptCompatibility",
  "TestRegistryRowsSuggestRepairs",
  "TestCommandLineFlagsCoverSpec",
  "TestSpecFacts",
  "TestDiagnosticCodesKeepFullOrdinal",
  "TestPendingLines",
  "TestLiteralMatchCorpusActive",
  "TestSuperseded",
  "TestDataGeneratedMatchSeparators",
  "TestFailuresSpecQuotes",
  "TestFailuresSpecCoverage",
  "TestSpecRuleFacts",
  "TestSpecRuleTable",
  "TestSpecRuleCoverage",
  "TestRuntimeFeatureCitations",
  "TestToolsFormatSemanticContract",
  "TestToolsFormatIdenticalInvalidEmit",
  "TestToolsFormatInvalidEmitWitness",
  "TestToolsHelpers",
  "TestCanonicalVIPExitRejectsInvalidReasonTags",
  "TestCanonicalVIPExitReasonTagControls",
  "TestVIPTemplatesCited",
  "TestCLISpecCommandFlags",
  "TestVIPFiberIDNumberEquality",
  "TestFunctionsSpecQuotes",
  "TestVIPCoverage",
  "TestSpecProductionsOnlyInAppendixA",
  "TestSpecCitedProductionsExist",
  "TestSpecCodesInAppendixB",
  "TestAppendixBRows",
  "TestShortTargetsBudgeted",
  "TestUnionDataMemberPlainTypeScript",
  "TestCounterpartDeclarationComparison",
  "TestDeclarationIdentityCanonicalization",
  "TestDataCounterpartFoldkit",
]
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
  "10m",
  fuzzBudgetEnv
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
// internal/vibelangfuzz/<topic>_*_test.go over their seeds, and the Test
// functions of those files. The
// merge gate runs a topic for a change to a compiler source file or a fuzz
// test of that topic (ls/gate-cases.sh), where //:go-vibelangfuzz runs only
// post-merge: 58bb695700ad changed the note in prelude_collision_diagnostic.go
// and main 54735153d416 went RED on FuzzPreludeGlobalMember. Post-merge names
// its labels, so these targets run only when selected.
const fuzzTopicTargets = Object.fromEntries(
  [...fuzzTopics].map(([topic, names]) => [
    `go-vibelangfuzz-topic-${topic}`,
    goVibelang(
      `The ${topic} fuzz oracles over their seeds, and the topic's tests: ${names.join(", ")}.`,
      `CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 VIBELANG_FUZZ_HANG=120s ${effect} ` +
        `go test -short -count=1 -timeout=15m -trimpath -run '^(${names.join("|")})$' ./internal/vibelangfuzz/`,
      // Migration probes read the canonical flow and execute the shipped formatter.
      [Tsc["vibelangfuzz-files"], ...(topic === "migration" ? [migrationSources, Packages["compiler-native"]] : [])],
      "30m"
    )
  ])
)

// Independent checks use the launcher's complete binary-discovered inventory.
// Package seams keep the small support suites separate; weighted slices bound
// the large seed package without maintaining a list of individual test names.
const fuzzShardPlans = [
  ...Array.from({ length: 32 }, (_, index) => ({
    label: `go-vibelangfuzz-seeds-${index + 1}`,
    pkg: "./internal/vibelangfuzz/",
    slice: `${index + 1}/32`,
    run: ""
  })),
  ...[
    "./internal/vibelangfuzz/grammaradmission/",
    "./internal/vibelangfuzz/specgen/",
    "./internal/vibelangfuzz/vipgen/",
    "./internal/vibelangfuzz/testtools/parse/",
    "./internal/vibelangfuzz/vipgen/programs/"
  ].map(pkg => ({
    label: `go-vibelangfuzz-package-${pkg.slice("./internal/vibelangfuzz/".length, -1).replaceAll("/", "-")}`,
    pkg,
    slice: "1/1",
    run: ""
  })),
  { label: "go-vibelangfuzz-vip", pkg: "./internal/vibelangfuzz/", slice: "1/1", run: "^FuzzVIPDifferential$" }
]
const fuzzShardTargets = Object.fromEntries(fuzzShardPlans.map(({ label, pkg, slice, run }) => {
  const summary = `The fuzz seed corpus in ${pkg}, partition ${slice}.`
  // Bound cold support-package compilation to the four-core CI boxes.
  const maxProcs = pkg === "./internal/vibelangfuzz/" && !run
    ? `$(n=$(node -p 'require("node:os").availableParallelism()'); [ "$n" -lt 24 ] && echo "$n" || echo 24)`
    : "4"
  const buildJobs = pkg === "./internal/vibelangfuzz/" && !run ? 6 : 4
  const selection = run ? ` -run '${run}'` : pkg === "./internal/vibelangfuzz/" ? " -skip '^FuzzVIPDifferential$'" : ""
  const shell = `CGO_ENABLED=0 GOMAXPROCS=${maxProcs} GOFLAGS=-p=${buildJobs} VIBELANG_FUZZ_REQUIRE=1 VIBELANG_FUZZ_HANG=120s ${effect} ` +
    `go test -short -count=1 -timeout=8m -trimpath -exec "$PWD/../../scripts/go-test-shards.sh"${selection} ${pkg}`
  const env = { ...fuzzBudgetEnv, GO_TEST_SLICE: slice, GO_TEST_SHARDS: "2" }
  const launcher = S.file("//scripts/go-test-shards.sh")
  return [label, pkg === "./internal/vibelangfuzz/"
    // Seed oracles read arbitrary cases, specification pages, installs and
    // migration sources. Preserve the original whole-tree inputs.
    ? goVibelang(summary, shell,
      [Tsc["vibelangfuzz-files"], launcher, Packages["compiler-native"], migrationSources], "10m", env)
    // Support tests read their package, saved corpora and (for admission)
    // specification/registry pages, without the compiler's npm artifact.
    : check(summary, `cd typescript/tsc && GOCACHE=$HOME/.cache/go-build-smthrs ${shell}`,
      [Tsc.srcs, launcher, S.Filegroup({ srcs: [...S.glob([
        `typescript/tsc/${pkg.slice(2)}**`,
        "typescript/tsc/internal/vibelangfuzz/testdata/**",
        ...(pkg.endsWith("/grammaradmission/") ? ["docs/design/**"] : [])
      ])] })], [go, node], "10m", env, [])
  ]
}))

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

// Specification checks share the normal graph and cache. The existing forms
// gate selection reaches these dependencies without a pre-gate change.
const specInputs = S.Filegroup({ srcs: [...S.glob([
  "docs/design/**", "typescript/vibelang/cases/**", "docs/tools/spec-rules*", "docs/tools/spec-schema-constructor*", "docs/tools/spec-examples*", "docs/tools/spec-lint*", "docs/tools/spec-pipe-arrows*", "docs/tools/spec-native-source-resolution*", "docs/tools/spec-diagnostic-*",
  "docs/tools/package.json", "docs/tools/bun.lock", "docs/maintainers/build.md",
  "docs/tools/diagnostic-identity*", "docs/tools/diagnostic-archive-examples*", "docs/tools/diagnostic-examples*", "docs/tools/diagnostic-native-projects*", "typescript/vibelang/cases/appendix-diagnostic-identities/examples.json", "scripts/diagnostic-inventory.mjs", "docs/tools/factory-diagnostic-retirement.test.mjs",
  "typescript/tsc/internal/vibelangfuzz/testdata/fuzz/**", "docs/tools/property-regressions/gate6-ek4804.json", "docs/tools/property-regressions/gate6-mapper-ek2115.json", "typescript/tsc/internal/vibelang/diagnostics.go",
  "docs/user/src/getting-started/012-devtools.md", "PACKAGE.ts",
  "typescript/tsc/internal/diagnostics/diagnosticMessages.json",
  "typescript/tsc/internal/tsoptions/declarations_generated.go"
])] })
const specSharedTables = S.Generate({
  command: "node docs/tools/spec-rules.mjs generate",
  changes: ["docs/design/generated/resolution.md"],
  data: [S.Filegroup({ srcs: [...S.glob(["docs/tools/spec-rules.mjs", "docs/design/vips/0039-vibex.md"])] })],
  mode: "check", sandbox: "none"
})
const specCopySections = S.Generate({
  command: "node docs/tools/spec-rules.mjs copies --write",
  changes: ["docs/design/src/001-functions.md", "docs/design/src/007-tooling.md"],
  data: [specInputs], mode: "check", sandbox: "none"
})
const specCheck = (kind: string, deps: ReadonlyArray<unknown> = []) => S.Shell.Test({
  summary: "Specification " + kind + " contracts agree with published VIP authority.",
  shell: "node docs/tools/spec-rules.mjs " + kind,
  data: [specInputs, ...deps] as Array<never>, tools: [node], sandbox: "none", timeout: "2m"
})
const specCatchDiagnostics = S.Shell.Test({
  summary: "Closed catch handler diagnostics agree across VIP-5 and both catalogs.",
  shell: "node docs/tools/spec-catch-diagnostics.mjs && node --test docs/tools/spec-catch-diagnostics.test.mjs",
  data: [specInputs, S.Filegroup({ srcs: [...S.glob(["docs/tools/spec-catch-diagnostics*"])] })],
  tools: [node], sandbox: "none", timeout: "2m"
})
const specPipeArrows = S.Shell.Test({
  summary: "Pipe restrictions preserve closed catch arrows and reject blanket exclusions.",
  shell: "node docs/tools/spec-pipe-arrows.mjs && node --test docs/tools/spec-pipe-arrows.test.mjs",
  data: [specInputs], tools: [node], sandbox: "none", timeout: "1m"
})
const specRegistry = specCheck("registry")
// Diagnostic identity is a release blocker and participates in ordinary spec checks.
const specDiagnosticIdentity = S.Shell.Test({
  summary: "Compiler registrations, Appendix B definitions and current doc citations agree.",
  shell: "node --test docs/tools/diagnostic-identity.test.mjs docs/tools/diagnostic-archive-examples.test.mjs docs/tools/diagnostic-native-projects.test.mjs docs/tools/spec-diagnostic-compatibility-pending.test.mjs && node docs/tools/diagnostic-identity.mjs",
  data: [S.Filegroup({ srcs: [...S.glob([
    "docs/tools/diagnostic-*", "docs/tools/spec-diagnostic-*", "docs/tools/package.json", "docs/tools/bun.lock", "typescript/tsc/internal/vibelangfuzz/testdata/fuzz/**", "docs/tools/property-regressions/gate6-ek4804.json", "docs/tools/property-regressions/gate6-mapper-ek2115.json",
    "docs/design/**", "docs/user/src/**", "docs/user/llms-essentials.md",
    "packages/compiler/skills/vibelang/SKILL.md", "templates/app/AGENTS.md",
    "typescript/tsc/internal/**/*.go", "docs/design/retirement-allowlist.json", "typescript/vibelang/cases/**", "PACKAGE.ts"
  ])] })],
  tools: [node], sandbox: "none", timeout: "2m"
})
const specAppendixExamples = S.Shell.Test({
  summary: "Executable Appendix B diagnostic examples retain their printed codes and categories.",
  shell: "EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node docs/tools/diagnostic-examples.mjs",
  data: [specInputs, Packages["compiler-native"], Packages["runtime-dist"]] as Array<never>,
  tools: [node], sandbox: "none", timeout: "5m"
})
const specAppendixHostExamples = goVibelang(
  "Appendix mapper diagnostics and explicit editor repairs keep their documented identities.",
  `CGO_ENABLED=0 ${effect} go test -p 8 -count=1 -trimpath -timeout 5m -run "TestCompatibilityIdentityPrimaryMessages|TestFiberFlows|TestAppendixMapperHostExamples|TestAppendixEditorHostExamples|TestAppendixRegisteredOnlyHostExamples|TestInferred|TestFormChoiceDidChange|TestReceiverChoiceDidChange|TestUnprojectedForm|TestRenderExec|TestAutomaticTracingOptionRejected|TestVersionMismatchDiagnostic" ./internal/vibelang ./internal/vibelangmapper ./internal/ls`
)
const specTables = specCheck("tables")
const specCopies = specCheck("copies", [specSharedTables, specCopySections])
const specAuthority = specCheck("authority")
const specExamples = S.Shell.Test({
  summary: "Accepted VIP examples compile; negative examples report their stated codes.",
  shell: "EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node docs/tools/spec-examples.mjs",
  data: [specInputs, Typescript.compiler, Packages["compiler-native"], Packages["runtime-dist"]] as Array<never>,
  tools: [node], sandbox: "none", timeout: "15m"
})
const specSchemaConstructor = check(
  "Schema constructor documentation matches decoding in the pinned Effect version.",
  "node docs/tools/spec-schema-constructor.mjs && node --test docs/tools/spec-schema-constructor.test.mjs",
  [], [node], "1m"
)
const specLinterTests = S.Shell.Test({
  summary: "Historical spec defects, VIP links and supersession, module extraction scope and projection source kinds, seeded properties and native example checks reject regressions.",
  shell: "node --test docs/tools/spec-rules.test.mjs docs/tools/spec-examples-compiler.test.mjs docs/tools/spec-rules-import-grammar.test.mjs docs/tools/diagnostic-identity.test.mjs docs/tools/diagnostic-examples.test.mjs docs/tools/diagnostic-archive-examples.test.mjs docs/tools/diagnostic-native-projects.test.mjs docs/tools/factory-diagnostic-retirement.test.mjs && cd docs/tools && bun test --timeout 60000 spec-lint.test.ts spec-native-source-resolution.test.ts",
  data: [specInputs, Packages["compiler-native"], Packages["runtime-dist"]] as Array<never>,
  tools: [node, bun, S.Host.bin("jj"), S.Host.bin("python3")], sandbox: "none", timeout: "10m"
})

// Entry diffs depend on jj history. Require immutable commit IDs in the
// environment so both sides enter the key; mutable revision names are refused.
// Explicit selection keeps a diff-only check out of ordinary wildcard CI.
const ruleEvidenceEnv = {
  RULE_EVIDENCE_BASE: process.env.RULE_EVIDENCE_BASE ?? "",
  RULE_EVIDENCE_HEAD: process.env.RULE_EVIDENCE_HEAD ?? ""
}
const specRuleEvidence = S.Shell.Test({
  summary: "Changed specification rules carry a relevant case or a compiled Effect twin with identical declarations or Exit.",
  shell: "bun docs/tools/rule-evidence.ts --immutable",
  data: [tree, Packages["compiler-native"], Packages["runtime-dist"]],
  tools: [bun, node, S.Host.bin("jj")],
  env: ruleEvidenceEnv,
  exclusive: true,
  sandbox: "none",
  timeout: "10m"
})
const specRuleEvidenceTest = S.Shell.Test({
  summary: "Rule evidence rejection classes, exempt controls, mutations and real compiled twins.",
  shell: "bun test --timeout 120000 docs/tools/rule-evidence.test.ts",
  data: [tree, Packages["compiler-native"], Packages["runtime-dist"]],
  tools: [bun, node, S.Host.bin("jj")],
  sandbox: "none",
  timeout: "5m"
})

// Both gate entry points select this aggregate. Each check has one owning
// target; shared graph dependencies execute once and retain their own cache.
// The census is a generated projection, not the grammar's admission authority.
const grammarAdmission = S.Generate({
  script: S.file("scripts/generate-grammar-admission.mjs"),
  changes: [
    "typescript/tsc/internal/vibelangfuzz/testdata/grammar_admission.tsv",
    "docs/design/src/900-appendices.md"
  ],
  data: [tree],
  sandbox: "none"
})
const grammarAuthority = check(
  "Whole-shape service census entries retain their accepted grammar authority.",
  "node scripts/check-grammar-authority.mjs && node --test scripts/grammar-authority.test.mjs",
  [], [node], "1m"
)
const grammarAdmissionCheck = check(
  "Every grammar admission table matches its reviewed census source.",
  "node scripts/generate-grammar-admission.mjs --check",
  [grammarAuthority], [node]
)

const specLint = S.Shell.Test({
  summary: "Static specification contracts and their regression tests.",
  shell: "echo 'spec-lint: static contracts passed'",
  data: [specRegistry, specSchemaConstructor, specTables, specCopies, specAuthority, specLinterTests, specPipeArrows, specCatchDiagnostics, specAppendixExamples, specDiagnosticIdentity, specAppendixHostExamples],
  sandbox: "none", timeout: "1m"
})

const foreignCallExamples = S.Shell.Test({
  summary: "VIP-4 unknown-call rules and prelude examples agree, with regression and generated mutations.",
  shell: "node --test docs/tools/spec-foreign-call-contract.test.mjs",
  data: [design, S.Filegroup({ srcs: [...S.glob(["docs/tools/spec-foreign-call-contract*.mjs", "docs/tools/package.json", "docs/tools/bun.lock"])] })],
  tools: [node],
  sandbox: "none",
  timeout: "5m"
})

const sidecarRootContract = S.Shell.Test({
  summary: "Sidecar specification mirrors TypeScript declaration roots, with a native twin and generated path controls.",
  shell: "node --test docs/tools/spec-sidecar-roots.test.mjs",
  data: [design, S.Filegroup({ srcs: [...S.glob(["docs/tools/spec-sidecar-roots*.mjs", "docs/tools/package.json", "docs/tools/bun.lock"])] })],
  tools: [node],
  sandbox: "none",
  timeout: "5m"
})

const goTestProgress = S.Filegroup({ srcs: [...S.glob(["scripts/go-test-progress.mjs"])] })

const buildContractInputs = createBuildContractInputs(S)
const buildContracts = check(
  "Build and test commands retain their explicit budgets and prerequisites.",
  "node --test --test-concurrency=4 " + buildContractSuites.join(" "),
  [],
  [go, node],
  "5m",
  {},
  [buildContractInputs]
)

const apiIdentityFiles = createApiIdentityInputs(S, Packages.tree)

const apiIdentityTest = check("Published export names, tsc type identity and JSDoc, with property controls.", "node scripts/sync-api-identity.mjs --check && node --test scripts/api-identity*.test.mjs", [], [node], undefined, {}, [apiIdentityFiles])

const declarationPreservation = S.Shell.Test({
  summary: "VIP-27 declaration-preservation prose uses API identity; regression and generated wording checks.",
  shell: "node --test docs/tools/spec-declaration-preservation.test.mjs",
  data: [design, S.Filegroup({ srcs: [...S.glob(["docs/tools/spec-declaration-preservation*.mjs", "docs/tools/package.json", "docs/tools/bun.lock"])] })],
  tools: [node],
  sandbox: "none",
  timeout: "5m"
})

const targets = {
  // Root ownership keeps template globs in scope without introducing a new
  // package boundary that would narrow the repository-wide tree checks.
  "docs-failure-contracts": check(
    "Tutorial compile-error claims distinguish a written failure contract from inferred propagation.",
    "bun docs/tools/check-failure-contracts.ts && bun test --timeout 60000 docs/tools/check-failure-contracts.test.ts",
    [Packages["compiler-native"], Packages["runtime-dist"]],
    [bun, node]
  ),
  "create-cli": S.Shell.Test({
    summary: "Run the scaffolder's fast CLI unit tests.",
    shell: "node --test packages/create-vibelang/test/create.test.mjs packages/create-vibelang/test/dev.test.mjs packages/create-vibelang/test/filesystem.property.test.mjs packages/create-vibelang/test/pin.property.test.mjs",
    data: [
      S.file("packages/create-vibelang/package.json"),
      S.file("packages/create-vibelang/bin/create-vibelang.mjs"),
      S.file("packages/create-vibelang/bun.lock"),
      S.glob("packages/create-vibelang/test/**"),
      S.file("scripts/testing/property.mjs"),
      S.file("scripts/testing/property-slice.mjs"),
      S.glob("templates/app/**"),
      S.file("docs/user/llms-essentials.md")
    ],
    tools: [node, S.Host.bin("npm"), S.Host.bin("tar")],
    sandbox: "none",
    timeout: "1m"
  }),
  "spec-coverage-census": S.Shell.Run({
    summary: "Inventory main rules with passing, pending, missing and tag-linked evidence.",
    shell: 'bun docs/tools/coverage-census.ts --revision "$CENSUS_REVISION" --out "${CENSUS_OUT:-.cache/coverage-census}"',
    env: { CENSUS_REVISION: process.env.CENSUS_REVISION ?? "main@github", CENSUS_OUT: process.env.CENSUS_OUT ?? "" },
    data: [tree],
    tools: [bun, S.Host.bin("jj")],
    manual: true, sandbox: "none", timeout: "10m"
  }),
  "spec-coverage-census-test": S.Shell.Test({
    summary: "Census extraction, immutable snapshots, stable ids and conservative evidence properties.",
    shell: "bun test --timeout 60000 docs/tools/coverage-census.test.ts",
    data: [tree], tools: [bun], sandbox: "none", timeout: "2m"
  }),
  "spec-foreign-call-contract": foreignCallExamples,
  "spec-sidecar-roots": sidecarRootContract,
  "spec-object-pattern-counterpart": S.Shell.Test({
    summary: "Executable object-pattern counterparts retain callable objects, property presence and read order.",
    shell: "node docs/tools/spec-object-pattern-counterpart.mjs && node --test docs/tools/spec-object-pattern-counterpart.test.mjs",
    data: [design, S.Filegroup({ srcs: [...S.glob(["docs/tools/spec-object-pattern-counterpart*.mjs"])] })],
    tools: [bun],
    sandbox: "none",
    timeout: "5m"
  }),
  "spec-declaration-preservation": declarationPreservation,
  "spec-match-arm-throw": S.Shell.Test({
    summary: "Direct throwing match arms have one parse",
    shell: "node --test docs/tools/spec-match-arm-throw.test.mjs",
    data: [S.glob(["docs/design/**", "docs/tools/spec-match-arm-throw.test.mjs", "docs/tools/spec-witness.mjs", "docs/tools/package.json", "docs/tools/bun.lock"])],
    tools: [node],
    sandbox: "none",
    timeout: "5m"
  }),

  "spec-table-rows": S.Shell.Test({
    summary: "Specification tables preserve their cells under GFM, including code-span unions.",
    shell: "node --test docs/tools/spec-table-rows.test.mjs",
    data: [design, S.Filegroup({ srcs: [...S.glob(["docs/tools/spec-table-rows.test.mjs", "docs/tools/spec-witness.mjs", "docs/tools/table-rows.mjs", "docs/tools/package.json", "docs/tools/bun.lock"])] })],
    tools: [node],
    sandbox: "none",
    timeout: "5m"
  }),
  // A Run has no graph replay: revision and external decisions are runtime
  // inputs. The script pins the revision/diff verdict, including failures.
  // Platform owns attachment to the pre-gate; grounded violations reject by default.
  "spec-rule-judge": S.Shell.Run({
    summary: "Luna audits new spec rules against accepted authority; unavailable inputs fail open.",
    shell: "node scripts/spec-rule-judge.mjs",
    data: [tree],
    tools: [node, S.Host.bin("jj")],
    manual: true,
    sandbox: "none",
    timeout: "4m"
  }),
  "spec-rule-judge-test": S.Shell.Test({
    summary: "Rule judge quote validation, revision collection, failure and retry properties.",
    shell: "node --test scripts/spec-rule-judge.test.mjs",
    data: [S.file("//scripts/spec-rule-judge.mjs"), S.file("//scripts/spec-rule-judge.test.mjs"), S.file("//scripts/spec-rule-judge/score.mjs")],
    tools: [node, S.Host.bin("jj")],
    sandbox: "none",
    timeout: "1m"
  }),
  "docs-migration-cleanup": check(
    "Migration prompts retain native Effect cleanup and distinguish plain JavaScript statements.",
    "bun test --timeout 60000 docs/tools/migration-cleanup.test.ts && node --test .smithers/flows/migrate/test/context.test.mjs",
    [Packages["compiler-native"], Packages["runtime-dist"]],
    [bun, node]
  ),
  "api-identity-test": apiIdentityTest,
  "spec-shared-tables": specSharedTables,
  "spec-copy-sections": specCopySections,
  "spec-registry": specRegistry,
  "spec-diagnostic-identity": specDiagnosticIdentity,
  "spec-appendix-examples": specAppendixExamples,
  "spec-appendix-replays": S.Shell.Test({
    summary: "Every Appendix replay of a failing case names a diagnostic the case expects, with no compiler.",
    shell: "node --test docs/tools/appendix-case-replays.test.mjs",
    data: [specInputs, S.file("docs/tools/appendix-case-replays.test.mjs")],
    tools: [node], sandbox: "none", timeout: "2m"
  }),
  "spec-appendix-host-examples": specAppendixHostExamples,
  "spec-tables": specTables,
  "spec-pipe-arrows": specPipeArrows,
  "spec-copies": specCopies,
  "spec-authority": specAuthority,
  "spec-rule-evidence": specRuleEvidence,
  "spec-rule-evidence-test": specRuleEvidenceTest,
  "spec-vip-examples": specExamples,
  "spec-lint-unit": S.Shell.Test({
    summary: "Check current specification rules and their mutation properties without building a compiler.",
    shell: "bun test --timeout 60000 docs/tools/spec-lint.test.ts",
    data: [specInputs],
    tools: [bun, node],
    sandbox: "none",
    timeout: "2m"
  }),
  "spec-linters-test": specLinterTests,
  "spec-schema-constructor": specSchemaConstructor,
  "grammar-admission": grammarAdmission,
  "grammar-admission-check": grammarAdmissionCheck,
  "grammar-authority": grammarAuthority,
  "go-vibelangfuzz-hangs": pendingHangs,
  "docs-schema-defaults": check(
    "Schema decoding defaults use Effect values and preserve the documented missing-key outcomes.",
    "bun test --timeout 60000 docs/tools/schema-decoding-defaults.test.ts",
    [Packages["compiler-native"], Packages["runtime-dist"]],
    [bun, node]
  ),
  "site-spec-links": siteSpecLinks,
  "docs-framework-sidecars": check(
    "Vue and Svelte guides retain component checkers after native declaration-sidecar generation.",
    "bun test --timeout 60000 docs/tools/ui-setup.test.ts docs/tools/rev-docs-sidecars.test.ts",
    [Packages["compiler-native"], Packages["runtime-dist"]],
    [bun, node]
  ),
  "docs-shim-checkout": check(
    "The source-checkout preview installs its runtime in the target project before checking marked files.",
    "bun test --timeout 120000 docs/tools/shim-checkout.test.ts",
    [Packages["compiler-native"], Packages["runtime-dist"]],
    [bun, node],
    "3m"
  ),
  "spec-lint": specLint,
  "docs-comparison-output": check(
    "Complete Effect comparisons print the output their prose promises, without an injected runner.",
    "bun docs/tools/check-comparison-output.ts && bun test --timeout 60000 docs/tools/check-comparison-output.test.ts",
    [Packages["compiler-native"]],
    [bun, node]
  ),
  "harness-deadlines": check(
    "Every case runner's deadline covers the stage deadlines written in it and in the helpers it imports.",
    "node --test typescript/vibelang/harness-deadlines.test.mjs",
    [],
    [node],
    "5m"
  ),
  "case-import-extensions": check(
    "Every case importing a .ts, .vibe or .vibex path sets an extension option or expects TS5097, with no compiler.",
    "node --test typescript/vibelang/case-import-extensions.test.mjs",
    [],
    [node],
    "2m"
  ),
  "spec-catch-diagnostics": specCatchDiagnostics,
  release: check(
    "The release, contributor and site generator node tests, the upgrade and maintenance flows' steps, and their evals' step keys.",
    "node --test --test-concurrency=4 scripts/release/*.test.mjs 'scripts/!(api-identity*|" + buildContractExclusions + ").test.mjs' typescript/vibelang/harness.test.mjs typescript/vibelang/harness-deadlines.test.mjs typescript/vibelang/cov-ch004-twin.test.mjs typescript/vibelang/coverage-stock-twins.test.mjs typescript/vibelang/vip7-reference.test.mjs docs/redirect/*.test.mjs " +
      "site/scripts/sync-spec-docs.test.mjs site/scripts/sync-user-docs.test.mjs " +
      ".smithers/flows/effect-bump/test/*.test.mjs .smithers/flows/ts-bump/test/*.test.mjs .smithers/flows/ci-health/test/*.test.mjs .smithers/flows/first-bad/test/*.test.mjs " +
      ".smithers/flows/test/*.test.mjs",
    [apiIdentityTest, buildContracts, Typescript["forms-generator"], Packages["compiler-native"], Packages["runtime-dist"]],
    [node, bun, gofmt, bun, go, S.Host.bin("diff3")]
  ),
  "starter-templates": check(
    "Compile and run every starter with zero diagnostics and zero legacy sites.",
    "bun test --timeout 180000 docs/tools/starter-templates.test.ts",
    [Typescript["forms-generator"], Packages["compiler-native"], Packages["runtime-dist"]],
    [bun, node],
    "5m"
  ),
  // The specification's examples are checked too, so a compiler-gap marker
  // whose block now compiles fails here instead of going stale.
  snippets: check(
    "Compile every code block in the docs and the specification.",
    "bun docs/tools/check-snippets.ts && bun docs/tools/check-snippets.ts --root docs/design/src",
    [Typescript.compiler, Packages["runtime-dist"], Packages["compiler-native"]],
    [bun, node]
  ),
  // A case copied from an older one keeps its pin, so stale pins landed on the
  // stack, which gates only on a build. Fast enough for that gate.
  "docs-migration-globals": check(
    "Migration guidance admits ECMAScript clocks and randomness and keeps its generated context current.",
    "bun test --timeout 60000 docs/tools/rev-docs-transitions.test.ts && node --test .smithers/flows/migrate/test/context.test.mjs",
    [Packages["compiler-native"], Packages["runtime-dist"]],
    [bun, node]
  ),
  "docs-convert-examples": check(
    "Worked conversion examples preserve TypeScript construction, recovery and schema optionality.",
    "bun test --timeout 180000 docs/tools/convert-examples.test.ts",
    [Packages["compiler-native"], Packages["runtime-dist"]],
    [bun, node],
    "5m"
  ),
  "effect-pin": check("Every manifest and version literal pins the runtime's Effect version.", "node scripts/effect-pin.mjs", [], [node]),
  // Fast targets the queue's build-only gate selects by changed path (the merge
  // queue's validate.sh), so a commit that breaks one stops at the queue, not in
  // post-merge. scripts/fast-gate-targets.test.mjs keeps what they name real.
  "flow-layout": check("Each migrate step's result literal lists one property per line.", "node --test .smithers/flows/migrate/test/layout.test.mjs", [], [node]),
  "grammar-inventory": S.Shell.Test({
    summary: "Every parser and lowering hook has a row in the grammar admission inventory, and every row has a hook.",
    shell: "cd typescript/tsc && GOCACHE=$HOME/.cache/go-build-smthrs CGO_ENABLED=0 go test -count=1 -trimpath ./internal/vibelangfuzz/grammaradmission/",
    data: [design, Tsc.srcs, Tsc["vibelang-files"], Tsc["vibelangfuzz-files"]] as Array<never>,
    tools: [go],
    sandbox: "none",
    timeout: "10m"
  }),
  "mapper-scripts": check(
    "The mapper's hover, parity and RPC runners work on the current fixtures and compiler.",
    "node --test --test-concurrency=4 scripts/mapper-*.test.mjs",
    // The parity selection test drives typescript/built/local/vibelang-mapper (scripts/testing/mapper-binary.mjs).
    // Without it the test built its own copy inside a 900 s hook, which timed out on a loaded post-merge box.
    [Typescript.compiler, Typescript.mapper, Packages["runtime-dist"], Packages["compiler-native"]],
    [bun, node],
    // 280-610 s on a shared 4-vCPU gate box; 10m cut off 2 of 11 post-merge runs mid-suite.
    "20m"
  ),
  "docs-jsx-output": check(
    "Public JSX output claims and generated filenames follow TypeScript's mode-specific extension.",
    "node --test docs/tools/spec-jsx-modes.test.mjs",
    [],
    [node]
  ),
  "docs-bun-computed-imports": check(
    "Bun import guidance separates preload support from extensionless runtime resolver hooks.",
    "node docs/tools/bun-computed-import-claims.mjs && bun test --timeout 60000 docs/tools/bun-computed-import-claims.test.ts",
    [],
    [bun, node]
  ),
  "docs-release-history": check(
    "Release notes follow recorded npm publication and keep unpublished fixes in the compiler candidate.",
    "node docs/tools/release-history.mjs --check && bun test --timeout 60000 docs/tools/release-history.test.ts docs/tools/release-*publication.test.mjs",
    [],
    [bun, node]
  ),
  tokens: check("Token counts in the docs match a fresh count.", "bun docs/tools/token-counts.ts --check", [], [bun]),
  // The executable is source-keyed; generation still reads the entire tree.
  forms: check(
    "The forms table and its decisions match a fresh generation.",
    "FORMS_BINARY=$PWD/typescript/built/local/vibelang-forms " +
      "GOCACHE=$HOME/.cache/go-build-smthrs bash scripts/check-forms-table.sh",
    [Typescript["forms-generator"], specLint, grammarAdmissionCheck],
    [bun, node]
  ),
  "build-contracts": buildContracts,
  "build-contract-inputs-cache": check(
    "Build contracts retain their read inputs and reuse unrelated changes, with actual SDK controls.",
    "node --test build-contract-inputs.test.mjs",
    [],
    [go, node],
    "15m",
    {},
    [buildContractInputs, S.file("build-contract-inputs.test.mjs"),
      S.file(".smithers/WORKSPACE.ts"), S.file(".smithers/bun.lock")]
  ),
  "api-inputs-cache": check(
    "Actual SDK caching retains API helper dependencies and rejects changed public declarations.",
    "node --test --test-name-pattern='^(relative API fixture inputs|real SDK caching|current API entrypoints)' .smithers/flows/test/api-inputs.test.mjs",
    [],
    [node],
    "10m"
  ),
  "promise-data-bridge": check(
    "Explicit synchronous bridges retain Promise and thenable data while plain catch preserves identity.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 VIBELANG_FUZZ_HANG=120s EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestPromiseDataBridgeQuoted|TestPromiseDataBridgeForms)$' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --isolated --verbose plain-catch-function-results",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "trusted-callback-contracts": check(
    "Listed trusted callbacks keep explicit foreign contracts and constructor shadowing behavior.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestTrustedCallbackContractsQuoted|FuzzTrustedCallbackContracts)$' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --isolated --verbose hygiene-builtin-failure-class",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  
  "whole-service-declarations": check(
    "Whole-shape service declarations match their native counterpart without invented namespaces.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestWholeServiceShapeDeclarationQuoted|FuzzWholeServiceShapeDeclaration)$' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --isolated --verbose declaration-identity-namespace-imports",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "legacy-provider-identities": check(
    "Missing-provider diagnostics keep their compatibility identity and do not apply to stored Effect data.",
    "cd typescript/tsc && CGO_ENABLED=0 go test -v -p 8 -count=1 -trimpath -timeout=5m ./internal/vibelang -run '^TestCompatibilityIdentityPrimaryMessages$' && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestLegacyProviderIdentityQuoted|FuzzLegacyProviderIdentity)$' && CGO_ENABLED=0 go vet -p 8 -trimpath ./internal/vibelangfuzz && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --isolated --verbose d362-effect-provide-union.fail d362-provide-tuple.fail",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Tsc["vibelang-files"], Vibelang.tree],
    [go, node, bun],
    "15m"
  ),
  "legacy-json-advisory": goVibelang(
    "Legacy JSON advisory evidence uses supported configuration while defaults stay disabled.",
    "CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestInterimLegacySeveritiesQuoted|TestInterimLegacySeverityOverrides|FuzzInterimLegacySeverities)$' && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^FuzzCompile$/^registry-EK4818$'",
    [Tsc["vibelangfuzz-files"]],
    "10m"
  ),
  "optional-callback-identities": check(
    "Optional callback contracts retain both operand admission and channel diagnostics.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestOptionalEffectGuardsQuoted|FuzzOptionalEffectGuards)$' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --isolated --verbose optional-callback-contract.fail",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "native-setup-exit-behavior": check(
    "Setup retains actual TypeScript build/emit behavior and explicit author overrides.",
    "node --test .smithers/flows/migrate/test/native-lint-exit-policy.test.mjs",
    [Packages["compiler-native"], Packages["runtime-dist"]],
    [node, bun],
    "5m"
  ),
  "interim-severity-probes": check(
    "Interim diagnostic configuration retains exact rejection across the current compatibility inventory.",
    "EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --isolated --verbose cov900-interim-severity.fail",
    [Packages["compiler-native"], Packages["runtime-dist"], Vibelang.tree],
    [node, bun],
    "10m"
  ),
  "join-message-regressions": check(
    "Join diagnostics retain their accepted operand domain and Deferred guidance.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestJoinOperandDiagnosticsQuoted|FuzzJoinOperandDiagnostics)$' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --isolated --verbose fibers-await.fail",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "lint-activation-regressions": check(
    "Imported lint retains configured legacy activation and leaves unconfigured projects inactive.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestLintActivationQuoted|FuzzLintActivation|TestLintPluginMigrationQuoted)$' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --isolated --verbose effect-lint-activation ek4823-effect-block.fail",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "service-member-controls": check(
    "Invalid service members retain errors while valid native service classes retain their advisory.",
    "cd typescript/tsc && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --isolated --verbose service-nameless-members.fail",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "plain-runner-promise-data": check(
    "Plain runner examples retain eager Promise creation and explicit later awaiting.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^TestPromiseDataBridgeForms$' && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^FuzzPromiseResultGate$/^plain-runpromise-' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --isolated --verbose vip1-accept-plain-runpromise",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "option-direct-consumption": check(
    "Option match retains its teaching advisory while direct try consumption avoids generic warnings.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^FuzzTryOperandEffectArgumentDiagnostics$' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --isolated --verbose tsforms-option-match-program",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "lexical-restore-regressions": check(
    "Restore examples use lexical masks and retain outward return and interruption behavior.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestInterruptionPlacementQuoted|FuzzInterruptionPlacement)$' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --isolated --verbose restore-in-uninterruptible-expression interruption-nested-restore",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "native-value-boundaries": check(
    "Native identity examples keep explicit boundaries and original process-service observations.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestNativeValueDefectBoundaryQuoted|FuzzNativeValueDefectBoundary)$' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --isolated --verbose experimental-process-current-uid",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "object-runner-promise-data": check(
    "Object runner calls retain Promise values without running stored work.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestPromiseDataBridgeQuoted|TestPromiseDataBridgeForms)$' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --isolated --verbose plain-object-byname",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "stream-loop-head-identities": check(
    "Stream loop head rejections use their owning diagnostic without parser cascades.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestEffectLoopHeadsQuoted|FuzzEffectLoopHeadRecovery)$' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --isolated --verbose cov2-002a-stream-heads.fail vip20-head.fail",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "host-clock-identities": check(
    "Host clock reads keep the platform diagnostic and ignore retired clock settings.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestClockPlatformContractQuoted|FuzzClockPlatformContract)$' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --isolated --verbose d5-clock-read.fail",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "native-written-declaration-routes": check(
    "Native source imports of VibeLang declarations retain the corresponding TypeScript routes.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^TestWrittenSourceDeclarationSpellingsQuoted$' && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^FuzzWrittenSourceDeclarationSpellings$/^native-import-' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --isolated --verbose declaration-written-ts-import-vibe-target",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "setup-lint-exit-policy": check(
    "Setup preserves authored lint settings and native compiler exit policy.",
    "node --test --test-name-pattern='^(effect-exit-options:|effect-exit-extends:)' .smithers/flows/migrate/test/tsc-scripts.property.test.mjs && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --isolated --verbose effect-lint-built-in-setup-policy",
    [Packages["compiler-native"], Packages["runtime-dist"], Vibelang.tree],
    [node, bun, S.Host.bin("jj")],
    "10m"
  ),
  "catch-value-identities": check(
    "Invalid catch values keep their syntax error and independent native diagnostics without generic-call cascades.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestCatchValueDiagnosticsQuoted|FuzzCatchValueDiagnostics)$' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --isolated --verbose vip1-accept-catch-value-fallback.fail",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "throws-documentation-preservation": check(
    "Throw-tag migrations preserve authored comments and report manual migration without discarding prose.",
    "cd typescript/tsc && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --isolated --verbose vip4-coverage-annotation-fix",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelang-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "form-repair-sidecars": check(
    "Retained TypeScript-form diagnostics and native error declarations keep their compiler behavior.",
    "cd typescript/tsc && CGO_ENABLED=0 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -count=1 -trimpath -timeout=5m ./internal/vibelang -run '^(TestTypeScriptForm|TestNativeErrorClassShapes)'",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelang-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "trusted-empty-forwarding": check(
    "Trusted-wrapper migration retains the original input proof and runs current forwarding output.",
    "cd typescript/tsc && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --isolated --verbose trusted-empty-migration",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelang-files"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "negative-promise-boundaries": check(
    "Rejected Promise calls retain every independent boundary, host and root-runner diagnostic.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestNegativePromiseBoundariesQuoted|FuzzNegativePromiseBoundaries)$' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --isolated --verbose ek1005-runners.fail ek1005-prelude-runner.fail ch10-fetch.fail ek4401-plain-call.fail",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "error-family-native-patterns": check(
    "Native error families preserve declarations and runtime routing through class and object patterns.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestErrorFamilyNativePatternsQuoted|FuzzErrorFamilyNativePatterns)$' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --isolated --verbose decl-error-family",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "pattern-predicate-contracts": check(
    "Pattern predicates retain source and foreign callable contracts without changing global objects.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestPatternPredicateContractQuoted|FuzzPatternPredicateContract)$' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --isolated --verbose match-vip7-patching",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "relocated-sidecar-layout": check(
    "Relocated sidecars share source identity only through their proven owning root.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestRelocatedSidecarLayoutQuoted|FuzzRelocatedSidecarLayout)$' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --isolated --verbose declaration-output-relocated-routes",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "catch-error-data-advisories": check(
    "Tagged errors returned as plain catch data retain the Effect-result advisory.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestCatchErrorDataAdvisoryQuoted|FuzzCatchErrorDataAdvisory)$' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --isolated --verbose tsforms-errors tsforms-errors-fixed",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "plain-unknown-contracts": check(
    "Unknown foreign calls retain native plain-code behavior and effect-code wrapper errors.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestPlainUnknownContractQuoted|FuzzPlainUnknownContract)$' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --isolated --verbose ek4401-fix.fail",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "producer-native-annotations": check(
    "Producer annotations retain TypeScript assignability with stock TypeScript positive and negative controls.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^FuzzProducerWrittenContract$' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --isolated --verbose producer-native-return-contracts",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "stream-loop-body-identities": check(
    "Stream-loop restrictions retain their owner diagnostics and valid local-break controls.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestStreamLoopBodyIdentityQuoted|FuzzStreamLoopBodyIdentity)$' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --isolated --verbose for-try-coverage-bindings.fail",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "missing-data-method-diagnostics": check(
    "Invalid data methods retain native missing-member errors without inferred-argument advisories.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestMissingDataMethodQuoted|FuzzMissingDataMethod)$' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --isolated --verbose data-methods-first-parameter.fail",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "tagged-pattern-binding-renames": check(
    "Tagged-data pattern bindings retain their property keys through reference and rename operations.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestPatternBindingRenameQuoted|FuzzPatternBindingRename)$'",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "nothrow-rethrow-escape-controls": check(
    "Nested callbacks retain their own rethrow admission and unadmitted escaping functions retain plain-code errors.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestNothrowAdmittedEscapeQuoted|FuzzNothrowAdmittedEscape)$'",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "native-import-preference-twins": check(
    "Unchanged native importers preserve declaration bytes and explicit imports follow stock TypeScript preferences.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestUnrelatedDeclarationSpecifierQuoted|FuzzUnrelatedDeclarationSpecifier)$' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --isolated --verbose native-import-preference-twins",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  
  
  
  "error-tag-inheritance-identities": check(
    "Error declarations reject inherited and reserved tags while retaining native property errors.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestReservedPayloadInheritanceQuoted|FuzzReservedPayloadInheritance)$' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --isolated --verbose decl-error-family-own-tag.fail && node typescript/vibelang/test/error-family-native-override.mjs",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  
  
  "lexical-capture-diagnostic-retirement": check(
    "Lexical captures remain supported and their retired diagnostic cannot regain an Appendix row.",
    "node --test docs/tools/diagnostic-examples.test.mjs && cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestLexicalCaptureRetirementQuoted|FuzzLexicalCaptureRetirement)$'",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "qualified-interruption-call-controls": check(
    "Qualified Effect interruption calls remain valid and retired unqualified call syntax stays rejected.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^FuzzRunningRules$'",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "native-await-declaration-twins": check(
    "Native await documentation retains its declaration and Promise contracts.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestNativeAwaitBridgeQuoted)$'",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "async-match-throw-contexts": check(
    "Async match throw contexts meet their spec oracle with all surrounding ordinary and Effect controls retained.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^FuzzMatchThrowContexts$'",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "formatter-written-jump-controls": check(
    "Formatter mutations preserve written jump labels and retain the semantic guard's negative controls.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestFormatGuardQuoted|TestFormatGuardRewriteWrittenJumpLabels|FuzzFormatGuard)$'",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "platform-callback-contracts": check(
    "Platform diagnostics retain independent foreign-callback contract errors.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestPlatformCallbackContractQuoted|FuzzPlatformCallbackContract)$' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --isolated --verbose ek4402-platform.fail",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "schema-alias-native-properties": goVibelang(
    "Schema alias documentation retains native property and declaration contracts.",
    `CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 ${effect} go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelang ./internal/vibelangfuzz -run '^(TestSchemaAliasNativePropertiesQuoted)$'`,
    [Tsc["vibelangfuzz-files"]],
    "10m"
  ),
  
  
  "recursive-legacy-slot-diagnostics": check(
    "Recursive legacy slots retain migration and call-cycle diagnostics with complete-contract controls.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestRecursiveLegacySlotsQuoted|FuzzRecursiveLegacySlots)$' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --isolated --verbose cov2-900b-cite-recursive-partial-contract.fail",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "fork-object-operands": check(
    "Fork owns assignability rejection while embedded native errors remain independent.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestForkObjectOperandsQuoted|FuzzForkObjectOperands)$' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --isolated --verbose conf-fork-object-operand.fail",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "plain-handler-regressions": check(
    "Plain catch handler throws remain errors while Effect handlers and nested Effects stay valid.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^FuzzFailuresSpec$/^plain-handler-' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --isolated --verbose catch-plain-throw.fail",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "abstract-error-family-membership": check(
    "Legacy abstract error roots retain native family matching through aliases and subclass histories.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestAbstractErrorFamilyMembershipQuoted|FuzzAbstractErrorFamilyMembership)$' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --isolated --verbose abstract-error-family-membership decl-error-family",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go,node,bun],
    "10m"
  ),
  "native-identity-receipt-inputs": check(
    "Diagnostic-only authorizations protect existing authored sources and configuration without generated inputs.",
    "node --test --test-name-pattern='identity-only authorization cannot license source or configuration changes' docs/tools/diagnostic-identity.test.mjs",
    [],
    [node],
    "2m"
  ),
  "parser-error-registration-members": goVibelang(
    "Error parser snapshots retain generated matcher registration and every authored class member.",
    `CGO_ENABLED=0 go test -p 8 -count=1 -trimpath -timeout=5m ./internal/parser && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 ${effect} go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestErrorRegistrationMembersQuoted|FuzzErrorRegistrationMembers)$'`,
    [Tsc["vibelangfuzz-files"]],
    "10m"
  ),
  
  "mapper-error-registration-members": goVibelang(
    "Generated error registration retains source members and native projection types",
    "VIBELANG_MAPPER_TEST_TSC=$PWD/../built/local/tsc VIBELANG_MAPPER_TEST_MAPPER=$PWD/../built/local/vibelang-mapper EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -trimpath -v -short -p 8 -count=1 -timeout=5m -run \"^(TestPlainErrorRegistrationKeepsNativeStaticBlock|TestErrorPayloadCommaStockProjection|TestErrorExtractorSubjectReads|TestThrowCauseRuntime)$\" ./internal/vibelangmapper && VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -trimpath -v -short -p 8 -count=1 -timeout=10m -run \"^(TestMapperErrorRegistrationMembersQuoted|FuzzMapperErrorRegistrationMembers)$\" ./internal/vibelangfuzz",
    [Typescript.compiler, Typescript.mapper],
    "20m"
  ),
  "layer-repair-service-receivers": goVibelang(
    "Explicit layer service lookup retains comments and evaluation order",
    "VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -trimpath -short -p 8 -count=1 -timeout=5m -run \"^FuzzServiceRunHead$/layer-repair-read-\" ./internal/vibelangfuzz",
    [],
    "15m"
  ),
  "grouped-schema-inheritance-controls": goVibelang(
    "Grouped field documentation retains independent inheritance diagnostics",
    "VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -trimpath -short -p 8 -count=1 -timeout=10m -run \"^(TestGroupedSchemaInheritanceControlsQuoted)$\" ./internal/vibelangfuzz",
    [],
    "20m"
  ),
  "schema-codec-native-return-inference": goVibelang(
    "Schema codec documentation retains native return inference",
    "EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -trimpath -short -p 8 -count=1 -timeout=10m -run \"^(TestSchemaFactoryMigrationReturnsQuoted)$\" ./internal/vibelang ./internal/vibelangfuzz",
    [],
    "15m"
  ),
  
  "explicit-diagnostic-category-variants": goVibelang(
    "Throw syntax errors retain their fixed category and host compatibility retains contextual warnings",
    "EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -trimpath -short -p 8 -count=1 -timeout=3m -run \"^(TestPlatformContextualSeverityQuoted|TestPlatformContextualRegistryCategories|FuzzExplicitDiagnosticCategoryVariants)$\" ./internal/vibelangfuzz",
    [],
    "15m"
  ),
  "unique-diagnostic-authorizations": check(
    "Diagnostic authorizations retain one unambiguous record per source identity",
    "node --test --test-name-pattern='retirement authorization keys are unique' docs/tools/diagnostic-identity.test.mjs",
    [],
    [node],
    "2m"
  ),
  "syntax-error-matcher-registration": goVibelang(
    "Error matcher registrations survive parser and printer round trips",
    "EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -trimpath -short -p 8 -count=1 -timeout=3m -run \"^(TestSyntaxRoundTripGoldens|FuzzVibeLangParsePrint)$\" ./internal/vibelang",
    [],
    "5m"
  ),
  "continuation-contract-retirement": check(
    "First-release continuation retirement supersedes legacy provider contracts without affecting native namesakes.",
    "cd typescript/tsc && CGO_ENABLED=0 go test -v -p 8 -count=1 -trimpath -timeout=5m ./internal/vibelang -run '^TestCompatibilityIdentityPrimaryMessages$' && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestRelicControlRejectionQuoted|FuzzRelicControlRejection)$' && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^FuzzCompile$/^appendix-ek9210-complete-project$' && cd ../.. && node --test docs/tools/diagnostic-identity.test.mjs",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go,node,bun],
    "12m"
  ),
  
  "resolved-fuzz-gap-regressions": goVibelang(
    "Enforce native module and execution cases that now meet their specification",
    "VIBELANG_FUZZ_REQUIRE=1 VIBELANG_FUZZ_HANG=120s EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -trimpath -short -p 8 -count=1 -timeout=15m -run \"^(TestVibexDeclarationSpellingQuoted|TestVibexDeclarationSpecifierGuard|TestVibexGeneratedContractIdentity|FuzzNativeCrossVariantResolution|FuzzReviewExecutionDiagnostics|FuzzTryGroupedEffects|FuzzVibexDeclarationSpelling|FuzzVibexNativeParity)$\" ./internal/vibelangfuzz",
    [],
    "20m"
  ),
  "inherited-error-constructor-arity": goVibelang(
    "Rejected inheritance hides generated arity failures while preserving authored argument errors",
    "EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -trimpath -short -p 8 -count=1 -timeout=10m -run \"^(TestInheritedErrorArityQuoted|TestInheritedErrorGeneratedArity|FuzzInheritedErrorConstructorArity)$\" ./internal/vibelangfuzz",
    [],
    "15m"
  ),
  
  "diagnostic-example-source-locations": check(
    "Published JSON and provider examples identify their complete source diagnostics",
    "EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node docs/tools/diagnostic-example-locations.mjs EK4818 EK3101 && node --test docs/tools/diagnostic-archive-examples.test.mjs",
    [Packages["compiler-native"], Packages["runtime-dist"]],
    [node],
    "3m"
  ),
  "error-constructor-diagnostic-retirement": goVibelang(
    "Inherited error declarations retain the canonical rejection across native constructor shapes",
    "EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -trimpath -short -p 8 -count=1 -timeout=10m -run \"^(TestErrorConstructorDiagnosticRetired|TestErrorConstructorRetirementQuoted|FuzzErrorConstructorDiagnosticRetirement)$\" ./internal/vibelang ./internal/vibelangfuzz",
    [],
    "15m"
  ),
  "filtered-bundler-entry-cleanup": check(
    "A filtered entry run cleans up only projects its setup created.",
    "node --test --test-name-pattern='^no selected entry fixture$' packages/unplugin/test/entry.test.mjs",
    [],
    [node],
    "1m"
  ),
  "anonymous-cycle-parity": goVibelang(
    "Anonymous recursive declarations match the approved stock baseline and preserve all other native checks.",
    `CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 ${effect} go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestRecursiveInferredDeclarationsQuoted|TestCycleBaselineControls|FuzzRecursiveDeclarationParity)$'`,
    [Tsc["vibelangfuzz-files"]],
    "15m"
  ),
  "bundler-service-receivers": check(
    "Bundled service programs use explicit lookups and retain native member diagnostics and requirements.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestServiceRunHeadQuoted|FuzzServiceRunHead)$' && cd ../.. && VIBELANG_BINARY=$PWD/packages/compiler/native/vibelang sh packages/unplugin/test/run.sh --test-name-pattern='esbuild: builds the fixture, runs it, and maps it to .vibe sources'",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"]],
    [go, node, bun],
    "15m"
  ),
  "module-implicit-run-retirement": goVibelang(
    "Module and class calls retain cold Effect values and native type errors without retired execution diagnostics.",
    `CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 ${effect} go test -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelang ./internal/vibelangmapper ./internal/vibelangfuzz -run '^(TestModuleRunDiagnosticRetired|TestCatchExpressionOutsideEffect|TestThrowOutsideEffectCodeIsEK0401|TestPlainRunnerCallbackBoundaries|TestModuleColdCallTypesQuoted|TestRegistryDebtWitnessIdentity|FuzzModuleColdCallTypes|TestCatchBoundaryIdentityQuoted|FuzzCatchBoundaryIdentity)$' && cd ../.. && node --test --test-name-pattern='^retired implicit module execution has no active identity$' docs/tools/diagnostic-identity.test.mjs`,
    [Tsc["vibelangfuzz-files"]],
    "15m"
  ),
  "native-and-legacy-catch-bindings": goVibelang(
    "Plain catch bindings retain native behavior while existing legacy diagnostic witnesses keep their exact locations.",
    `CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 ${effect} go test -trimpath -v -short -p 8 -count=1 -timeout=10m -run '^(TestCatchBindingAnnotationKindsQuoted|TestNativeAnyCatchBindingTwin|FuzzCatchBindingAnnotationKinds)$' ./internal/vibelangfuzz && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node docs/tools/diagnostic-example-locations.mjs EK2105 EK2112`,
    [Tsc["vibelangfuzz-files"], Packages["compiler-native"]],
    "15m"
  ),
  "trusted-class-visibility-witness": goVibelang(
    "Compatibility diagnostics replay real private and exported failure classes",
    "VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -trimpath -v -short -p 8 -count=1 -timeout=8m -run \"^(TestTrustedClassVisibilityWitnessQuoted|FuzzTrustedClassVisibilityWitness)$\" ./internal/vibelangfuzz && cd ../.. && node docs/tools/diagnostic-example-locations.mjs EK4401",
    [Packages["compiler-native"]],
    "15m"
  ),
  "tagged-match-repair-goldens": goVibelang(
    "Native match handlers retain their diagnostic and declaration contracts",
    "EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -trimpath -short -p 8 -count=1 -timeout=10m -run \"^(TestMatchHandlerDestructureQuoted|TestMatchCombinatorCoverageQuoted|FuzzMatchCombinatorCoverage)$\" ./internal/vibelangfuzz",
    [],
    "25m"
  ),
  "loader-sidecar-project-roots": check(
    "Private loader emission retains native declaration layouts and source maps",
    "cd typescript/tsc && GOCACHE=$HOME/.cache/go-build-smthrs CGO_ENABLED=0 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -trimpath -short -p 8 -count=1 -timeout=5m -run \"^TestProjectEmitArguments$\" ./internal/vibelang && cd ../.. && VIBELANG_BINARY=$PWD/packages/compiler/native/vibelang EFFECT_NODE_MODULES=$PWD/experiments/node_modules node --test --test-name-pattern='project emission preserves configured sidecar roots' packages/compiler/test/project.test.mjs && VIBELANG_BINARY=$PWD/packages/compiler/native/vibelang sh packages/unplugin/test/run.sh --test-name-pattern='embedded esbuild resolves VibeLang modules with sidecarDir'",
    [Packages["compiler-native"],Packages["runtime-dist"]],
    [go, node],
    "20m"
  ),
  
  
  "binding-free-pattern-cache-scopes": goVibelang(
    "Binding-free iterable tests retain type-checking scope and iterator cleanup",
    "VIBELANG_MAPPER_TEST_TSC=$PWD/../built/local/tsc VIBELANG_MAPPER_TEST_MAPPER=$PWD/../built/local/vibelang-mapper EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -trimpath -v -short -p 8 -count=1 -timeout=5m -run \"^TestBindingFreePatternIteratorCleanup$\" ./internal/vibelangmapper && VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -trimpath -v -short -p 8 -count=1 -timeout=8m -run \"^(TestBindingFreePatternCacheQuoted|FuzzBindingFreePatternCache)$\" ./internal/vibelangfuzz",
    [Typescript.compiler, Typescript.mapper],
    "20m"
  ),
  "effect-parameter-nothrow-diagnostics": goVibelang(
    "Effect parameter initialization reports one precise no-throw diagnostic per call",
    "VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -trimpath -v -short -p 8 -count=1 -timeout=10m -run \"^(TestEffectParameterDiagnosticOwnershipQuoted|FuzzEffectParameterDiagnosticOwnership|TestNothrowPlacementQuoted|FuzzNothrowPlacement)$\" ./internal/vibelangfuzz",
    [],
    "20m"
  ),
  "migration-style-severity-controls": check(
    "Migration style verification retains warning provenance and rejects promoted errors",
    "node --test packages/compiler/test/diagnostics.property.test.mjs .smithers/flows/migrate/test/diagnostics.test.mjs",
    [],
    [node],
    "2m"
  ),
  "vite-service-coverage": check(
    "Coverage preserves authored functions, statements and branches through explicit service lookup",
    "cd typescript/tsc && VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -trimpath -short -p 8 -count=1 -timeout=5m -run \"^FuzzServiceRunHead$/vite-coverage-find-\" ./internal/vibelangfuzz && cd ../.. && VIBELANG_BINARY=$PWD/packages/compiler/native/vibelang EFFECT_NODE_MODULES=$PWD/experiments/node_modules sh packages/vite/test/run.sh --test-name-pattern='coverage'",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "15m"
  ),
  
  "service-member-diagnostic-ownership": goVibelang(
    "Each rejected service member reports once while generic, key and independent native errors remain",
    "EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -trimpath -v -short -p 8 -count=1 -timeout=5m -run '^(TestServiceGeneric.*|TestServiceKey.*|TestWholeServiceNameless.*)$' ./internal/vibelang && VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -trimpath -v -short -p 8 -count=1 -timeout=5m -run '^(TestService(Generic|Key)RecoveryQuoted|FuzzService(Generic|Key)WithRejectedMembers)$' ./internal/vibelangfuzz",
    [],
    "15m"
  ),
  
  
  
  "legacy-directive-category-controls": goVibelang(
    "Legacy source directives retain exact per-code categories and default-off controls",
    "VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -trimpath -v -short -p 8 -count=1 -timeout=5m -run '^FuzzSplice$/registry-EK4818$' ./internal/vibelangfuzz && VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -trimpath -v -short -p 8 -count=1 -timeout=10m -run '^(TestLegacyDirectiveCategoryQuoted|FuzzLegacyDirectiveCategories|TestCurrentDiagnosticPolicyRegression|TestDiagnosticSeverityScopeRegression)$' ./internal/vibelangfuzz",
    [],
    "20m"
  ),
  "mapper-subtype-callable-controls": goVibelang(
    "Unmarked host callback controls retain valid effect block syntax",
    "VIBELANG_MAPPER_TEST_TSC=$PWD/../built/local/tsc VIBELANG_MAPPER_TEST_MAPPER=$PWD/../built/local/vibelang-mapper EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -trimpath -v -short -p 8 -count=1 -timeout=5m -run '^TestSubtypeReturnHostBoundaryWrittenKind$' ./internal/vibelangmapper && VIBELANG_MAPPER_TEST_TSC=$PWD/../built/local/tsc VIBELANG_MAPPER_TEST_MAPPER=$PWD/../built/local/vibelang-mapper EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -trimpath -v -short -p 8 -count=1 -timeout=5m -run '^TestMapperFollowupRuntimeCases$/effect-subtype-returns$' ./internal/vibelangmapper",
    [Typescript.compiler, Typescript.mapper],
    "20m"
  ),
  "mapper-catch-declaration-imports": goVibelang(
    "Catch declarations retain exact channels through resolved native Effect namespace aliases",
    "VIBELANG_MAPPER_TEST_TSC=$PWD/../built/local/tsc VIBELANG_MAPPER_TEST_MAPPER=$PWD/../built/local/vibelang-mapper EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -trimpath -v -short -p 8 -count=1 -timeout=5m -run '^(TestCatchTag.*Stock|FuzzCatchDeclarationNamespaceAliases)$' ./internal/vibelangmapper",
    [Typescript.compiler, Typescript.mapper],
    "15m"
  ),
  "migration-metadata-comment-twins": check(
    "Native counterparts preserve narrowed values and parameter bindings",
    "cd typescript/tsc && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --isolated --verbose opencode-narrowed-property-call-fixed hatch-parameter-cell-fixed",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "25m"
  ),
  "mapper-explicit-catch-owner-controls": goVibelang(
    "Catch fixture owners are explicit and ordinary callbacks retain their boundary errors",
    "VIBELANG_MAPPER_TEST_TSC=$PWD/../built/local/tsc VIBELANG_MAPPER_TEST_MAPPER=$PWD/../built/local/vibelang-mapper EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -trimpath -v -short -p 8 -count=1 -timeout=5m -run '^(TestCatchExpressionHatch|TestPipeTopicChoices|TestEmit)$' ./internal/vibelangmapper && VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -trimpath -v -short -p 8 -count=1 -timeout=10m -run '^(TestMapperCatchFixtureOwnersQuoted|FuzzMapperCatchFixtureOwners|TestCatchBoundaryIdentityQuoted|FuzzCatchBoundaryIdentity)$' ./internal/vibelangfuzz",
    [Typescript.compiler, Typescript.mapper],
    "20m"
  ),
  "mapper-prelude-runtime-helpers": goVibelang(
    "Checking projections expose the runtime iterable cache with its exact type",
    "VIBELANG_MAPPER_TEST_TSC=$PWD/../built/local/tsc VIBELANG_MAPPER_TEST_MAPPER=$PWD/../built/local/vibelang-mapper EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -trimpath -v -short -p 8 -count=1 -timeout=5m -run \"^(TestCatchTagNonSingletonStock|TestIterablePatternCacheBodyProjection|TestIterablePatternCacheBodyRuntime)$\" ./internal/vibelangmapper && VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -trimpath -v -short -p 8 -count=1 -timeout=8m -run \"^(TestMapperPreludeRuntimeHelpersQuoted|FuzzMapperPreludeRuntimeHelpers)$\" ./internal/vibelangfuzz",
    [Typescript.compiler, Typescript.mapper],
    "20m"
  ),
  
  "mapper-effect-block-source-ownership": goVibelang(
    "Explicit effect blocks retain their program form and source catch boundary through keyword blanking",
    "VIBELANG_MAPPER_TEST_TSC=$PWD/../built/local/tsc VIBELANG_MAPPER_TEST_MAPPER=$PWD/../built/local/vibelang-mapper EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -trimpath -v -short -p 8 -count=1 -timeout=5m -run '^(TestEffectBlock(Source|Runtime)Ownership|TestResolver.*)$' ./internal/vibelangmapper && VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -trimpath -v -short -p 8 -count=1 -timeout=5m -run '^(TestEffectBlockSourceOwnershipQuoted|FuzzEffectBlockSourceOwnership)$' ./internal/vibelangfuzz",
    [Typescript.compiler, Typescript.mapper],
    "20m"
  ),
  "catch-completion-declaration-surface": check(
    "Nested catch fixtures preserve literal returns and exclude invented normal completions",
    "cd typescript/tsc && VIBELANG_MAPPER_TEST_TSC=$PWD/../built/local/tsc VIBELANG_MAPPER_TEST_MAPPER=$PWD/../built/local/vibelang-mapper EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -trimpath -v -short -p 8 -count=1 -timeout=5m -run '^TestCatchDeclarationGoldens$' ./internal/vibelangmapper && VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -trimpath -v -short -p 8 -count=1 -timeout=8m -run '^(TestCatchCompletionDeclarationsQuoted|FuzzCatchCompletionDeclarations)$' ./internal/vibelangfuzz && cd .. && EFFECT_NODE_MODULES=$PWD/../experiments/node_modules VIBELANG_RUNTIME=$PWD/../packages/runtime node vibelang/harness.mjs --isolated --verbose decl-catch",
    [Typescript.compiler, Typescript.mapper, Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"]],
    [go, node, bun],
    "20m"
  ),
  "native-using-advisories": goVibelang(
    "Native disposal errors coexist with every configured Effect using advisory.",
    `CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 ${effect} go test -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestEffectUsingWarningQuoted|FuzzEffectUsingWarning)$'`,
    [Tsc["vibelangfuzz-files"]],
    "10m"
  ),
  "optional-foreign-contracts": check(
    "Optional calls preserve receiver and evaluation semantics with explicit foreign callback contracts.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestOptionalForeignCallbacksQuoted|FuzzOptionalForeignCallbacks)$' && CGO_ENABLED=0 go vet -p 8 -trimpath ./internal/vibelangfuzz && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --isolated --verbose optional-effect-calls optional-effect-semantics",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "native-inferred-declarations": check(
    "Inferred native import spellings follow stock TypeScript across suffix, quote and directory variations.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestWrittenSourceDeclarationSpellingsQuoted|FuzzWrittenSourceDeclarationSpellings)$' && CGO_ENABLED=0 go vet -p 8 -trimpath ./internal/vibelangfuzz && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --isolated --verbose native-inferred-import-spelling",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "pipe-topic-regressions": check(
    "Implemented direct and nested missing-topic errors run as ordinary regression cases.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestPipeTopicEarlyErrorQuoted|FuzzPipeTopicEarlyError)$' && CGO_ENABLED=0 go vet -p 8 -trimpath ./internal/vibelangfuzz && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --isolated --verbose cov-ch002b-running-pipe-missing-topic-absent.fail cov-ch002b-running-pipe-missing-topic-nested.fail",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "declaration-manifest-retirement": check(
    "Declaration builds retain their complete file sets and runtime behavior without retired provenance manifests.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestPackageFileSetQuoted|FuzzPackageFileSet)$' && CGO_ENABLED=0 go test -v -p 8 -count=1 -trimpath -timeout=5m ./internal/vibelang -run '^TestPackageEmitHasNoManifest$' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --isolated --verbose written-forms",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Tsc["vibelang-files"], Vibelang.tree],
    [go, node, bun],
    "15m"
  ),
  "docs-import-meta-relocation": S.Shell.Test({
    summary: "Platform guides distinguish entry filenames from shared sibling directories.",
    shell: "node docs/tools/import-meta-relocation-docs.mjs && node --test docs/tools/import-meta-relocation-docs.test.mjs",
    data: S.glob([
      "docs/tools/import-meta-relocation-docs.mjs", "docs/tools/import-meta-relocation-docs.test.mjs",
      "docs/tools/package.json", "docs/tools/bun.lock",
      "docs/user/src/platform/105-introduction.md", "docs/user/src/platform/platform-globals.md"
    ]),
    tools: [node], sandbox: "none", timeout: "2m"
  }),
  "docs-contracts": S.Shell.Test({
    summary: "Published documentation contracts and their native counterparts remain consistent.",
    shell: "node --test --test-concurrency=2 docs/tools/spec-colon-leads.test.mjs docs/tools/spec-catch-pipe-input.test.mjs docs/tools/spec-sidecar-roots.test.mjs docs/tools/spec-ts-custom-matcher.test.mjs docs/tools/spec-schema-jsdoc.test.mjs docs/tools/spec-direct-try-advisories.test.mjs docs/tools/spec-sidecar-input-protection.test.mjs docs/tools/spec-sidecar-final-path.test.mjs docs/tools/spec-async-throws.test.mjs docs/tools/spec-constructor-static-contract.test.mjs docs/tools/spec-generator-call-phase.test.mjs docs/tools/spec-handler-initialization.test.mjs docs/tools/spec-callable-contracts.test.mjs docs/tools/spec-contracts-overload.test.mjs docs/tools/spec-throw-contracts.test.mjs docs/tools/vip34-diagnostic-ownership.test.mjs docs/tools/spec-legacy-effect-alias-transition.test.mjs docs/tools/spec-builtins-contracts.test.mjs docs/tools/spec-foreign-call-contract.test.mjs docs/tools/spec-r16-carried.test.mjs docs/tools/spec-is-statement-body-home.test.mjs docs/tools/spec-is-limit-catch-homes.test.mjs docs/tools/relative-url-docs.test.mjs && node docs/tools/relative-url-docs.mjs && node --test --test-name-pattern='^Appendix B' docs/tools/spec-nothrow.test.mjs && bun test --timeout 30000 docs/tools/public-proposal-overview.test.ts",
    data: S.glob([
      "docs/design/src/**", "docs/design/vips/**", "docs/user/src/**",
      "docs/tools/package.json", "docs/tools/bun.lock", "docs/tools/spec-witness.mjs",
      "docs/tools/spec-sidecar-roots.mjs", "docs/tools/spec-ts-custom-matcher.test.mjs",
      "scripts/api-identity*.mjs", "typescript/vibelang/test/cov-ch004-twin.mjs", "docs/tools/spec-colon-leads.test.mjs",
      "docs/tools/spec-catch-pipe-input.test.mjs", "docs/tools/spec-sidecar-roots.test.mjs",
      "docs/tools/spec-schema-jsdoc.test.mjs", "docs/tools/spec-direct-try-advisories.test.mjs",
      "docs/tools/spec-sidecar-input-protection.test.mjs",
      "docs/tools/fixtures/**", "scripts/testing/spec-path.mjs", "packages/compiler/eslint.mjs",
      "docs/tools/spec-sidecar-final-path.test.mjs",
      "docs/tools/spec-async-throws.test.mjs",
      "docs/tools/spec-constructor-static-contract.test.mjs",
      "docs/tools/spec-generator-call-phase.test.mjs",
      "docs/tools/spec-handler-initialization.test.mjs",
      "docs/tools/spec-callable-contracts.test.mjs",
      "docs/tools/spec-contracts-overload.test.mjs",
      "docs/tools/spec-throw-contracts.test.mjs",
      "docs/tools/vip34-diagnostic-ownership.test.mjs",
      "docs/tools/spec-legacy-effect-alias-transition.test.mjs",
      "docs/tools/spec-builtins-contracts.test.mjs",
      "docs/tools/spec-foreign-call-contract.test.mjs",
      "docs/tools/spec-foreign-call-contract.mjs",
      "packages/compiler/skills/vibelang/SKILL.md",
      "docs/tools/spec-nothrow.test.mjs",
      "docs/tools/spec-r16-carried.test.mjs",
      "docs/tools/spec-is-statement-body-home.test.mjs",
      "docs/tools/spec-is-limit-catch-homes.test.mjs",
      "docs/tools/relative-url-docs.mjs", "docs/tools/relative-url-docs.test.mjs",
      "docs/tools/public-proposal-overview.test.ts", "site/scripts/proposal-overview.test.mjs", "site/src/pages/vips/index.mdx",
      ".smithers/flows/migrate/README.md"
    ]),
    tools: [bun, node],
    sandbox: "none",
    timeout: "5m"
  }),
  "docs-experimental-service-calls": check(
    "Experimental service references use implementations and run Effect-valued members directly.",
    "node docs/tools/experimental-service-calls.mjs && bun test --timeout 30000 docs/tools/experimental-service-calls.test.ts",
    [],
    [bun, node]
  ),
  "docs-vite-debug": check(
    "Project invalidation diagnostics follow the documented Vite debug contract.",
    "node --test --test-timeout=60000 packages/compiler/test/project-debug.test.mjs",
    [],
    [node]
  ),
  "docs-warning-exit": check(
    "Warning-only build advice distinguishes imported Effect diagnostics from own warnings and standalone lint.",
    "node docs/tools/warning-exit-claims.mjs && bun test --timeout 60000 docs/tools/warning-exit-claims.test.ts",
    [],
    [bun, node]
  ),
  "docs-editor-migration": check(
    "Current editor guides keep retired service errors distinct from control-class migration warnings.",
    "bun docs/tools/check-diagnostic-docs.ts && bun test --timeout 60000 docs/tools/editor-migration-diagnostics.test.ts docs/tools/check-diagnostic-docs.test.ts",
    [],
    [bun]
  ),
  "docs-foreign-call-diagnostics": check(
    "Foreign-call guidance keeps the failures chapter's current diagnostic distinct from legacy listed-class errors.",
    "bun test --timeout 60000 docs/tools/foreign-call-diagnostics.test.ts",
    [],
    [bun]
  ),
  "docs-shim-availability": check(
    "The TypeScript replacement guides distinguish prepared source versions from recorded npm availability and match proposal status and checker API requirements.",
    "node docs/tools/shim-availability.mjs && bun test --timeout 60000 docs/tools/shim-availability.test.ts docs/tools/checker-version-claims.test.ts docs/tools/shim-preparation.test.ts",
    [],
    [bun, node]
  ),
  "docs-table-rows": check(
    "User tables retain headers and widths; platform advice qualifies queries, argument lists, byte reads and elapsed time.",
    "node docs/tools/table-rows.mjs && bun test --timeout 30000 docs/tools/user-table-rows.test.ts docs/tools/spec-table-rows.test.mjs",
    [],
    [bun, node]
  ),
  "docs-service-shape-scopes": check(
    "Service advice limits a whole-shape alias to its declaration body and names external implementation types.",
    "node docs/tools/service-shape-scopes.mjs && bun test --timeout 30000 docs/tools/service-shape-scopes.test.ts docs/tools/spec-local-service-shape.test.mjs",
    [],
    [bun, node]
  ),
  "docs-pnpm-install-pins": check(
    "pnpm installation examples keep the transitive Effect pin in the workspace configuration.",
    "bun docs/tools/pnpm-install-pins.mjs && bun test --timeout 30000 docs/tools/pnpm-install-pins.test.ts",
    [],
    [bun]
  ),
  "docs-yarn-install-pins": check(
    "Yarn setup routes keep the transitive Effect pin in root package resolutions.",
    "bun docs/tools/yarn-install-pins.mjs && bun test --timeout 30000 docs/tools/yarn-install-pins.test.ts",
    [],
    [bun]
  ),
  "docs-bun-install-pins": check(
    "Bun installation examples preserve the project's active dependency pin table.",
    "bun docs/tools/bun-install-pins.mjs && bun test --timeout 30000 docs/tools/bun-install-pins.test.ts",
    [],
    [bun]
  ),
  "docs-release-upgrade-commands": check(
    "Current release upgrade instructions use supported compiler commands.",
    "node docs/tools/release-upgrade-commands.mjs && node --test docs/tools/release-upgrade-commands.test.mjs",
    [],
    [node]
  ),
  "docs-tools": check(
    "docs/tools' bun tests, with cached specification links and linters and without site contrast.",
    "cd docs/tools && bun test --only-failures --timeout 60000 --parallel=3 --no-isolate $(ls *.test.* | grep -vE '^(site-(contrast|spec-links)|spec-lint)\\.test\\.')",
    [Typescript.compiler, Typescript["forms-generator"], Packages["runtime-dist"], Packages["compiler-native"], siteSpecLinks, specLint],
    [bun, node, S.Host.bin("jj")]
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
  "docs-check": check("Generated docs, tracked-leak and case-collision checks.", "cd .smithers && bun run docs:check", [], [bun, node, gofmt]),
  // The compiler corpus runs as `//typescript/vibelang/...`, one cached target
  // per case, through the binary users run.
  ...Object.fromEntries(goVibelangBinaries.map(({ target }, index) => [`go-vibelang-compile-${index + 1}`, target])),
  ...goVibelangShards,
  "go-vibelang": S.Suite({ tests: Object.values(goVibelangShards) }),
  "go-vibelang-race": goVibelang(
    "Parallel declaration emit under the race detector.",
    "CGO_ENABLED=1 go test -race -count=1 -trimpath -run TestDeclarationEmitInParallel ./internal/vibelang/",
    [Tsc["vibelang-files"]]
  ),
  // The tests' scope takes the graph's compiler and mapper executables instead
  // of linking both, and a third mapper copy, per test binary (scope_test.go).
  "go-vibelangmapper": goVibelang(
    "Go tests of internal/vibelangmapper.",
    `CGO_ENABLED=0 ${effect} VIBELANG_MAPPER_TEST_TSC=$PWD/../built/local/tsc ` +
      "VIBELANG_MAPPER_TEST_MAPPER=$PWD/../built/local/vibelang-mapper " +
      "node ../../scripts/go-test-progress.mjs go test -json -count=1 -p 8 -timeout 25m -trimpath ./internal/vibelangmapper/...",
    [Tsc["vibelangmapper-files"], Typescript.compiler, Typescript.mapper, S.file("//scripts/go-test-progress.mjs")]
  ),
  // The merge gate runs it with the compiler step, where //:go-vibelangfuzz
  // runs only post-merge: a fix that makes a pending input pass without
  // deleting its line fails before it lands, not on main (four times on
  // 2026-10-30).
  "go-vibelangfuzz-pending": goVibelang(
    "The inputs testdata/pending/ lists still fail, and every probe passes or is pending: a change that makes one pass deletes its line.",
    `CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 VIBELANG_FUZZ_HANG=120s ${effect} sh internal/vibelangfuzz/pending.sh`,
    [Tsc["vibelangfuzz-files"], pendingHangs, Packages["compiler-native"], migrationSources],
    "10m",
    fuzzBudgetEnv
  ),
  // The merge gate runs it for a change to the documentation or a case, which
  // seed its sample, where //:go-vibelangfuzz runs only post-merge: an example
  // the editor cannot answer for fails before it lands, not on main
  // (d2f2bc108caf on 2026-10-30). Marking a known gap takes a compiler-gap
  // pending line, as testdata/pending/tools.txt shows.
  "go-vibelangfuzz-editor": goVibelang(
    "The editor oracles over their short sample of documentation examples and cases.",
    `CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 VIBELANG_FUZZ_HANG=120s ${effect} ` +
      "go test -short -count=1 -timeout=8m -trimpath -run '^(TestConsistencyRenameCollision.*|FuzzEditorRenameCollisionDiagnostics|FuzzEditor|FuzzEditorConsistency|FuzzEffectArrowHeads|FuzzAsyncReturnAdoption|FuzzAsyncRefactorBridges)$' ./internal/vibelangfuzz/",
    [Tsc["vibelangfuzz-files"]],
    "10m",
    fuzzBudgetEnv
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
      "go test -short -count=1 -timeout=8m -trimpath -run '^FuzzCompile$' ./internal/vibelangfuzz/",
    [Tsc["vibelangfuzz-files"]],
    "10m",
    fuzzBudgetEnv
  ),
  // The merge gate runs it for a change to a case, the specification, the
  // fuzz oracles or the compiler's project settings: each case's vibelang
  // section seeds FuzzConfig, where //:go-vibelangfuzz runs only post-merge.
  // The cases 04db4f250ebf added seeded vibelang.declarationImportStyle,
  // which the oracle did not yet know, and 19f055973410 went RED post-merge.
  "go-vibelangfuzz-config": goVibelang(
    "The project-settings oracles over every case's vibelang section and the settings the specification lists.",
    `CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 VIBELANG_FUZZ_HANG=120s ${effect} ` +
      "go test -short -count=1 -timeout=8m -trimpath -run '^FuzzConfig$' ./internal/vibelangfuzz/",
    [Tsc["vibelangfuzz-files"]],
    "10m",
    fuzzBudgetEnv
  ),
  // Keep the original public label as a group of all independent checks.
  "go-vibelangfuzz": S.Suite({ tests: Object.values(fuzzShardTargets) }),
  // The registry test alone, for spec-push (~/vibe/mq/mq.py SPEC_LINT_TARGETS; fix-main-red 2026-11-03): spec-direct
  // commits gave Appendix B 15 codes the registry lacked, and only post-merge's //:spec-tests saw it. spec-push
  // tolerates a target main carries red, so a target of one test still blocks while //:spec-tests is red for others.
  // The --fix fixed twins and cost guards, for the merge gate (validate.sh selects it for a non-test source change
  // in the parser, internal/vibelang or internal/effectglobals; fix-main-red 2026-11-03). VIP-6's 77843b2ee56b, a
  // parser and prelude change, made 3f57b5b4694e's prelude pass rewrite every Effect.x call to its bare global:
  // the tsforms and migrate fixed twins changed again on a second --fix run and TestFixGateChecksAFewTimes built
  // more programs than its bound, and only post-merge's //:go-vibelang and //:spec-tests saw it.
  "go-failure-aliases": goVibelang(
    "Failure aliases retain their declaration-site tags without admitting ordinary throwing calls.",
    `CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 VIBELANG_FUZZ_HANG=120s ${effect} go test -p 8 -count=1 -timeout 5m -trimpath -run '^(TestFailuresSpec|FuzzFailuresSpec)$/^(alias-declaration-tag-not-admitted|foreign-alias-tag-.*)$' ./internal/vibelangfuzz/`,
    [Tsc["vibelangfuzz-files"]],
    "10m"
  ),
  "go-generator-return-contracts": goVibelang(
    "Generator result-contract documentation retains its native forms.",
    `CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 VIBELANG_FUZZ_HANG=120s ${effect} go test -p 8 -short -count=1 -timeout 10m -trimpath -run '^(TestEffectFnBareReturnContracts|TestEffectFnBareReturnContractsQuoted)$' ./internal/vibelang/ ./internal/vibelangfuzz/`,
    [Tsc["vibelang-files"], Tsc["vibelangfuzz-files"]],
    "15m"
  ),
  "go-registry-witnesses": goVibelang(
    "Compatibility witnesses retain their current identities, and module calls keep cold Effect types.",
    `CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 VIBELANG_FUZZ_HANG=120s ${effect} go test -p 8 -short -count=1 -timeout 5m -trimpath -run '^(TestRegistryDebtWitnessIdentity|TestModuleColdCallTypesQuoted|FuzzModuleColdCallTypes)$' ./internal/vibelangfuzz/`,
    [Tsc["vibelangfuzz-files"]],
    "10m"
  ),
  "go-foreign-validation": goVibelang(
    "Foreign validation callbacks cross an explicit defect bridge without weakening their no-throw parameter checks.",
    `CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 VIBELANG_FUZZ_HANG=120s ${effect} go test -p 8 -short -count=1 -timeout 5m -trimpath -run '^(TestForeignValidationCasesCompile|TestForeignValidationBridgesQuoted|FuzzForeignValidationBridges)$' ./internal/vibelangfuzz/`,
    [Tsc["vibelangfuzz-files"], Vibelang.tree],
    "10m"
  ),
  "http-api-example": check(
    "The HTTP example adapts the Node server callback and keeps request handling correct.",
    "node scripts/check-http-api.mjs",
    [Packages["compiler-native"], Packages["runtime-dist"]],
    [node, bun],
    "5m",
    {},
    [S.Filegroup({srcs: [...S.glob(["examples/http-api/**", "scripts/check-http-api.mjs", "scripts/prepare-examples.mjs", "scripts/template-files.mjs", "packages/vite/**", "packages/compiler/package.json"])]})]
  ),
  "go-module-foreign-factories": goVibelang(
    "TypeScript module factories retain foreign callback contracts without eager acquisition.",
    `CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 VIBELANG_FUZZ_HANG=120s ${effect} go test -p 8 -short -count=1 -timeout 5m -trimpath -run '^(TestModuleForeignFactoriesQuoted|TestModuleForeignFactoryCase|FuzzModuleForeignFactories)$' ./internal/vibelangfuzz/`,
    [Tsc["vibelangfuzz-files"], Vibelang.tree],
    "10m"
  ),
  "go-effect-parameter-contracts": goVibelang(
    "Declared Effect parameters keep their native contract while nested root Promise calls retain both independent diagnostics.",
    `CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 ${effect} go test -p 8 -short -count=1 -timeout 5m -trimpath -run '^(TestDeclaredRootPromiseRulesQuoted|TestDeclaredRootPromiseCompanionScope|TestEffectExportedParameters|FuzzDeclaredEffectParameter)$' ./internal/vibelangfuzz/`,
    [Tsc["vibelangfuzz-files"]],
    "10m"
  ),
  "declaration-contract-twins": check(
    "Stock declaration twins preserve types and authored documentation under generated never contracts.",
    "node --test typescript/vibelang/cov-ch004-twin.test.mjs && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --isolated --verbose conditional-record-environment declaration-output-async-contracts declaration-throws-contract vibex-census-containers",
    [Packages["compiler-native"], Packages["runtime-dist"]],
    [node, bun],
    "10m",
    {},
    [Vibelang.tree, S.Filegroup({srcs: [...S.glob(["scripts/api-identity*.mjs", "docs/design/src/001-functions.md", "docs/design/vips/0027-declaration-output.md"])]})]
  ),
  "emission-snapshots": check(
    "Coverage-preserving and native tail delegation emitters keep their exact JavaScript, declarations and runtime observations.",
    "EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --isolated --verbose module-declaration-emit data-match-emit vibelang-lower vibelang-infer vibelang-concise-comments match-exhaustive-last-arm rerun-parameter-readonly try-tail-unchecked-message try-tail-native-delegation match-vip7-negation-types",
    [Packages["compiler-native"], Packages["runtime-dist"]],
    [node, bun],
    "5m",
    {},
    [Vibelang.tree, S.Filegroup({srcs: [...S.glob(["docs/design/src/001-functions.md", "docs/design/src/002-running.md", "docs/design/src/008-testing.md", "packages/runtime/package.json", "experiments/package.json", "experiments/bun.lock"])]})]
  ),
  "go-interim-severities": goVibelang(
    "Supported legacy interim overrides retain their categories without enabling modern configuration keys or hiding unrelated defaults.",
    `CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 ${effect} go test -p 8 -short -count=1 -timeout 5m -trimpath -run '^(TestInterimLegacySeveritiesQuoted|TestInterimLegacySeverityOverrides|FuzzInterimLegacySeverities|TestCompileLegacyDiagnosticOverrides|TestCompileLegacySeverityMap)$' ./internal/vibelangfuzz/ && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 ${effect} go test -p 8 -short -count=1 -timeout 5m -trimpath -run '^FuzzCompile$/^registry-EK482[1-5]$' ./internal/vibelangfuzz/`,
    [Tsc["vibelangfuzz-files"]],
    "10m"
  ),
  "appendix-oracles": check(
    "Appendix diagnostic, quick-fix and stock-TypeScript oracle controls run in the graph.",
    "EFFECT_NODE_MODULES=$PWD/experiments/node_modules node --test --test-concurrency=3 typescript/vibelang/cov900-probe.test.mjs typescript/vibelang/cov900-quickfix.test.mjs typescript/vibelang/cov900-twin.test.mjs",
    [Packages["compiler-native"], Packages["runtime-dist"]],
    [node, bun],
    "10m"
  ),
  "deep-type-repair": check(
    "Nested Effect types retain exact grouped shorthand, declarations and runtime behavior.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 VIBELANG_FUZZ_HANG=120s EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -timeout 5m -trimpath -run '^(TestEffectTypeHintParenthesesQuoted)$' ./internal/vibelangfuzz && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --isolated --verbose rewrite-deep-types",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "15m"
  ),
  "reserved-error-repair": check(
    "Reserved payload and inheritance errors stay independent while preserving exact declarations and runtime behavior.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 VIBELANG_FUZZ_HANG=120s EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -timeout 5m -trimpath -run '^(TestReservedPayloadInheritanceQuoted|FuzzReservedPayloadInheritance)$' ./internal/vibelangfuzz && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --isolated --verbose rewrite-reserved-error-payload",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "15m"
  ),
  "go-error-inheritance": goVibelang(
    "Native error inheritance and ambient classes retain diagnostics, declarations and erasure.",
    `printf 'error-contracts: compile and run inheritance and ambient repair controls
' && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 VIBELANG_FUZZ_HANG=120s ${effect} go test -v -p 8 -count=1 -timeout 5m -trimpath -run '^(TestSchemaErrorInheritance.*|TestErrorInheritanceAdmission|TestErrorInheritanceNativeClassesUnaffected|TestAmbientErrorFix.*)$' ./internal/vibelang/ ./internal/vibelangfuzz/ && printf 'error-contracts: all controls passed
'`,
    [Tsc["vibelang-files"], Tsc["vibelangfuzz-files"]],
    "15m"
  ),
  "lint-config": check(
    "Imported lint activation and config migration preserve diagnostics, exit judgment, emission, plugins and authored settings.",
    `cd typescript/tsc && GOCACHE=$HOME/.cache/go-build-smthrs CGO_ENABLED=0 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -p 8 -count=1 -trimpath -run '^(TestLintPlugin.*|TestImportedLint.*|TestLintActivationQuoted|TestRegistryMatchesSpec|FuzzLintActivation|FuzzEffectExitOptions)$' ./internal/tsoptions ./internal/vibelang ./internal/effecttsgo/lint ./internal/vibelangfuzz`,
    [],
    [go, node],
    "15m"
  ),
  "go-module-highlights": S.Shell.Test({
    summary: "Merged module names retain every reference in document highlights and rename.",
    shell: "cd typescript/tsc && GOCACHE=$HOME/.cache/go-build-smthrs CGO_ENABLED=0 go test -p 8 -count=1 -timeout 5m -trimpath -run '^(TestMergedModuleDeclarationHighlights|FuzzMergedModuleDeclarationHighlights|TestModuleDeclarationReferences|FuzzModuleDeclarationReferences|TestMergedModuleDeclarationRename|TestTypeOnlyImportModuleRename|FuzzTypeOnlyImportModuleRename)$' ./internal/ls",
    data: [Tsc.srcs, S.Filegroup({ srcs: [...S.glob(["typescript/tsc/internal/ls/**"])] })],
    tools: [go],
    sandbox: "none",
    timeout: "10m"
  }),
  "tooling-citations": S.Shell.Test({
    summary: "Native diagnostic, actionable advice and retired-setting fuzz oracles match the published tooling contracts.",
    shell: "cd typescript/tsc && GOCACHE=$HOME/.cache/go-build-smthrs CGO_ENABLED=0 go test -p 8 -count=1 -trimpath -run '^(Test(NativeServiceKeyNamespaceQuoted|ServiceShapeQualifierFallbackQuoted|PlatformYieldAdviceQuoted|RetiredConfigOptionsQuoted|OwnerSyntaxCodesQuoted)|FuzzRetiredConfigOptions)$' ./internal/vibelangfuzz/",
    data: [design, Tsc.srcs, Tsc["vibelang-files"], Tsc["vibelangfuzz-files"]] as Array<never>,
    tools: [go, node],
    sandbox: "none",
    timeout: "15m"
  }),
  "spec-diagnostic-blocks": S.Shell.Test({
    summary: "Retained diagnostic assignments have explicit exceptions and removing an exception rejects its own code.",
    shell: "node --test --test-name-pattern='retained diagnostic assignments|outside its VIP' docs/tools/spec-rules.test.mjs",
    data: [design, S.Filegroup({ srcs: [...S.glob(["docs/tools/spec-rules*.mjs", "docs/tools/spec-examples.mjs", "docs/tools/package.json", "docs/tools/bun.lock"])] })],
    tools: [node],
    sandbox: "none",
    timeout: "1m"
  }),
  "spec-example-prerequisites": S.Shell.Test({
    summary: "Active JSX examples use normal compiler outcomes and explicit prerequisites remain code-specific.",
    shell: "node --test --test-name-pattern='VIP-39 Preconditions|code-specific prerequisite|active JSX examples' docs/tools/spec-rules.test.mjs",
    data: [design, S.Filegroup({ srcs: [...S.glob(["docs/tools/spec-rules*.mjs", "docs/tools/spec-examples.mjs", "docs/tools/package.json", "docs/tools/bun.lock", "typescript/tsc/internal/diagnostics/diagnosticMessages.json", "typescript/tsc/internal/tsoptions/declarations_generated.go"])] })],
    tools: [node],
    sandbox: "none",
    timeout: "1m"
  }),
  "spec-diagnostic-authority": S.Shell.Test({
    summary: "Legacy migration diagnostics cite accepted authority while denied proposals remain rejected.",
    shell: "node --test --test-name-pattern='legacy layer migration cites|current resource warning|denied-VIP amendments' docs/tools/spec-rules.test.mjs",
    data: [design, S.Filegroup({ srcs: [...S.glob(["docs/tools/spec-rules*.mjs", "docs/tools/spec-examples.mjs", "docs/tools/package.json", "docs/tools/bun.lock", "typescript/tsc/internal/diagnostics/diagnosticMessages.json", "typescript/tsc/internal/tsoptions/declarations_generated.go"])] })],
    tools: [node],
    sandbox: "none",
    timeout: "2m"
  }),
  "spec-proposed-diagnostics": S.Shell.Test({
    summary: "Proposed diagnostic fixtures use unassigned codes and preserve every published assignment.",
    shell: "node --test --test-name-pattern='pending diagnostic authorities stay unresolved|published compiler assignment remains assigned' docs/tools/spec-rules.test.mjs",
    data: [design, S.Filegroup({ srcs: [...S.glob(["docs/tools/spec-rules*.mjs", "docs/tools/spec-examples.mjs", "docs/tools/package.json", "docs/tools/bun.lock", "typescript/tsc/internal/diagnostics/diagnosticMessages.json", "typescript/tsc/internal/tsoptions/declarations_generated.go"])] })],
    tools: [node],
    sandbox: "none",
    timeout: "2m"
  }),
  "spec-rule-table": S.Shell.Test({
    summary: "Check rule-injection quotations against current public chapters.",
    shell: "cd typescript/tsc && GOCACHE=$HOME/.cache/go-build-smthrs CGO_ENABLED=0 go test -p 8 -count=1 -trimpath -run '^TestSpecRuleTable$' ./internal/vibelangfuzz/",
    data: [design, Tsc.srcs, Tsc["vibelang-files"], Tsc["vibelangfuzz-files"]],
    tools: [S.Host.bin("go"), S.Host.bin("node")],
    sandbox: "none",
    timeout: "15m"
  }),
  "spec-registry-go": S.Shell.Test({
    summary: "Every assigned code is registered or names its implementation owner; legacy exceptions apply only to unassigned declarations.",
    shell: `cd typescript/tsc && GOCACHE=$HOME/.cache/go-build-smthrs CGO_ENABLED=0 go test -p 8 -count=1 -trimpath -run '^(TestRegistryMatchesSpec|TestCompilerRegistryIsSpecified|TestRegistryDebtLedger|TestShortTargetsBudgeted|TestRegistryDeclarationAllowanceQuoted|TestRegistryDeclarationAllowancesStayStrict|FuzzRegistryDeclarationAllowances|TestGrammarAdmissionReasonsUsePublishedCodes|FuzzPublicCompatibilityCodeCitations)$' ./internal/vibelang/ ./internal/vibelangfuzz/`,
    data: [design, Tsc.srcs, Tsc["vibelang-files"], Tsc["vibelangfuzz-files"], Vibelang.tree] as Array<never>,
    tools: [go, node],
    sandbox: "none",
    timeout: "15m"
  }),
  "spec-tests": S.Shell.Test({
    summary: "The Go tests that read docs/design (the registry, the VIP citations and coverage, the pending lines) and the cost guards of flow narrowing.",
    shell:
      `cd typescript/tsc && GOCACHE=$HOME/.cache/go-build-smthrs CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 VIBELANG_FUZZ_HANG=120s ${effect} ` +
      `node ../../scripts/go-test-progress.mjs go test -json -count=1 -trimpath -run '^(Test[A-Za-z0-9_]*Quoted|${[...specTests, ...narrowingCostTests].join("|")})$' ./internal/checker/ ./internal/vibelang/ ./internal/vibelangfuzz/ ./internal/effecttsgo/shim/checker/`,
    data: [design, goTestProgress, migrationSources, Tsc.srcs, Tsc["effect-shim-files"], Tsc["vibelang-files"], Tsc["vibelangfuzz-files"], Packages["runtime-dist"]] as Array<never>,
    tools: [go, node],
    sandbox: "none",
    timeout: "10m"
  })
}

export const Package = S.Package({ targets: {
    "migration-sources": migrationSources, tree, "design-files": design, ...targets, ...fuzzTopicTargets, ...fuzzShardTargets, ...vibelangTopicTargets } })
