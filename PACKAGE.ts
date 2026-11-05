import { Smithers as S } from "@smthrs/targets"
import { fuzzTopics } from "./fuzz-topics.ts"
import { vibelangTopics } from "./vibelang-topics.ts"
import { migrationSources } from "./migration-inputs.ts"
import { createApiIdentityInputs } from "./api-inputs.ts"
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
  "TestEffectMarkerComments",
  "FuzzEffectMarkerComments",
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
  "TestAwaitPlacementQuickFixes",
  "TestLintLeavesProjectUnchanged",
  "TestCompileKeepsCompatibilitySidecars",
  "TestAwaitAdvisoryPlacementRegression",
  "TestGrammarAdmissionInventory",
  "TestGrammarAdmissionInventoryReverts",
  "TestGrammarAdmissionPipes",
  "TestGrammarAdmissionCore",
  "TestGrammarAdmissionForAwait",
  "TestGrammarAdmissionDiagnostics",
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
  "TestGrammarAdmissionIsPrefixPrecedenceRegression",
  "TestGrammarAdmissionIsPrefixCorpusReplay",
  "TestGrammarAdmissionSchemaJSDocKeys",
  "TestGrammarAdmissionSchemaJSDocRegression",
  "TestGrammarAdmissionOptionalTuples",
  "TestGrammarAdmissionDynamicImport",
  "TestGrammarAdmissionSchemaStaticKeys",
  "TestGrammarAdmissionSchemaStaticRegression",
  "TestGrammarAdmissionSchemaAsyncKeys",
  "TestGrammarAdmissionSchemaAsyncRegression",
  "TestGrammarAdmissionMetaPropertyKeys",
  "TestGrammarAdmissionMetaPropertyNative",
  "TestGrammarAdmissionMetaPropertyRegression",
  "TestGrammarAdmissionImportArityKeys",
  "TestGrammarAdmissionImportArityRegression",
  "TestGrammarAdmissionMutationKeys",
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
  "TestCommandLineFixScopes",
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
  "TestFixExplicitEmptyErrorDeclarations",
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
// The cost guards of vibelang --fix. They count programs and parsed files, and
// compare the time and memory of two project sizes, so a slower fix loop fails
// here in seconds; the rewrite cases, which meet it as a 30 s limit on a busy
// host, run after the merge.
// The platform-wrapper --fix repairs: an EK4402 access inside a bare sync,
// callback or tryPromise moves into a .platform.ts companion, or the run says
// why it refuses. They take about 45 s together. dd45ca328242 (VIP-6 sync and
// callback as Effect globals) changed the prelude identity of sync, and the
// repair silently found no wrapper; only post-merge //:go-vibelang ran them.
const platformWrapperFixTests = ["TestFixPlatformWrapperInputsAndOneCompanion", "TestFixPlatformWrapperInputRefusals", "TestFixPlatformWrapperInputRuntime", "TestFixPlatformWrapperPreservesDeclaration", "TestFixPlatformOneCompanionVerified", "TestFixPlatformExistingGeneratedCompanion"]
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
  "30m",
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

