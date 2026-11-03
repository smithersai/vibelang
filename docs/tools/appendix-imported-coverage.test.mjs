import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { generateLintCodes } from "./lint-codes.mjs"

// These expectations come from Appendix B, independently of the compiler
// registry and the upstream rule definitions. Compare all three columns:
// sharing an EK code alone is not evidence for a rule-name/severity row.
const rows = [
  // Appendix B: effecttsgo/abortControllerInEffect — spec-rule: docs/design/src/900-appendices.md#07c670919e0d545e
  {"rule": "docs/design/src/900-appendices.md#07c670919e0d545e", "code": "EK3802", "name": "abortControllerInEffect", "severity": "suggestion"},
  // Appendix B: effecttsgo/acquireReleaseDisposable — spec-rule: docs/design/src/900-appendices.md#95647d70273f15ea
  {"rule": "docs/design/src/900-appendices.md#95647d70273f15ea", "code": "EK3803", "name": "acquireReleaseDisposable", "severity": "suggestion"},
  // Appendix B: effecttsgo/allOfMapToForEach — spec-rule: docs/design/src/900-appendices.md#426ef6ccb3073ae0
  {"rule": "docs/design/src/900-appendices.md#426ef6ccb3073ae0", "code": "EK3804", "name": "allOfMapToForEach", "severity": "suggestion"},
  // Appendix B: effecttsgo/anyUnknownInErrorContext — spec-rule: docs/design/src/900-appendices.md#f75626a1feb396ac
  {"rule": "docs/design/src/900-appendices.md#f75626a1feb396ac", "code": "EK3805", "name": "anyUnknownInErrorContext", "severity": "off"},
  // Appendix B: effecttsgo/apiStabilityLeak — spec-rule: docs/design/src/900-appendices.md#ec9d1d67597f4a1e
  {"rule": "docs/design/src/900-appendices.md#ec9d1d67597f4a1e", "code": "EK3806", "name": "apiStabilityLeak", "severity": "off"},
  // Appendix B: effecttsgo/asyncFunction — spec-rule: docs/design/src/900-appendices.md#b68a2a7937435a32
  {"rule": "docs/design/src/900-appendices.md#b68a2a7937435a32", "code": "EK3807", "name": "asyncFunction", "severity": "off"},
  // Appendix B: effecttsgo/catchAllTagDispatchToCatchTag — spec-rule: docs/design/src/900-appendices.md#bfb9cfa7f80a3809
  {"rule": "docs/design/src/900-appendices.md#bfb9cfa7f80a3809", "code": "EK3808", "name": "catchAllTagDispatchToCatchTag", "severity": "suggestion"},
  // Appendix B: effecttsgo/catchAllToMapError — spec-rule: docs/design/src/900-appendices.md#3a9fff931541ba5b
  {"rule": "docs/design/src/900-appendices.md#3a9fff931541ba5b", "code": "EK3809", "name": "catchAllToMapError", "severity": "suggestion"},
  // Appendix B: effecttsgo/catchChainToFirstSuccessOf — spec-rule: docs/design/src/900-appendices.md#0dd6c2d710523b41
  {"rule": "docs/design/src/900-appendices.md#0dd6c2d710523b41", "code": "EK3810", "name": "catchChainToFirstSuccessOf", "severity": "suggestion"},
  // Appendix B: effecttsgo/catchConditionalRefailToCatchIf — spec-rule: docs/design/src/900-appendices.md#68251131561517d4
  {"rule": "docs/design/src/900-appendices.md#68251131561517d4", "code": "EK3811", "name": "catchConditionalRefailToCatchIf", "severity": "suggestion"},
  // Appendix B: effecttsgo/catchDieToOrDie — spec-rule: docs/design/src/900-appendices.md#82e3f13dfcf1cefd
  {"rule": "docs/design/src/900-appendices.md#82e3f13dfcf1cefd", "code": "EK3812", "name": "catchDieToOrDie", "severity": "suggestion"},
  // Appendix B: effecttsgo/catchIfTagToCatchTag — spec-rule: docs/design/src/900-appendices.md#dfb72a02b59b7509
  {"rule": "docs/design/src/900-appendices.md#dfb72a02b59b7509", "code": "EK3813", "name": "catchIfTagToCatchTag", "severity": "suggestion"},
  // Appendix B: effecttsgo/catchRefailToTapError — spec-rule: docs/design/src/900-appendices.md#3a887a2117566fed
  {"rule": "docs/design/src/900-appendices.md#3a887a2117566fed", "code": "EK3814", "name": "catchRefailToTapError", "severity": "suggestion"},
  // Appendix B: effecttsgo/catchTagToCatchReason — spec-rule: docs/design/src/900-appendices.md#78584bc38dd47069
  {"rule": "docs/design/src/900-appendices.md#78584bc38dd47069", "code": "EK3815", "name": "catchTagToCatchReason", "severity": "suggestion"},
  // Appendix B: effecttsgo/catchToIgnore — spec-rule: docs/design/src/900-appendices.md#88202afc8e260289
  {"rule": "docs/design/src/900-appendices.md#88202afc8e260289", "code": "EK3816", "name": "catchToIgnore", "severity": "suggestion"},
  // Appendix B: effecttsgo/catchToOrElseSucceed — spec-rule: docs/design/src/900-appendices.md#0b97cd7784611d0c
  {"rule": "docs/design/src/900-appendices.md#0b97cd7784611d0c", "code": "EK3817", "name": "catchToOrElseSucceed", "severity": "suggestion"},
  // Appendix B: effecttsgo/catchUnfailableEffect — spec-rule: docs/design/src/900-appendices.md#e90f3facf3c4d7ad
  {"rule": "docs/design/src/900-appendices.md#e90f3facf3c4d7ad", "code": "EK3818", "name": "catchUnfailableEffect", "severity": "suggestion"},
  // Appendix B: effecttsgo/classSelfMismatch — spec-rule: docs/design/src/900-appendices.md#eb3c6597d08f107b
  {"rule": "docs/design/src/900-appendices.md#eb3c6597d08f107b", "code": "EK3819", "name": "classSelfMismatch", "severity": "error"},
  // Appendix B: effecttsgo/cryptoRandomUUID — spec-rule: docs/design/src/900-appendices.md#51ec2154639a041f
  {"rule": "docs/design/src/900-appendices.md#51ec2154639a041f", "code": "EK3820", "name": "cryptoRandomUUID", "severity": "off"},
  // Appendix B: effecttsgo/cryptoRandomUUIDInEffect — spec-rule: docs/design/src/900-appendices.md#5dce4053a5721398
  {"rule": "docs/design/src/900-appendices.md#5dce4053a5721398", "code": "EK3821", "name": "cryptoRandomUUIDInEffect", "severity": "off"},
  // Appendix B: effecttsgo/deterministicKeys — spec-rule: docs/design/src/900-appendices.md#3abeea774f3dc731
  {"rule": "docs/design/src/900-appendices.md#3abeea774f3dc731", "code": "EK3822", "name": "deterministicKeys", "severity": "off"},
  // Appendix B: effecttsgo/duplicatePackage — spec-rule: docs/design/src/900-appendices.md#f272892858d8b2c9
  {"rule": "docs/design/src/900-appendices.md#f272892858d8b2c9", "code": "EK3823", "name": "duplicatePackage", "severity": "warning"},
  // Appendix B: effecttsgo/effectDoNotation — spec-rule: docs/design/src/900-appendices.md#ba2f13c34fbd755a
  {"rule": "docs/design/src/900-appendices.md#ba2f13c34fbd755a", "code": "EK3824", "name": "effectDoNotation", "severity": "off"},
  // Appendix B: effecttsgo/effectFnIife — spec-rule: docs/design/src/900-appendices.md#746140bf9ab3ad13
  {"rule": "docs/design/src/900-appendices.md#746140bf9ab3ad13", "code": "EK3825", "name": "effectFnIife", "severity": "warning"},
  // Appendix B: effecttsgo/effectFnImplicitAny — spec-rule: docs/design/src/900-appendices.md#66404a0dc289837d
  {"rule": "docs/design/src/900-appendices.md#66404a0dc289837d", "code": "EK3826", "name": "effectFnImplicitAny", "severity": "error"},
  // Appendix B: effecttsgo/effectFnOpportunity — spec-rule: docs/design/src/900-appendices.md#90e4893ffd3c7076
  {"rule": "docs/design/src/900-appendices.md#90e4893ffd3c7076", "code": "EK3827", "name": "effectFnOpportunity", "severity": "suggestion"},
  // Appendix B: effecttsgo/effectGenUsesAdapter — spec-rule: docs/design/src/900-appendices.md#94aff93668294824
  {"rule": "docs/design/src/900-appendices.md#94aff93668294824", "code": "EK3828", "name": "effectGenUsesAdapter", "severity": "warning"},
  // Appendix B: effecttsgo/effectInFailure — spec-rule: docs/design/src/900-appendices.md#af2935bda2beacaa
  {"rule": "docs/design/src/900-appendices.md#af2935bda2beacaa", "code": "EK3829", "name": "effectInFailure", "severity": "warning"},
  // Appendix B: effecttsgo/effectInVoidSuccess — spec-rule: docs/design/src/900-appendices.md#bdf8fd1693e6cdfa
  {"rule": "docs/design/src/900-appendices.md#bdf8fd1693e6cdfa", "code": "EK3830", "name": "effectInVoidSuccess", "severity": "warning"},
  // Appendix B: effecttsgo/effectMapFlatten — spec-rule: docs/design/src/900-appendices.md#8a46f44155c4bcfa
  {"rule": "docs/design/src/900-appendices.md#8a46f44155c4bcfa", "code": "EK3831", "name": "effectMapFlatten", "severity": "suggestion"},
  // Appendix B: effecttsgo/effectMapVoid — spec-rule: docs/design/src/900-appendices.md#01f70dff4ef8016e
  {"rule": "docs/design/src/900-appendices.md#01f70dff4ef8016e", "code": "EK3832", "name": "effectMapVoid", "severity": "suggestion"},
  // Appendix B: effecttsgo/effectSleepZeroToYieldNow — spec-rule: docs/design/src/900-appendices.md#1c9a9b87fde805df
  {"rule": "docs/design/src/900-appendices.md#1c9a9b87fde805df", "code": "EK3833", "name": "effectSleepZeroToYieldNow", "severity": "suggestion"},
  // Appendix B: effecttsgo/effectSucceedWithVoid — spec-rule: docs/design/src/900-appendices.md#95fbfa820fec35f1
  {"rule": "docs/design/src/900-appendices.md#95fbfa820fec35f1", "code": "EK3834", "name": "effectSucceedWithVoid", "severity": "suggestion"},
  // Appendix B: effecttsgo/errorPayloadShadowsName — spec-rule: docs/design/src/900-appendices.md#3ee67a487014b479
  {"rule": "docs/design/src/900-appendices.md#3ee67a487014b479", "code": "EK3835", "name": "errorPayloadShadowsName", "severity": "suggestion"},
  // Appendix B: effecttsgo/experimentalApiUsage — spec-rule: docs/design/src/900-appendices.md#d2b97d91b76ac1b6
  {"rule": "docs/design/src/900-appendices.md#d2b97d91b76ac1b6", "code": "EK3836", "name": "experimentalApiUsage", "severity": "warning"},
  // Appendix B: effecttsgo/extendsNativeError — spec-rule: docs/design/src/900-appendices.md#c04dd553b52001df
  {"rule": "docs/design/src/900-appendices.md#c04dd553b52001df", "code": "EK3837", "name": "extendsNativeError", "severity": "off"},
  // Appendix B: effecttsgo/flatMapConditionalToFilterOrFail — spec-rule: docs/design/src/900-appendices.md#7c48f98d6d03782c
  {"rule": "docs/design/src/900-appendices.md#7c48f98d6d03782c", "code": "EK3838", "name": "flatMapConditionalToFilterOrFail", "severity": "suggestion"},
  // Appendix B: effecttsgo/flatMapIgnoredParamToAndThen — spec-rule: docs/design/src/900-appendices.md#b20b0d6d358e8cee
  {"rule": "docs/design/src/900-appendices.md#b20b0d6d358e8cee", "code": "EK3839", "name": "flatMapIgnoredParamToAndThen", "severity": "suggestion"},
  // Appendix B: effecttsgo/flatMapToMap — spec-rule: docs/design/src/900-appendices.md#d1b5346d144487b9
  {"rule": "docs/design/src/900-appendices.md#d1b5346d144487b9", "code": "EK3840", "name": "flatMapToMap", "severity": "suggestion"},
  // Appendix B: effecttsgo/flatMapToTap — spec-rule: docs/design/src/900-appendices.md#435287cb8226452e
  {"rule": "docs/design/src/900-appendices.md#435287cb8226452e", "code": "EK3841", "name": "flatMapToTap", "severity": "suggestion"},
  // Appendix B: effecttsgo/floatingEffect — spec-rule: docs/design/src/900-appendices.md#1478ab531b042c01
  {"rule": "docs/design/src/900-appendices.md#1478ab531b042c01", "code": "EK3801", "name": "floatingEffect", "severity": "error"},
  // Appendix B: effecttsgo/floatingEffectInVitest — spec-rule: docs/design/src/900-appendices.md#b7e4be9f5f78fe5e
  {"rule": "docs/design/src/900-appendices.md#b7e4be9f5f78fe5e", "code": "EK3842", "name": "floatingEffectInVitest", "severity": "error"},
  // Appendix B: effecttsgo/genericEffectServices — spec-rule: docs/design/src/900-appendices.md#bd3f4f17c9a85119
  {"rule": "docs/design/src/900-appendices.md#bd3f4f17c9a85119", "code": "EK3843", "name": "genericEffectServices", "severity": "warning"},
  // Appendix B: effecttsgo/globalConsole — spec-rule: docs/design/src/900-appendices.md#783af47df1f2492a
  {"rule": "docs/design/src/900-appendices.md#783af47df1f2492a", "code": "EK3844", "name": "globalConsole", "severity": "off"},
  // Appendix B: effecttsgo/globalConsoleInEffect — spec-rule: docs/design/src/900-appendices.md#64d2d309f993e346
  {"rule": "docs/design/src/900-appendices.md#64d2d309f993e346", "code": "EK3845", "name": "globalConsoleInEffect", "severity": "off"},
  // Appendix B: effecttsgo/globalDate — spec-rule: docs/design/src/900-appendices.md#1562b7be5be04a3b
  {"rule": "docs/design/src/900-appendices.md#1562b7be5be04a3b", "code": "EK3846", "name": "globalDate", "severity": "off"},
  // Appendix B: effecttsgo/globalDateInEffect — spec-rule: docs/design/src/900-appendices.md#5261f02c1809c83f
  {"rule": "docs/design/src/900-appendices.md#5261f02c1809c83f", "code": "EK3847", "name": "globalDateInEffect", "severity": "off"},
  // Appendix B: effecttsgo/globalErrorInEffectCatch — spec-rule: docs/design/src/900-appendices.md#d34465695b343a1e
  {"rule": "docs/design/src/900-appendices.md#d34465695b343a1e", "code": "EK3848", "name": "globalErrorInEffectCatch", "severity": "warning"},
  // Appendix B: effecttsgo/globalErrorInEffectFailure — spec-rule: docs/design/src/900-appendices.md#55854b437360ce4b
  {"rule": "docs/design/src/900-appendices.md#55854b437360ce4b", "code": "EK3849", "name": "globalErrorInEffectFailure", "severity": "warning"},
  // Appendix B: effecttsgo/globalFetch — spec-rule: docs/design/src/900-appendices.md#394f651639589974
  {"rule": "docs/design/src/900-appendices.md#394f651639589974", "code": "EK3850", "name": "globalFetch", "severity": "off"},
  // Appendix B: effecttsgo/globalFetchInEffect — spec-rule: docs/design/src/900-appendices.md#4a2e46260164baf3
  {"rule": "docs/design/src/900-appendices.md#4a2e46260164baf3", "code": "EK3851", "name": "globalFetchInEffect", "severity": "off"},
  // Appendix B: effecttsgo/globalRandom — spec-rule: docs/design/src/900-appendices.md#678d97d374b137e4
  {"rule": "docs/design/src/900-appendices.md#678d97d374b137e4", "code": "EK3852", "name": "globalRandom", "severity": "off"},
  // Appendix B: effecttsgo/globalRandomInEffect — spec-rule: docs/design/src/900-appendices.md#c4f1406a3252ac59
  {"rule": "docs/design/src/900-appendices.md#c4f1406a3252ac59", "code": "EK3853", "name": "globalRandomInEffect", "severity": "off"},
  // Appendix B: effecttsgo/globalTimers — spec-rule: docs/design/src/900-appendices.md#3aff46b5abbbad3d
  {"rule": "docs/design/src/900-appendices.md#3aff46b5abbbad3d", "code": "EK3854", "name": "globalTimers", "severity": "off"},
  // Appendix B: effecttsgo/globalTimersInEffect — spec-rule: docs/design/src/900-appendices.md#2f218a9bc00d1829
  {"rule": "docs/design/src/900-appendices.md#2f218a9bc00d1829", "code": "EK3855", "name": "globalTimersInEffect", "severity": "off"},
  // Appendix B: effecttsgo/instanceOfSchema — spec-rule: docs/design/src/900-appendices.md#bc0647cec005f11f
  {"rule": "docs/design/src/900-appendices.md#bc0647cec005f11f", "code": "EK3856", "name": "instanceOfSchema", "severity": "off"},
  // Appendix B: effecttsgo/layerMergeAllWithDependencies — spec-rule: docs/design/src/900-appendices.md#11884bd4cf0ab720
  {"rule": "docs/design/src/900-appendices.md#11884bd4cf0ab720", "code": "EK3857", "name": "layerMergeAllWithDependencies", "severity": "warning"},
  // Appendix B: effecttsgo/lazyEffect — spec-rule: docs/design/src/900-appendices.md#d69661dd0871e90c
  {"rule": "docs/design/src/900-appendices.md#d69661dd0871e90c", "code": "EK3858", "name": "lazyEffect", "severity": "suggestion"},
  // Appendix B: effecttsgo/lazyPromiseInEffectSync — spec-rule: docs/design/src/900-appendices.md#df969cc96f906fd7
  {"rule": "docs/design/src/900-appendices.md#df969cc96f906fd7", "code": "EK3859", "name": "lazyPromiseInEffectSync", "severity": "warning"},
  // Appendix B: effecttsgo/leakingRequirements — spec-rule: docs/design/src/900-appendices.md#80b75ef802ad4eec
  {"rule": "docs/design/src/900-appendices.md#80b75ef802ad4eec", "code": "EK3860", "name": "leakingRequirements", "severity": "suggestion"},
  // Appendix B: effecttsgo/mapSomeToAsSome — spec-rule: docs/design/src/900-appendices.md#bdf5ca0805e6d230
  {"rule": "docs/design/src/900-appendices.md#bdf5ca0805e6d230", "code": "EK3861", "name": "mapSomeToAsSome", "severity": "suggestion"},
  // Appendix B: effecttsgo/matchEffectToMapBoth — spec-rule: docs/design/src/900-appendices.md#c801e347f2a668bc
  {"rule": "docs/design/src/900-appendices.md#c801e347f2a668bc", "code": "EK3862", "name": "matchEffectToMapBoth", "severity": "suggestion"},
  // Appendix B: effecttsgo/matchEffectToMatch — spec-rule: docs/design/src/900-appendices.md#9af88cbadef73147
  {"rule": "docs/design/src/900-appendices.md#9af88cbadef73147", "code": "EK3863", "name": "matchEffectToMatch", "severity": "suggestion"},
  // Appendix B: effecttsgo/missedPipeableOpportunity — spec-rule: docs/design/src/900-appendices.md#04ac73df8e1c5719
  {"rule": "docs/design/src/900-appendices.md#04ac73df8e1c5719", "code": "EK3864", "name": "missedPipeableOpportunity", "severity": "off"},
]
const { inventory } = generateLintCodes()
const declared = readFileSync(new URL("../../typescript/tsc/internal/core/vibe_lint_codes.go", import.meta.url), "utf8")
const registry = new Map([...declared.matchAll(/"(EK38[0-9]+)":\s*"([^"]+)"/g)].map(m => [m[1], m[2]]))

for (const row of rows) {
  test("Appendix B: " + row.name + " (" + row.rule + ")", () => {
    assert.equal(registry.get(row.code), row.name, "compiler's public code must name this upstream rule")
    const actual = inventory.rules.find(r => r.rule === row.name)
    assert.ok(actual, "rule must still be registered upstream")
    assert.equal(actual.code, row.code, "public code allocation")
    assert.equal(actual.defaultSeverity, row.severity, "upstream default severity")
  })
}
