import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

// The units of the pending gate (internal/vibelangfuzz/pending.sh): each probe
// test it runs whole, and each test function a pending line in
// testdata/pending/ names. PACKAGE.ts runs them as parallel groups,
// //:go-vibelangfuzz-pending-group-<n>, each through pending.sh with
// VIBELANG_PENDING_UNITS, and keeps //:go-vibelangfuzz-pending as their Suite.
// A unit a new pending line adds joins a group here without an edit;
// scripts/fuzz-pending-groups.test.mjs checks that this scan and
// `pending.sh --units` agree and that every unit runs in exactly one group.
// The scan lives here so PACKAGE.ts stays free of filesystem reads.
const dir = join(dirname(fileURLToPath(import.meta.url)), "typescript/tsc/internal/vibelangfuzz/testdata/pending")

export function pendingUnits(directory = dir): Array<string> {
  // pending.sh concatenates the files, so a file without a final newline joins
  // its last line to the next file's first line, as here.
  const text = readdirSync(directory).filter((file) => file.endsWith(".txt")).sort()
    .map((file) => readFileSync(join(directory, file), "utf8")).join("")
  const units = new Set(["probe:TestDataSpecRules", "probe:TestVIPConstructs"])
  // As pending.sh: a target with a corpus or feature line runs named, and a
  // target with any other line that is not superseded runs whole.
  for (const line of text.split("\n")) {
    const [target, key, owner] = line.trim().split(/[ \t\r\f\v]+/)
    if (line.startsWith("#") || line.trim().split(/[ \t\r\f\v]+/).length < 4) continue
    if (/^(corpus|feature):/.test(key) || (!key.startsWith("corpus:") && owner !== "superseded")) units.add(target)
  }
  return [...units].sort()
}

// Seconds each unit's tests took in one whole pending.sh run (go test -v) on a
// 4-vCPU box. A unit missing here (a new pending target) counts as
// unmeasuredSeconds; add its time when it is measured.
export const pendingUnitSeconds: Readonly<Record<string, number>> = {
  "FuzzBareInferReturnAnnotation": 0.66,
  "FuzzCarriedSourceThrowsTags": 0.34,
  "FuzzCatchResultOperand": 0.52,
  "FuzzCompile": 0.75,
  "FuzzConcurrentFreshBindings": 0.32,
  "FuzzDeclarationIdentity": 0.6,
  "FuzzDurableCallSignatures": 0.37,
  "FuzzEditor": 0.97,
  "FuzzEditorConsistency": 0.15,
  "FuzzEffectBlockDeclarationTwin": 0.14,
  "FuzzEffectTypeObjectSlots": 0.16,
  "FuzzFailuresSpec": 6.03,
  "FuzzFiberPatternReference": 0.06,
  "FuzzForeignLazyThunks": 0.22,
  "FuzzForeignReceiverContract": 0.28,
  "FuzzFormat": 0.37,
  "FuzzFunctionBoundaries": 0.24,
  "FuzzFunctionEffectInference": 0.58,
  "FuzzFunctionSyntax": 0.22,
  "FuzzFunctionsSpec": 0.47,
  "FuzzGrammarAdmission": 1.95,
  "FuzzIncremental": 0.12,
  "FuzzLibOriginThrows": 0.4,
  "FuzzLintTreeTokens": 3.08,
  "FuzzMatchBindingHomes": 0.42,
  "FuzzMigrationManifestAuthorities": 0.32,
  "FuzzMigrationSidecarAvailability": 2.9,
  "FuzzMigrationSourceChildLint": 0.44,
  "FuzzMigrationThrowCallHome": 1.54,
  "FuzzModuleBodyDirectives": 0.17,
  "FuzzModuleSpecifierExpressions": 0.63,
  "FuzzNativeModuleCompanions": 0.07,
  "FuzzParse": 5.66,
  "FuzzPlatformHatchSymbols": 0.3,
  "FuzzRethrowsAliasAdmission": 0.42,
  "FuzzServiceGenericRequirement": 0.34,
  "FuzzSplice": 0.17,
  "FuzzSpreadDirectFormAdvisories": 0.36,
  "FuzzTypedEffectInitializerTry": 0.05,
  "FuzzVIPDifferential": 2.9,
  "probe:TestDataSpecRules": 45.37,
  "probe:TestVIPConstructs": 32.44,
}
export const unmeasuredSeconds = 10

// Groups to run in parallel. Each group also compiles (links) the test binary
// and starts it once per selector, a few seconds with a warm Go cache.
export const pendingGroupCount = 3

// pendingGroups packs units into pendingGroupCount groups, slowest first onto
// the least loaded group (ties: lower group), so the slowest group stays near
// the mean. Units inside a group keep their sorted order.
export function pendingGroups(units = pendingUnits(), seconds = pendingUnitSeconds,
  count = pendingGroupCount): Array<Array<string>> {
  const cost = (unit: string) => seconds[unit] ?? unmeasuredSeconds
  const groups = Array.from({ length: count }, () => ({ load: 0, units: [] as Array<string> }))
  for (const unit of [...units].sort((a, b) => cost(b) - cost(a) || (a < b ? -1 : a > b ? 1 : 0))) {
    const group = groups.reduce((min, next) => next.load < min.load ? next : min)
    group.load += cost(unit)
    group.units.push(unit)
  }
  return groups.map((group) => group.units.sort()).filter((group) => group.length > 0)
}