// Specification checks share the normal graph and cache. The existing forms
// gate selection reaches these dependencies without a pre-gate change.
const specInputs = S.Filegroup({ srcs: [...S.glob([
  "docs/design/**", "typescript/vibelang/cases/**", "docs/tools/spec-rules*", "docs/tools/spec-examples*", "docs/tools/spec-lint*", "docs/tools/spec-pipe-arrows*", "docs/tools/spec-native-source-resolution*", "docs/tools/spec-diagnostic-*",
  "docs/tools/package.json", "docs/tools/bun.lock", "docs/maintainers/build.md",
  "docs/tools/diagnostic-identity*", "docs/tools/diagnostic-archive-examples*", "docs/tools/diagnostic-examples*", "docs/tools/diagnostic-native-projects*", "typescript/vibelang/cases/appendix-diagnostic-identities/examples.json", "scripts/diagnostic-inventory.mjs", "docs/tools/factory-diagnostic-retirement.test.mjs", "docs/tools/retirement-gate*", "scripts/mq-retirement-precheck*",
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
  tools: [node], sandbox: "none", timeout: "2m"
})
const specAppendixHostExamples = goVibelang(
  "Appendix mapper diagnostics and explicit editor repairs keep their documented identities.",
  `CGO_ENABLED=0 ${effect} go test -p 8 -count=1 -trimpath -timeout 5m -run "TestCompatibilityIdentityPrimaryMessages|TestAppendixMapperHostExamples|TestAppendixEditorHostExamples|TestAppendixRegisteredOnlyHostExamples|TestInferred|TestUnprojectedForm|TestRenderExec|TestAutomaticTracingOptionRejected|TestVersionMismatchDiagnostic" ./internal/vibelang ./internal/vibelangmapper ./internal/ls`
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
const specLinterTests = S.Shell.Test({
  summary: "Historical spec defects, VIP links and supersession, module extraction scope and projection source kinds, seeded properties and native example checks reject regressions.",
  shell: "node --test docs/tools/spec-rules.test.mjs docs/tools/spec-examples-compiler.test.mjs docs/tools/spec-rules-import-grammar.test.mjs docs/tools/diagnostic-identity.test.mjs docs/tools/diagnostic-examples.test.mjs docs/tools/diagnostic-archive-examples.test.mjs docs/tools/diagnostic-native-projects.test.mjs docs/tools/factory-diagnostic-retirement.test.mjs docs/tools/retirement-gate.test.mjs && python3 -B scripts/mq-retirement-precheck.test.py && cd docs/tools && bun test --timeout 60000 spec-lint.test.ts spec-native-source-resolution.test.ts",
  data: [specInputs, Packages["compiler-native"], Packages["runtime-dist"]] as Array<never>,
  tools: [node, bun, S.Host.bin("jj"), S.Host.bin("python3")], sandbox: "none", timeout: "5m"
})

// No cache hits based only on a mutable jj revision name.
const retirementEnv = {
  RETIREMENT_BASE: process.env.RETIREMENT_BASE ?? "",
  RETIREMENT_HEAD: process.env.RETIREMENT_HEAD ?? "",
  JJ_ALLOW_NYC01_WS: process.env.JJ_ALLOW_NYC01_WS ?? ""
}
const retirementGate = S.Shell.Test({
  summary: "Retired forms have a tested --fix or reviewed VIP/Will exception.",
  shell: 'test -n "$RETIREMENT_BASE" && test -n "$RETIREMENT_HEAD" && node docs/tools/retirement-gate.mjs --immutable --base "$RETIREMENT_BASE" --head "$RETIREMENT_HEAD"',
  env: retirementEnv,
  data: [tree, Typescript.compiler, Packages["runtime-dist"]] as Array<never>,
  tools: [node, S.Host.bin("jj")], sandbox: "none", timeout: "5m", exclusive: true
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
const grammarAdmissionCheck = check(
  "Every grammar admission table matches its reviewed census source.",
  "node scripts/generate-grammar-admission.mjs --check",
  [], [node]
)

const specLint = S.Shell.Test({
  summary: "Static specification contracts and their regression tests.",
  shell: "echo 'spec-lint: static contracts passed'",
  data: [specRegistry, specTables, specCopies, specAuthority, specLinterTests, specPipeArrows, specCatchDiagnostics, specAppendixExamples, specDiagnosticIdentity, specAppendixHostExamples],
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
    shell: "node --test packages/create-vibelang/test/create.test.mjs",
    data: [
      S.file("packages/create-vibelang/package.json"),
      S.file("packages/create-vibelang/bin/create-vibelang.mjs"),
      S.file("packages/create-vibelang/test/create.test.mjs"),
      S.glob("templates/app/**"),
      S.file("docs/user/llms-essentials.md")
    ],
    tools: [node],
    sandbox: "none",
    timeout: "1m"
  }),
  "spec-coverage-census": S.Shell.Run({
    summary: "Inventory main rules with passing, pending, missing and tag-linked evidence.",
    shell: 'bun docs/tools/coverage-census.ts --revision "$CENSUS_REVISION" --out "${CENSUS_OUT:-$HOME/vibe/review-spec/coverage}"',
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
  "grammar-admission": grammarAdmission,
  "grammar-admission-check": grammarAdmissionCheck,
  "spec-retirement-gate": retirementGate,
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
  "spec-lint": specLint,
  "docs-comparison-output": check(
    "Complete Effect comparisons print the output their prose promises, without an injected runner.",
    "bun docs/tools/check-comparison-output.ts && bun test --timeout 60000 docs/tools/check-comparison-output.test.ts",
    [Packages["compiler-native"]],
    [bun, node]
  ),
  "spec-catch-diagnostics": specCatchDiagnostics,
  release: check(
    "The release, contributor and site generator node tests, the upgrade and maintenance flows' steps, and their evals' step keys.",
    "node --test --test-concurrency=8 scripts/release/*.test.mjs 'scripts/!(api-identity*).test.mjs' typescript/vibelang/harness.test.mjs typescript/vibelang/cov-ch004-twin.test.mjs typescript/vibelang/coverage-stock-twins.test.mjs typescript/vibelang/vip7-reference.test.mjs docs/redirect/*.test.mjs " +
      "site/scripts/sync-spec-docs.test.mjs site/scripts/sync-user-docs.test.mjs " +
      ".smithers/flows/effect-bump/test/*.test.mjs .smithers/flows/ts-bump/test/*.test.mjs .smithers/flows/ci-health/test/*.test.mjs .smithers/flows/first-bad/test/*.test.mjs " +
      ".smithers/flows/test/*.test.mjs",
    [apiIdentityTest, Typescript["forms-generator"], Packages["compiler-native"], Packages["runtime-dist"]],
    [node, bun, gofmt, bun, go, S.Host.bin("diff3")]
  ),
  "starter-templates": check(
    "Compile and run every starter with zero diagnostics and zero legacy sites.",
    "bun test --timeout 180000 docs/tools/starter-templates.test.ts",
    [Typescript["forms-generator"], Packages["compiler-native"], Packages["runtime-dist"]],
    [bun, node],
    "5m"
  ),
  snippets: check(
    "Compile every code block in the docs.",
    "bun docs/tools/check-snippets.ts",
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
    [Typescript.compiler, Packages["runtime-dist"], Packages["compiler-native"]],
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
  tokens: check("Token counts in the docs match a fresh count.", "bun docs/tools/token-counts.ts --check", [], [bun]),
  // The executable is source-keyed; generation still reads the entire tree.
  forms: check(
    "The forms table and its decisions match a fresh generation.",
    "FORMS_BINARY=$PWD/typescript/built/local/vibelang-forms " +
      "GOCACHE=$HOME/.cache/go-build-smthrs bash scripts/check-forms-table.sh",
    [Typescript["forms-generator"], specLint, grammarAdmissionCheck],
    [bun, node]
  ),
  "build-contracts": check(
    "Build and test commands retain their explicit budgets and prerequisites.",
    "node --test --test-concurrency=4 scripts/bun-test-budgets.test.mjs scripts/compiler-test-inputs.test.mjs scripts/go-build-flags.test.mjs scripts/go-cache.test.mjs scripts/go-shared-test-inventory.test.mjs scripts/go-test-cache.test.mjs",
    [],
    [go, node],
    "5m"
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
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 VIBELANG_FUZZ_HANG=120s EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestPromiseDataBridgeQuoted|TestPromiseDataBridgeForms)$' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --verbose plain-catch-function-results",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "trusted-callback-contracts": check(
    "Listed trusted callbacks keep explicit foreign contracts and constructor shadowing behavior.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestTrustedCallbackContractsQuoted|FuzzTrustedCallbackContracts)$' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --verbose hygiene-builtin-failure-class",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "class-evaluation-repairs": goVibelang(
    "Keep class evaluation repairs parseable, defect-preserving and idempotent",
    "CGO_ENABLED=0 go test -v -p 8 -count=1 -trimpath -timeout=5m ./internal/vibelang -run '^TestClassBaseFailureFix' && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestClassEvaluationRepairsQuoted|FuzzClassEvaluationRepairs)$'",
    [Tsc["vibelangfuzz-files"]],
    "10m",
  ),
  "whole-service-declarations": check(
    "Whole-shape service declarations match their native counterpart without invented namespaces.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestWholeServiceShapeDeclarationQuoted|FuzzWholeServiceShapeDeclaration)$' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --verbose declaration-identity-namespace-imports",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "legacy-provider-identities": check(
    "Missing-provider diagnostics keep their compatibility identity and do not apply to stored Effect data.",
    "cd typescript/tsc && CGO_ENABLED=0 go test -v -p 8 -count=1 -trimpath -timeout=5m ./internal/vibelang -run '^TestCompatibilityIdentityPrimaryMessages$' && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestLegacyProviderIdentityQuoted|FuzzLegacyProviderIdentity)$' && CGO_ENABLED=0 go vet -p 8 -trimpath ./internal/vibelangfuzz && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --verbose d362-effect-provide-union.fail d362-provide-tuple.fail",
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
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestOptionalEffectGuardsQuoted|FuzzOptionalEffectGuards)$' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --verbose optional-callback-contract.fail",
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
    "EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --verbose cov900-interim-severity.fail",
    [Packages["compiler-native"], Packages["runtime-dist"], Vibelang.tree],
    [node, bun],
    "10m"
  ),
  "join-message-regressions": check(
    "Join diagnostics retain their accepted operand domain and Deferred guidance.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestJoinOperandDiagnosticsQuoted|FuzzJoinOperandDiagnostics)$' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --verbose fibers-await.fail",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "lint-activation-regressions": check(
    "Imported lint retains configured legacy activation and leaves unconfigured projects inactive.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestLintActivationQuoted|FuzzLintActivation|TestLintPluginMigrationQuoted|FuzzLintPluginMigration)$' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --verbose effect-lint-activation ek4823-effect-block.fail",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "service-member-controls": check(
    "Invalid service members retain errors while valid native service classes retain their advisory.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^TestNamedServiceClassFixQuoted$' && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^FuzzNamedServiceClassFix$/^record-control-' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --verbose service-nameless-members.fail",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "plain-runner-promise-data": check(
    "Plain runner examples retain eager Promise creation and explicit later awaiting.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^TestPromiseDataBridgeForms$' && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^FuzzPromiseResultGate$/^plain-runpromise-' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --verbose vip1-accept-plain-runpromise",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "option-direct-consumption": check(
    "Option match retains its teaching advisory while direct try consumption avoids generic warnings.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^FuzzTryOperandEffectArgumentDiagnostics$' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --verbose tsforms-option-match-program",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "lexical-restore-regressions": check(
    "Restore examples use lexical masks and retain outward return and interruption behavior.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestInterruptionPlacementQuoted|FuzzInterruptionPlacement)$' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --verbose restore-in-uninterruptible-expression interruption-nested-restore",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "native-value-boundaries": check(
    "Native identity examples keep explicit boundaries and original process-service observations.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestNativeValueDefectBoundaryQuoted|FuzzNativeValueDefectBoundary)$' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --verbose experimental-process-current-uid",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "object-runner-promise-data": check(
    "Object runner calls retain Promise values without running stored work.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestPromiseDataBridgeQuoted|TestPromiseDataBridgeForms)$' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --verbose plain-object-byname",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "stream-loop-head-identities": check(
    "Stream loop head rejections use their owning diagnostic without parser cascades.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestEffectLoopHeadsQuoted|FuzzEffectLoopHeadRecovery)$' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --verbose cov2-002a-stream-heads.fail vip20-head.fail",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "host-clock-identities": check(
    "Host clock reads keep the platform diagnostic and ignore retired clock settings.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestClockPlatformContractQuoted|FuzzClockPlatformContract)$' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --verbose d5-clock-read.fail",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "native-written-declaration-routes": check(
    "Native source imports of VibeLang declarations retain the corresponding TypeScript routes.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^TestWrittenSourceDeclarationSpellingsQuoted$' && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^FuzzWrittenSourceDeclarationSpellings$/^native-import-' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --verbose declaration-written-ts-import-vibe-target",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "setup-lint-exit-policy": check(
    "Setup preserves authored lint settings and native compiler exit policy.",
    "node --test --test-name-pattern='^(effect-exit-options:|effect-exit-extends:)' .smithers/flows/migrate/test/tsc-scripts.property.test.mjs && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --verbose effect-lint-built-in-setup-policy",
    [Packages["compiler-native"], Packages["runtime-dist"], Vibelang.tree],
    [node, bun, S.Host.bin("jj")],
    "10m"
  ),
  "catch-value-identities": check(
    "Invalid catch values keep their syntax error and independent native diagnostics without generic-call cascades.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestCatchValueDiagnosticsQuoted|FuzzCatchValueDiagnostics)$' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --verbose vip1-accept-catch-value-fallback.fail",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "throws-documentation-preservation": check(
    "Throw-tag migrations preserve authored comments and report manual migration without discarding prose.",
    "cd typescript/tsc && CGO_ENABLED=0 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -count=1 -trimpath -timeout=5m ./internal/vibelang -run '^TestThrowsTagFix' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --verbose vip4-coverage-annotation-fix",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelang-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "trusted-empty-forwarding": check(
    "Trusted-wrapper migration retains the original input proof and runs current forwarding output.",
    "cd typescript/tsc && CGO_ENABLED=0 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -count=1 -trimpath -timeout=5m ./internal/vibelang -run '^TestTrustedEmptyMigration' && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^FuzzGeneratedDefectBridgeFixTwin$/^trusted-empty-forwarding-' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --verbose trusted-empty-migration",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelang-files"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "negative-promise-boundaries": check(
    "Rejected Promise calls retain every independent boundary, host and root-runner diagnostic.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestNegativePromiseBoundariesQuoted|FuzzNegativePromiseBoundaries)$' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --verbose ek1005-runners.fail ek1005-prelude-runner.fail ch10-fetch.fail ek4401-plain-call.fail",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "error-family-native-patterns": check(
    "Native error families preserve declarations and runtime routing through class and object patterns.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestErrorFamilyNativePatternsQuoted|FuzzErrorFamilyNativePatterns)$' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --verbose decl-error-family",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "pattern-predicate-contracts": check(
    "Pattern predicates retain source and foreign callable contracts without changing global objects.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestPatternPredicateContractQuoted|FuzzPatternPredicateContract)$' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --verbose match-vip7-patching",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "relocated-sidecar-layout": check(
    "Relocated sidecars share source identity only through their proven owning root.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestRelocatedSidecarLayoutQuoted|FuzzRelocatedSidecarLayout)$' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --verbose declaration-output-relocated-routes",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "catch-error-data-advisories": check(
    "Tagged errors returned as plain catch data retain the Effect-result advisory.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestCatchErrorDataAdvisoryQuoted|FuzzCatchErrorDataAdvisory)$' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --verbose tsforms-errors tsforms-errors-fixed",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "plain-unknown-contracts": check(
    "Unknown foreign calls retain native plain-code behavior and effect-code wrapper errors.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestPlainUnknownContractQuoted|FuzzPlainUnknownContract)$' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --verbose ek4401-fix.fail",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "producer-native-annotations": check(
    "Producer annotations retain TypeScript assignability with stock TypeScript positive and negative controls.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^FuzzProducerWrittenContract$' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --verbose producer-native-return-contracts",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "stream-loop-body-identities": check(
    "Stream-loop restrictions retain their owner diagnostics and valid local-break controls.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestStreamLoopBodyIdentityQuoted|FuzzStreamLoopBodyIdentity)$' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --verbose for-try-coverage-bindings.fail",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "missing-data-method-diagnostics": check(
    "Invalid data methods retain native missing-member errors without inferred-argument advisories.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestMissingDataMethodQuoted|FuzzMissingDataMethod)$' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --verbose data-methods-first-parameter.fail",
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
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestUnrelatedDeclarationSpecifierQuoted|FuzzUnrelatedDeclarationSpecifier)$' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --verbose native-import-preference-twins",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "legacy-schema-key-defect-repairs": check(
    "Legacy computed-key repairs retain independent throw errors and compile preserving defect bridges.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^FuzzSchemaErrorLegacyKeyFix$'",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "throw-repair-native-twins": check(
    "Throw repairs preserve native timing, cleanup, declarations, and failure channels across all input variations.",
    "EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --verbose ek0401-preserving-fix",
    [Packages["compiler-native"], Packages["runtime-dist"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "option-generator-iterator-refusals": check(
    "Native Option generators compile while explicit producer arguments retain iterator-preserving refusal checks.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestOptionIteratorRepairQuoted|FuzzOptionIteratorRepair)$'",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "error-tag-inheritance-identities": check(
    "Error declarations reject inherited and reserved tags while retaining native property errors.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestReservedPayloadInheritanceQuoted|FuzzReservedPayloadInheritance)$' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --verbose decl-error-family-own-tag.fail && node typescript/vibelang/test/error-family-native-override.mjs",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "automatic-catch-data-preservation": goVibelang(
    "Automatic repairs preserve plain catch data, warnings and contracts while explicit editor actions remain available.",
    `CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 ${effect} go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelang ./internal/vibelangfuzz -run '^(TestPlainHandlerEffectAdviceQuickfix|TestPlainHandlerEffectAdviceMixedResultNeedsBranch|TestAutomaticCatchDataPreservationQuoted|FuzzAutomaticCatchDataPreservation|TestTypeScriptFormCasesFix)$/^(tsforms-errors|tsforms-errors-preserves-data|seed#.*|catch-data-.*)$' && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 ${effect} go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^FuzzFix$/^tsforms-errors-preserves-data$'`,
    [Tsc["vibelangfuzz-files"]],
    "10m"
  ),
  "native-repair-argument-thunks": goVibelang(
    "Preserving call repairs emit current native argument thunks and retain narrowing and public declarations.",
    `CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 ${effect} go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelang ./internal/vibelangfuzz -run '^(TestFixNothrowCalls|FuzzNativeRepairArgumentThunks)$'`,
    [Tsc["vibelangfuzz-files"]],
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
    "Await repairs retain exact native declaration contracts and Promise runtime behavior.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestNativeAwaitBridgeQuoted|TestNativeAwaitBridgeRuntime|FuzzNativeAwaitBridge)$'",
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
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestPlatformCallbackContractQuoted|FuzzPlatformCallbackContract)$' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --verbose ek4402-platform.fail",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "schema-alias-native-properties": goVibelang(
    "Schema alias repairs preserve native writable and readonly properties, optionality and declarations.",
    `CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 ${effect} go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelang ./internal/vibelangfuzz -run '^(TestSchemaStructAliasQuickFix|TestSchemaAliasNativePropertiesQuoted|FuzzSchemaAliasNativeProperties)$'`,
    [Tsc["vibelangfuzz-files"]],
    "10m"
  ),
  "native-using-advisories": goVibelang(
    "Native disposal errors coexist with every configured Effect using advisory.",
    `CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 ${effect} go test -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestEffectUsingWarningQuoted|FuzzEffectUsingWarning)$'`,
    [Tsc["vibelangfuzz-files"]],
    "10m"
  ),
  "optional-foreign-contracts": check(
    "Optional calls preserve receiver and evaluation semantics with explicit foreign callback contracts.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestOptionalForeignCallbacksQuoted|FuzzOptionalForeignCallbacks)$' && CGO_ENABLED=0 go vet -p 8 -trimpath ./internal/vibelangfuzz && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --verbose optional-effect-calls optional-effect-semantics",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "native-inferred-declarations": check(
    "Inferred native import spellings follow stock TypeScript across suffix, quote and directory variations.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestWrittenSourceDeclarationSpellingsQuoted|FuzzWrittenSourceDeclarationSpellings)$' && CGO_ENABLED=0 go vet -p 8 -trimpath ./internal/vibelangfuzz && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --verbose native-inferred-import-spelling",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "pipe-topic-regressions": check(
    "Implemented direct and nested missing-topic errors run as ordinary regression cases.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestPipeTopicEarlyErrorQuoted|FuzzPipeTopicEarlyError)$' && CGO_ENABLED=0 go vet -p 8 -trimpath ./internal/vibelangfuzz && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --verbose cov-ch002b-running-pipe-missing-topic-absent.fail cov-ch002b-running-pipe-missing-topic-nested.fail",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "10m"
  ),
  "declaration-manifest-retirement": check(
    "Declaration builds retain their complete file sets and runtime behavior without retired provenance manifests.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -trimpath -timeout=5m ./internal/vibelangfuzz -run '^(TestPackageFileSetQuoted|FuzzPackageFileSet)$' && CGO_ENABLED=0 go test -v -p 8 -count=1 -trimpath -timeout=5m ./internal/vibelang -run '^TestPackageEmitHasNoManifest$' && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --verbose written-forms",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Tsc["vibelang-files"], Vibelang.tree],
    [go, node, bun],
    "15m"
  ),
  "docs-contracts": S.Shell.Test({
    summary: "Published documentation contracts and their native counterparts remain consistent.",
    shell: "node --test --test-concurrency=2 docs/tools/spec-colon-leads.test.mjs docs/tools/spec-catch-pipe-input.test.mjs docs/tools/spec-sidecar-roots.test.mjs docs/tools/spec-ts-custom-matcher.test.mjs docs/tools/spec-schema-jsdoc.test.mjs docs/tools/spec-direct-try-advisories.test.mjs docs/tools/spec-sidecar-input-protection.test.mjs docs/tools/spec-sidecar-final-path.test.mjs docs/tools/spec-async-throws.test.mjs docs/tools/spec-constructor-static-contract.test.mjs docs/tools/spec-generator-call-phase.test.mjs docs/tools/spec-handler-initialization.test.mjs docs/tools/spec-callable-contracts.test.mjs docs/tools/spec-contracts-overload.test.mjs docs/tools/spec-throw-contracts.test.mjs docs/tools/vip34-diagnostic-ownership.test.mjs docs/tools/spec-legacy-effect-alias-transition.test.mjs docs/tools/spec-builtins-contracts.test.mjs docs/tools/spec-foreign-call-contract.test.mjs docs/tools/spec-r16-carried.test.mjs docs/tools/spec-is-statement-body-home.test.mjs docs/tools/spec-is-limit-catch-homes.test.mjs && node --test --test-name-pattern='^Appendix B' docs/tools/spec-nothrow.test.mjs",
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
      "docs/tools/spec-nothrow.test.mjs",
      "docs/tools/spec-r16-carried.test.mjs",
      "docs/tools/spec-is-statement-body-home.test.mjs",
      "docs/tools/spec-is-limit-catch-homes.test.mjs"
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
  "docs-table-rows": check(
    "User tables retain headers and widths; platform advice qualifies queries, argument lists, byte reads and elapsed time.",
    "node docs/tools/table-rows.mjs && bun test --timeout 30000 docs/tools/user-table-rows.test.ts docs/tools/spec-table-rows.test.mjs",
    [],
    [bun, node]
  ),
  "docs-tools": check(
    "docs/tools' bun tests, with cached specification links and linters and without site contrast.",
    "cd docs/tools && bun test --timeout 60000 --parallel=3 --no-isolate $(ls *.test.* | grep -vE '^(site-(contrast|spec-links)|spec-lint)\\.test\\.')",
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
  // The tests' scope takes the graph's compiler and mapper executables instead
  // of linking both, and a third mapper copy, per test binary (scope_test.go).
  "go-vibelangmapper": goVibelang(
    "Go tests of internal/vibelangmapper.",
    `CGO_ENABLED=0 ${effect} VIBELANG_MAPPER_TEST_TSC=$PWD/../built/local/tsc ` +
      "VIBELANG_MAPPER_TEST_MAPPER=$PWD/../built/local/vibelang-mapper " +
      "go test -count=1 -p 8 -timeout 25m -trimpath ./internal/vibelangmapper/...",
    [Tsc["vibelangmapper-files"], Typescript.compiler, Typescript.mapper]
  ),
  // The merge gate runs it with the compiler step, where //:go-vibelangfuzz
  // runs only post-merge: a fix that makes a pending input pass without
  // deleting its line fails before it lands, not on main (four times on
  // 2026-10-30).
  "go-vibelangfuzz-pending": goVibelang(
    "The inputs testdata/pending/ lists still fail, and every probe passes or is pending: a change that makes one pass deletes its line.",
    `CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 VIBELANG_FUZZ_HANG=120s ${effect} sh internal/vibelangfuzz/pending.sh`,
    [Tsc["vibelangfuzz-files"], pendingHangs],
    "30m",
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
      "go test -short -count=1 -timeout=15m -trimpath -run '^(TestConsistencyRenameCollision.*|FuzzEditorRenameCollisionDiagnostics|FuzzEditor|FuzzEditorConsistency|FuzzEffectArrowHeads|FuzzAsyncReturnAdoption|FuzzAsyncRefactorBridges)$' ./internal/vibelangfuzz/",
    [Tsc["vibelangfuzz-files"]],
    "30m",
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
      "go test -short -count=1 -timeout=15m -trimpath -run '^FuzzCompile$' ./internal/vibelangfuzz/",
    [Tsc["vibelangfuzz-files"]],
    "30m",
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
      "go test -short -count=1 -timeout=15m -trimpath -run '^FuzzConfig$' ./internal/vibelangfuzz/",
    [Tsc["vibelangfuzz-files"]],
    "30m",
    fuzzBudgetEnv
  ),
  // Shell targets do not inherit ambient Go controls. Declare the
  // fuzz budget: at most 24 seed workers within the process CPU affinity,
  // and six build jobs. Node is already a declared tool of goVibelang.
  "go-vibelangfuzz": goVibelang(
    "The fuzz oracles over the seed corpus: cases, snippets and saved reproductions.",
    `CGO_ENABLED=0 GOMAXPROCS=$(n=$(node -p 'require("node:os").availableParallelism()'); [ "$n" -lt 24 ] && echo "$n" || echo 24) GOFLAGS=-p=6 VIBELANG_FUZZ_REQUIRE=1 VIBELANG_FUZZ_HANG=120s ${effect} ` +
      `go test -short -count=1 -timeout=40m -trimpath -exec "$PWD/../../scripts/go-test-shards.sh" ./internal/vibelangfuzz/...`,
    [Tsc["vibelangfuzz-files"], S.file("//scripts/go-test-shards.sh")],
    // The package's tests and seed corpora run one after another, so the
    // binary runs as six processes at once (scripts/go-test-shards.sh); each
    // keeps the documented 40m corpus deadline. Admission and compilation
    // retain their separate 25m allowance before the task's 65m limit.
    "65m",
    fuzzBudgetEnv
  ),
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
    "Generator migration refuses incompatible bare returns and preserves valid written result contracts.",
    `CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 VIBELANG_FUZZ_HANG=120s ${effect} go test -p 8 -short -count=1 -timeout 10m -trimpath -run '^(TestEffectFnBareReturnContracts|TestEffectGenWrittenReturn|TestFixGeneratorRefusalLeavesBytes|TestEffectFnBareReturnContractsQuoted|FuzzEffectFnBareReturnContracts)$' ./internal/vibelang/ ./internal/vibelangfuzz/`,
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
    [S.Filegroup({srcs: [...S.glob(["examples/http-api/**", "scripts/check-http-api.mjs", "scripts/prepare-examples.mjs", "packages/vite/**", "packages/compiler/package.json"])]})]
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
    "node --test typescript/vibelang/cov-ch004-twin.test.mjs && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --verbose conditional-record-environment declaration-output-async-contracts declaration-throws-contract vibex-census-containers",
    [Packages["compiler-native"], Packages["runtime-dist"]],
    [node, bun],
    "10m",
    {},
    [Vibelang.tree, S.Filegroup({srcs: [...S.glob(["scripts/api-identity*.mjs", "docs/design/src/001-functions.md", "docs/design/vips/0027-declaration-output.md"])]})]
  ),
  "emission-snapshots": check(
    "Coverage-preserving and native tail delegation emitters keep their exact JavaScript, declarations and runtime observations.",
    "EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --verbose module-declaration-emit data-match-emit vibelang-lower vibelang-infer vibelang-concise-comments match-exhaustive-last-arm rerun-parameter-readonly try-tail-unchecked-message try-tail-native-delegation match-vip7-negation-types",
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
    "Nested Effect type repairs keep exact grouped shorthand, declaration output and runtime behavior.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 VIBELANG_FUZZ_HANG=120s EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -timeout 5m -trimpath -run '^(TestEffectTypeHintParenthesesQuoted|TestEffectTypeHintGroupingFixKeepsDeclarations|FuzzDeepEffectTypeFix)$' ./internal/vibelangfuzz && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --verbose rewrite-deep-types",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "15m"
  ),
  "reserved-error-repair": check(
    "Reserved payload and inheritance errors stay independent while preserving exact declarations and runtime behavior.",
    "cd typescript/tsc && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 VIBELANG_FUZZ_HANG=120s EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -v -p 8 -short -count=1 -timeout 5m -trimpath -run '^(TestReservedPayloadInheritanceQuoted|FuzzReservedPayloadInheritance)$' ./internal/vibelangfuzz && cd ../.. && EFFECT_NODE_MODULES=$PWD/experiments/node_modules VIBELANG_RUNTIME=$PWD/packages/runtime node typescript/vibelang/harness.mjs --verbose rewrite-reserved-error-payload",
    [Packages["compiler-native"], Packages["runtime-dist"], Tsc["vibelangfuzz-files"], Vibelang.tree],
    [go, node, bun],
    "15m"
  ),
  "go-error-inheritance": goVibelang(
    "Error inheritance and ambient class repairs retain diagnostics, declaration output and erasure.",
    `printf 'error-contracts: compile and run inheritance and ambient repair controls\n' && CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 VIBELANG_FUZZ_HANG=120s ${effect} go test -v -p 8 -count=1 -timeout 5m -trimpath -run '^(TestSchemaErrorInheritance.*|TestErrorInheritanceAdmission|TestErrorInheritanceNativeClassesUnaffected|TestAmbientErrorFix.*|FuzzAmbientErrorFix)$' ./internal/vibelang/ ./internal/vibelangfuzz/ && printf 'error-contracts: all controls passed\n'`,
    [Tsc["vibelang-files"], Tsc["vibelangfuzz-files"]],
    "15m"
  ),
  "go-vibelang-fix-twins": goVibelang(
    "What --fix writes for the TypeScript-form, migration and pipeline-stage cases is their fixed twin, within the --fix cost bounds, and platform wrappers move into their companion.",
    `CGO_ENABLED=0 ${effect} go test -count=1 -timeout 20m -trimpath -run '^(TestTypeScriptFormCasesFix|TestMigrationCasesFix|TestEffectStageFixes|TestEffectStageFixesRefuse|${fixCostTests.join("|")}|${platformWrapperFixTests.join("|")})$' ./internal/vibelang/`,
    [Tsc["vibelang-files"]],
    "30m"
  ),
  "lint-config": check(
    "Imported lint activation and config migration preserve diagnostics, exit judgment, emission, plugins and authored settings.",
    `cd typescript/tsc && GOCACHE=$HOME/.cache/go-build-smthrs CGO_ENABLED=0 EFFECT_NODE_MODULES=$PWD/../../experiments/node_modules go test -p 8 -count=1 -trimpath -run '^(TestLintPlugin.*|TestImportedLint.*|TestLintActivationQuoted|TestRegistryMatchesSpec|FuzzLintPluginMigration|FuzzLintActivation|FuzzEffectExitOptions)$' ./internal/tsoptions ./internal/vibelang ./internal/effecttsgo/lint ./internal/vibelangfuzz`,
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
    shell: `cd typescript/tsc && GOCACHE=$HOME/.cache/go-build-smthrs CGO_ENABLED=0 go test -p 8 -count=1 -trimpath -run '^(TestRegistryMatchesSpec|TestCompilerRegistryIsSpecified|TestRegistryDebtLedger|TestShortTargetsBudgeted|TestRegistryDeclarationAllowanceQuoted|TestRegistryDeclarationAllowancesStayStrict|TestQuickFixBehaviorRegistry|FuzzRegistryDeclarationAllowances|TestGrammarAdmissionReasonsUsePublishedCodes|FuzzPublicCompatibilityCodeCitations)$' ./internal/vibelang/ ./internal/vibelangfuzz/`,
    data: [design, Tsc.srcs, Tsc["vibelang-files"], Tsc["vibelangfuzz-files"], Vibelang.tree] as Array<never>,
    tools: [go, node],
    sandbox: "none",
    timeout: "15m"
  }),
  "spec-tests": S.Shell.Test({
    summary: "The Go tests that read docs/design (the registry, the VIP citations and coverage, the pending lines) and the cost guards of --fix and flow narrowing.",
    shell:
      `cd typescript/tsc && GOCACHE=$HOME/.cache/go-build-smthrs CGO_ENABLED=0 VIBELANG_FUZZ_REQUIRE=1 VIBELANG_FUZZ_HANG=120s ${effect} ` +
      `node ../../scripts/go-test-progress.mjs go test -json -count=1 -trimpath -run '^(Test[A-Za-z0-9_]*Quoted|${[...specTests, ...fixCostTests, ...narrowingCostTests].join("|")})$' ./internal/checker/ ./internal/vibelang/ ./internal/vibelangfuzz/ ./internal/effecttsgo/shim/checker/`,
    data: [design, goTestProgress, migrationSources, Tsc.srcs, Tsc["effect-shim-files"], Tsc["vibelang-files"], Tsc["vibelangfuzz-files"], Packages["runtime-dist"]] as Array<never>,
    tools: [go, node],
    sandbox: "none",
    timeout: "15m"
  })
}

export const Package = S.Package({ targets: {
    "migration-sources": migrationSources, tree, "design-files": design, ...targets, ...fuzzTopicTargets, ...vibelangTopicTargets } })
