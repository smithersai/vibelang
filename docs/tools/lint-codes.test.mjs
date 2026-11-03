// Coverage census: VIP-34 imported ordinal capacity; VIP-38 pin, allocation, stability and defaults.
// VIP-34 imported lint inventory: docs/design/vips/0034-compiler-and-tooling.md#23cadda0a179b6c2
// VIP-34 imported lint inventory: docs/design/vips/0034-compiler-and-tooling.md#b26c0ab72b154aca
// VIP-34 imported lint inventory: docs/design/vips/0034-compiler-and-tooling.md#d565e67a60b0f782
// VIP-34 imported lint inventory: docs/design/vips/0034-compiler-and-tooling.md#d6faf3c867f789ef
// VIP-34 imported lint inventory: docs/design/vips/0034-compiler-and-tooling.md#0daf676a07d3c935
// VIP-34 imported lint inventory: docs/design/vips/0034-compiler-and-tooling.md#8b0c1c5a3667a2a3
// VIP-38 imported lint inventory: docs/design/vips/0038-effect-lint-built-in.md#b29c56d7be52230c
// VIP-38 imported lint inventory: docs/design/vips/0038-effect-lint-built-in.md#b4cc87fd14a8294f
// VIP-38 imported lint inventory: docs/design/vips/0038-effect-lint-built-in.md#8525176f19672471
// VIP-38 imported lint inventory: docs/design/vips/0038-effect-lint-built-in.md#fc43143e0c4b5c40
// VIP-38 imported lint inventory: docs/design/vips/0038-effect-lint-built-in.md#68ea86c2cc2000d3
// VIP-38 imported lint inventory: docs/design/vips/0038-effect-lint-built-in.md#a4ea1312c1e4778a
// VIP-38 imported lint inventory: docs/design/vips/0038-effect-lint-built-in.md#dca02d668ed687b3
// VIP-38 imported lint inventory: docs/design/vips/0038-effect-lint-built-in.md#de4022c33b6d6263
// VIP-38 imported lint inventory: docs/design/vips/0038-effect-lint-built-in.md#d08f8b73b37e7b6d
// VIP-38 imported lint inventory: docs/design/vips/0038-effect-lint-built-in.md#898b69313b3613a3
// VIP-38 imported lint inventory: docs/design/vips/0038-effect-lint-built-in.md#e7727055c78c3d31
// VIP-38 imported lint inventory: docs/design/vips/0038-effect-lint-built-in.md#2224eca2d5e56fc9
// VIP-38 imported lint inventory: docs/design/vips/0038-effect-lint-built-in.md#d5b598b121eeacc0
// VIP-38 imported lint inventory: docs/design/vips/0038-effect-lint-built-in.md#a2f7dc2b815ae5b5
// VIP-38 imported lint inventory: docs/design/vips/0038-effect-lint-built-in.md#b2b3e9d66ecc22a8
// VIP-38 imported lint inventory: docs/design/vips/0038-effect-lint-built-in.md#c97c428178b550e5
import assert from "node:assert/strict"
import fc from "fast-check"
import { test } from "node:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { root, lintOutputs, assignCodes, generateLintCodes } from "./lint-codes.mjs"

test("the pinned imported lint inventory and both rendered tables are current", () => {
  for (const [path, expected] of lintOutputs()) {
    assert.equal(readFileSync(resolve(root, path), "utf8"), expected, path + " is stale; run node docs/tools/lint-codes.mjs --write")
    if (path.endsWith(".md")) assert.doesNotMatch(expected, /The generated table is not yet published|table goes here with that pin|how ordinals past 99 are spelled/, path + " still has an obsolete lint-table placeholder")
  }
})
test("new alphabetical predecessors append, and removed codes remain reserved", () => {
  const first = assignCodes(["zebra", "middle"])
  assert.deepEqual(first, { floatingEffect: "EK3801", middle: "EK3802", zebra: "EK3803" })
  const next = assignCodes(["aardvark", "zebra"], first)
  assert.deepEqual(next, { floatingEffect: "EK3801", middle: "EK3802", zebra: "EK3803", aardvark: "EK3804" })
  assert.equal(assignCodes(["middle"], next).middle, first.middle)
  assert.throws(() => assignCodes([], { a: "EK3801", b: "EK3801" }), /duplicate/)
})
// docs/design/src/900-appendices.md#eb73fb77849128fd — Chapter 900: imported floatingEffect has one pinned EK3801 identity.
test("the EK38 namespace accommodates the complete upstream registry", () => {
  const codes = assignCodes(Array.from({ length: 130 }, (_, i) => String(i).padStart(3, "0")))
  assert.equal(codes["098"], "EK38100")
  assert.throws(() => assignCodes([], { floatingEffect: "EK3841" }), /retain EK3801/)
  const { inventory } = generateLintCodes()
  assert.ok(inventory.rules.length >= 130)
  assert.equal(inventory.upstream.tag, "@effect/tsgo@0.57.0")
  assert.equal(inventory.rules.find(r => r.rule === "floatingEffect").defaultSeverity, "error")
  assert.equal(inventory.rules.find(r => r.rule === "floatingEffect").code, "EK3801")
  assert.equal(inventory.rules.find(r => r.rule === "abortControllerInEffect").code, "EK3802")
  assert.equal(inventory.rules.find(r => r.rule === "acquireReleaseDisposable").code, "EK3803")
  assert.equal(new Set(inventory.rules.map(r => r.code)).size, inventory.rules.length)
})

// Chapter 007 / lint registry effecttsgo/abortControllerInEffect: docs/design/src/007-tooling.md#07c670919e0d545e
// Chapter 007 / lint registry effecttsgo/acquireReleaseDisposable: docs/design/src/007-tooling.md#95647d70273f15ea
// Chapter 007 / lint registry effecttsgo/allOfMapToForEach: docs/design/src/007-tooling.md#426ef6ccb3073ae0
// Chapter 007 / lint registry effecttsgo/anyUnknownInErrorContext: docs/design/src/007-tooling.md#f75626a1feb396ac
// Chapter 007 / lint registry effecttsgo/apiStabilityLeak: docs/design/src/007-tooling.md#ec9d1d67597f4a1e
// Chapter 007 / lint registry effecttsgo/asyncFunction: docs/design/src/007-tooling.md#b68a2a7937435a32
// Chapter 007 / lint registry effecttsgo/catchAllTagDispatchToCatchTag: docs/design/src/007-tooling.md#bfb9cfa7f80a3809
// Chapter 007 / lint registry effecttsgo/catchAllToMapError: docs/design/src/007-tooling.md#3a9fff931541ba5b
// Chapter 007 / lint registry effecttsgo/catchChainToFirstSuccessOf: docs/design/src/007-tooling.md#0dd6c2d710523b41
// Chapter 007 / lint registry effecttsgo/catchConditionalRefailToCatchIf: docs/design/src/007-tooling.md#68251131561517d4
// Chapter 007 / lint registry effecttsgo/catchDieToOrDie: docs/design/src/007-tooling.md#82e3f13dfcf1cefd
// Chapter 007 / lint registry effecttsgo/catchIfTagToCatchTag: docs/design/src/007-tooling.md#dfb72a02b59b7509
// Chapter 007 / lint registry effecttsgo/catchRefailToTapError: docs/design/src/007-tooling.md#3a887a2117566fed
// Chapter 007 / lint registry effecttsgo/catchTagToCatchReason: docs/design/src/007-tooling.md#78584bc38dd47069
// Chapter 007 / lint registry effecttsgo/catchToIgnore: docs/design/src/007-tooling.md#88202afc8e260289
// Chapter 007 / lint registry effecttsgo/catchToOrElseSucceed: docs/design/src/007-tooling.md#0b97cd7784611d0c
// Chapter 007 / lint registry effecttsgo/catchUnfailableEffect: docs/design/src/007-tooling.md#e90f3facf3c4d7ad
// Chapter 007 / lint registry effecttsgo/classSelfMismatch: docs/design/src/007-tooling.md#eb3c6597d08f107b
// Chapter 007 / lint registry effecttsgo/cryptoRandomUUID: docs/design/src/007-tooling.md#51ec2154639a041f
// Chapter 007 / lint registry effecttsgo/cryptoRandomUUIDInEffect: docs/design/src/007-tooling.md#5dce4053a5721398
// Chapter 007 / lint registry effecttsgo/deterministicKeys: docs/design/src/007-tooling.md#3abeea774f3dc731
// Chapter 007 / lint registry effecttsgo/duplicatePackage: docs/design/src/007-tooling.md#f272892858d8b2c9
// Chapter 007 / lint registry effecttsgo/effectDoNotation: docs/design/src/007-tooling.md#ba2f13c34fbd755a
// Chapter 007 / lint registry effecttsgo/effectFnIife: docs/design/src/007-tooling.md#746140bf9ab3ad13
// Chapter 007 / lint registry effecttsgo/effectFnImplicitAny: docs/design/src/007-tooling.md#66404a0dc289837d
// Chapter 007 / lint registry effecttsgo/effectFnOpportunity: docs/design/src/007-tooling.md#90e4893ffd3c7076
// Chapter 007 / lint registry effecttsgo/effectGenUsesAdapter: docs/design/src/007-tooling.md#94aff93668294824
// Chapter 007 / lint registry effecttsgo/effectInFailure: docs/design/src/007-tooling.md#af2935bda2beacaa
// Chapter 007 / lint registry effecttsgo/effectInVoidSuccess: docs/design/src/007-tooling.md#bdf8fd1693e6cdfa
// Chapter 007 / lint registry effecttsgo/effectMapFlatten: docs/design/src/007-tooling.md#8a46f44155c4bcfa
// Chapter 007 / lint registry effecttsgo/effectMapVoid: docs/design/src/007-tooling.md#01f70dff4ef8016e
// Chapter 007 / lint registry effecttsgo/effectSleepZeroToYieldNow: docs/design/src/007-tooling.md#1c9a9b87fde805df
// Chapter 007 / lint registry effecttsgo/effectSucceedWithVoid: docs/design/src/007-tooling.md#95fbfa820fec35f1
// Chapter 007 / lint registry effecttsgo/errorPayloadShadowsName: docs/design/src/007-tooling.md#3ee67a487014b479
// Chapter 007 / lint registry effecttsgo/experimentalApiUsage: docs/design/src/007-tooling.md#d2b97d91b76ac1b6
// Chapter 007 / lint registry effecttsgo/extendsNativeError: docs/design/src/007-tooling.md#c04dd553b52001df
// Chapter 007 / lint registry effecttsgo/flatMapConditionalToFilterOrFail: docs/design/src/007-tooling.md#7c48f98d6d03782c
// Chapter 007 / lint registry effecttsgo/flatMapIgnoredParamToAndThen: docs/design/src/007-tooling.md#b20b0d6d358e8cee
// Chapter 007 / lint registry effecttsgo/flatMapToMap: docs/design/src/007-tooling.md#d1b5346d144487b9
// Chapter 007 / lint registry effecttsgo/flatMapToTap: docs/design/src/007-tooling.md#435287cb8226452e
// Chapter 007 / lint registry effecttsgo/floatingEffect: docs/design/src/007-tooling.md#1478ab531b042c01
// Chapter 007 / lint registry effecttsgo/floatingEffectInVitest: docs/design/src/007-tooling.md#b7e4be9f5f78fe5e
// Chapter 007 / lint registry effecttsgo/genericEffectServices: docs/design/src/007-tooling.md#bd3f4f17c9a85119
// Chapter 007 / lint registry effecttsgo/globalConsole: docs/design/src/007-tooling.md#783af47df1f2492a
// Chapter 007 / lint registry effecttsgo/globalConsoleInEffect: docs/design/src/007-tooling.md#64d2d309f993e346
// Chapter 007 / lint registry effecttsgo/globalDate: docs/design/src/007-tooling.md#1562b7be5be04a3b
// Chapter 007 / lint registry effecttsgo/globalDateInEffect: docs/design/src/007-tooling.md#5261f02c1809c83f
// Chapter 007 / lint registry effecttsgo/globalErrorInEffectCatch: docs/design/src/007-tooling.md#d34465695b343a1e
// Chapter 007 / lint registry effecttsgo/globalErrorInEffectFailure: docs/design/src/007-tooling.md#55854b437360ce4b
// Chapter 007 / lint registry effecttsgo/globalFetch: docs/design/src/007-tooling.md#394f651639589974
// Chapter 007 / lint registry effecttsgo/globalFetchInEffect: docs/design/src/007-tooling.md#4a2e46260164baf3
// Chapter 007 / lint registry effecttsgo/globalRandom: docs/design/src/007-tooling.md#678d97d374b137e4
// Chapter 007 / lint registry effecttsgo/globalRandomInEffect: docs/design/src/007-tooling.md#c4f1406a3252ac59
// Chapter 007 / lint registry effecttsgo/globalTimers: docs/design/src/007-tooling.md#3aff46b5abbbad3d
// Chapter 007 / lint registry effecttsgo/globalTimersInEffect: docs/design/src/007-tooling.md#2f218a9bc00d1829
// Chapter 007 / lint registry effecttsgo/instanceOfSchema: docs/design/src/007-tooling.md#bc0647cec005f11f
// Chapter 007 / lint registry effecttsgo/layerMergeAllWithDependencies: docs/design/src/007-tooling.md#11884bd4cf0ab720
// Chapter 007 / lint registry effecttsgo/lazyEffect: docs/design/src/007-tooling.md#d69661dd0871e90c
// Chapter 007 / lint registry effecttsgo/lazyPromiseInEffectSync: docs/design/src/007-tooling.md#df969cc96f906fd7
// Chapter 007 / lint registry effecttsgo/leakingRequirements: docs/design/src/007-tooling.md#80b75ef802ad4eec
// Chapter 007 / lint registry effecttsgo/mapSomeToAsSome: docs/design/src/007-tooling.md#bdf5ca0805e6d230
// Chapter 007 / lint registry effecttsgo/matchEffectToMapBoth: docs/design/src/007-tooling.md#c801e347f2a668bc
// Chapter 007 / lint registry effecttsgo/matchEffectToMatch: docs/design/src/007-tooling.md#9af88cbadef73147
// Chapter 007 / lint registry effecttsgo/missedPipeableOpportunity: docs/design/src/007-tooling.md#04ac73df8e1c5719
// Chapter 007 / lint registry effecttsgo/missingEffectContext: docs/design/src/007-tooling.md#aef283819725219e
// Chapter 007 / lint registry effecttsgo/missingEffectError: docs/design/src/007-tooling.md#0983eb1f3d014264
// Chapter 007 / lint registry effecttsgo/missingEffectServiceDependency: docs/design/src/007-tooling.md#8e62b230b7e12192
// Chapter 007 / lint registry effecttsgo/missingLayerContext: docs/design/src/007-tooling.md#f7c22f9aa68806aa
// Chapter 007 / lint registry effecttsgo/missingPipeableSignature: docs/design/src/007-tooling.md#f31a03c8a9ca8265
// Chapter 007 / lint registry effecttsgo/missingReturnYieldStar: docs/design/src/007-tooling.md#498bef9ea29a7819
// Chapter 007 / lint registry effecttsgo/missingStarInYieldEffectGen: docs/design/src/007-tooling.md#c51534de459a38a7
// Chapter 007 / lint registry effecttsgo/multipleCatchTag: docs/design/src/007-tooling.md#f019ced59e0f5e74
// Chapter 007 / lint registry effecttsgo/multipleEffectProvide: docs/design/src/007-tooling.md#77d2a0b8bea9a153
// Chapter 007 / lint registry effecttsgo/nestedEffectGenYield: docs/design/src/007-tooling.md#7d364863969f0432
// Chapter 007 / lint registry effecttsgo/newPromise: docs/design/src/007-tooling.md#863693d6f1edbd04
// Chapter 007 / lint registry effecttsgo/newSchemaClass: docs/design/src/007-tooling.md#92241e499d882c3d
// Chapter 007 / lint registry effecttsgo/nodeBuiltinImport: docs/design/src/007-tooling.md#b0cc92fb9591f313
// Chapter 007 / lint registry effecttsgo/nonObjectEffectServiceType: docs/design/src/007-tooling.md#fda5e60cd8604d25
// Chapter 007 / lint registry effecttsgo/obsoleteMatchImport: docs/design/src/007-tooling.md#c4bb22937affaaf4
// Chapter 007 / lint registry effecttsgo/obsoleteSchemaImport: docs/design/src/007-tooling.md#386197ad7aa59bbb
// Chapter 007 / lint registry effecttsgo/abortControllerInEffect: docs/design/src/007-tooling.md#07c670919e0d545e
// Chapter 007 / lint registry effecttsgo/acquireReleaseDisposable: docs/design/src/007-tooling.md#95647d70273f15ea
// Chapter 007 / lint registry effecttsgo/allOfMapToForEach: docs/design/src/007-tooling.md#426ef6ccb3073ae0
// Chapter 007 / lint registry effecttsgo/anyUnknownInErrorContext: docs/design/src/007-tooling.md#f75626a1feb396ac
// Chapter 007 / lint registry effecttsgo/apiStabilityLeak: docs/design/src/007-tooling.md#ec9d1d67597f4a1e
// Chapter 007 / lint registry effecttsgo/asyncFunction: docs/design/src/007-tooling.md#b68a2a7937435a32
// Chapter 007 / lint registry effecttsgo/catchAllTagDispatchToCatchTag: docs/design/src/007-tooling.md#bfb9cfa7f80a3809
// Chapter 007 / lint registry effecttsgo/catchAllToMapError: docs/design/src/007-tooling.md#3a9fff931541ba5b
// Chapter 007 / lint registry effecttsgo/catchChainToFirstSuccessOf: docs/design/src/007-tooling.md#0dd6c2d710523b41
// Chapter 007 / lint registry effecttsgo/catchConditionalRefailToCatchIf: docs/design/src/007-tooling.md#68251131561517d4
// Chapter 007 / lint registry effecttsgo/catchDieToOrDie: docs/design/src/007-tooling.md#82e3f13dfcf1cefd
// Chapter 007 / lint registry effecttsgo/catchIfTagToCatchTag: docs/design/src/007-tooling.md#dfb72a02b59b7509
// Chapter 007 / lint registry effecttsgo/catchRefailToTapError: docs/design/src/007-tooling.md#3a887a2117566fed
// Chapter 007 / lint registry effecttsgo/catchTagToCatchReason: docs/design/src/007-tooling.md#78584bc38dd47069
// Chapter 007 / lint registry effecttsgo/catchToIgnore: docs/design/src/007-tooling.md#88202afc8e260289
// Chapter 007 / lint registry effecttsgo/catchToOrElseSucceed: docs/design/src/007-tooling.md#0b97cd7784611d0c
// Chapter 007 / lint registry effecttsgo/catchUnfailableEffect: docs/design/src/007-tooling.md#e90f3facf3c4d7ad
// Chapter 007 / lint registry effecttsgo/classSelfMismatch: docs/design/src/007-tooling.md#eb3c6597d08f107b
// Chapter 007 / lint registry effecttsgo/cryptoRandomUUID: docs/design/src/007-tooling.md#51ec2154639a041f
// Chapter 007 / lint registry effecttsgo/cryptoRandomUUIDInEffect: docs/design/src/007-tooling.md#5dce4053a5721398
// Chapter 007 / lint registry effecttsgo/deterministicKeys: docs/design/src/007-tooling.md#3abeea774f3dc731
// Chapter 007 / lint registry effecttsgo/duplicatePackage: docs/design/src/007-tooling.md#f272892858d8b2c9
// Chapter 007 / lint registry effecttsgo/effectDoNotation: docs/design/src/007-tooling.md#ba2f13c34fbd755a
// Chapter 007 / lint registry effecttsgo/effectFnIife: docs/design/src/007-tooling.md#746140bf9ab3ad13
// Chapter 007 / lint registry effecttsgo/effectFnImplicitAny: docs/design/src/007-tooling.md#66404a0dc289837d
// Chapter 007 / lint registry effecttsgo/effectFnOpportunity: docs/design/src/007-tooling.md#90e4893ffd3c7076
// Chapter 007 / lint registry effecttsgo/effectGenUsesAdapter: docs/design/src/007-tooling.md#94aff93668294824
// Chapter 007 / lint registry effecttsgo/effectInFailure: docs/design/src/007-tooling.md#af2935bda2beacaa
// Chapter 007 / lint registry effecttsgo/effectInVoidSuccess: docs/design/src/007-tooling.md#bdf8fd1693e6cdfa
// Chapter 007 / lint registry effecttsgo/effectMapFlatten: docs/design/src/007-tooling.md#8a46f44155c4bcfa
// Chapter 007 / lint registry effecttsgo/effectMapVoid: docs/design/src/007-tooling.md#01f70dff4ef8016e
// Chapter 007 / lint registry effecttsgo/effectSleepZeroToYieldNow: docs/design/src/007-tooling.md#1c9a9b87fde805df
// Chapter 007 / lint registry effecttsgo/effectSucceedWithVoid: docs/design/src/007-tooling.md#95fbfa820fec35f1
// Chapter 007 / lint registry effecttsgo/errorPayloadShadowsName: docs/design/src/007-tooling.md#3ee67a487014b479
// Chapter 007 / lint registry effecttsgo/experimentalApiUsage: docs/design/src/007-tooling.md#d2b97d91b76ac1b6
// Chapter 007 / lint registry effecttsgo/extendsNativeError: docs/design/src/007-tooling.md#c04dd553b52001df
// Chapter 007 / lint registry effecttsgo/flatMapConditionalToFilterOrFail: docs/design/src/007-tooling.md#7c48f98d6d03782c
// Chapter 007 / lint registry effecttsgo/flatMapIgnoredParamToAndThen: docs/design/src/007-tooling.md#b20b0d6d358e8cee
// Chapter 007 / lint registry effecttsgo/flatMapToMap: docs/design/src/007-tooling.md#d1b5346d144487b9
// Chapter 007 / lint registry effecttsgo/flatMapToTap: docs/design/src/007-tooling.md#435287cb8226452e
// Chapter 007 / lint registry effecttsgo/abortControllerInEffect: docs/design/src/007-tooling.md#07c670919e0d545e
// Chapter 007 / lint registry effecttsgo/acquireReleaseDisposable: docs/design/src/007-tooling.md#95647d70273f15ea
// Chapter 007 / lint registry effecttsgo/allOfMapToForEach: docs/design/src/007-tooling.md#426ef6ccb3073ae0
// Chapter 007 / lint registry effecttsgo/anyUnknownInErrorContext: docs/design/src/007-tooling.md#f75626a1feb396ac
// Chapter 007 / lint registry effecttsgo/apiStabilityLeak: docs/design/src/007-tooling.md#ec9d1d67597f4a1e
// Chapter 007 / lint registry effecttsgo/asyncFunction: docs/design/src/007-tooling.md#b68a2a7937435a32
// Chapter 007 / lint registry effecttsgo/catchAllTagDispatchToCatchTag: docs/design/src/007-tooling.md#bfb9cfa7f80a3809
// Chapter 007 / lint registry effecttsgo/catchAllToMapError: docs/design/src/007-tooling.md#3a9fff931541ba5b
// Chapter 007 / lint registry effecttsgo/catchChainToFirstSuccessOf: docs/design/src/007-tooling.md#0dd6c2d710523b41
// Chapter 007 / lint registry effecttsgo/catchConditionalRefailToCatchIf: docs/design/src/007-tooling.md#68251131561517d4
// Chapter 007 / lint registry effecttsgo/catchDieToOrDie: docs/design/src/007-tooling.md#82e3f13dfcf1cefd
// Chapter 007 / lint registry effecttsgo/catchIfTagToCatchTag: docs/design/src/007-tooling.md#dfb72a02b59b7509
// Chapter 007 / lint registry effecttsgo/catchRefailToTapError: docs/design/src/007-tooling.md#3a887a2117566fed
// Chapter 007 / lint registry effecttsgo/catchTagToCatchReason: docs/design/src/007-tooling.md#78584bc38dd47069
// Chapter 007 / lint registry effecttsgo/catchToIgnore: docs/design/src/007-tooling.md#88202afc8e260289
// Chapter 007 / lint registry effecttsgo/catchToOrElseSucceed: docs/design/src/007-tooling.md#0b97cd7784611d0c
// Chapter 007 / lint registry effecttsgo/catchUnfailableEffect: docs/design/src/007-tooling.md#e90f3facf3c4d7ad
// Chapter 007 / lint registry effecttsgo/classSelfMismatch: docs/design/src/007-tooling.md#eb3c6597d08f107b
// Chapter 007 / lint registry effecttsgo/cryptoRandomUUID: docs/design/src/007-tooling.md#51ec2154639a041f
// Chapter 007 / lint registry effecttsgo/cryptoRandomUUIDInEffect: docs/design/src/007-tooling.md#5dce4053a5721398
// Chapter 007 / lint registry effecttsgo/deterministicKeys: docs/design/src/007-tooling.md#3abeea774f3dc731
// Chapter 007 / lint registry effecttsgo/duplicatePackage: docs/design/src/007-tooling.md#f272892858d8b2c9
// Chapter 007 / lint registry effecttsgo/effectDoNotation: docs/design/src/007-tooling.md#ba2f13c34fbd755a
// Chapter 007 / lint registry effecttsgo/effectFnIife: docs/design/src/007-tooling.md#746140bf9ab3ad13
// Chapter 007 / lint registry effecttsgo/effectFnImplicitAny: docs/design/src/007-tooling.md#66404a0dc289837d
// Chapter 007 / lint registry effecttsgo/effectFnOpportunity: docs/design/src/007-tooling.md#90e4893ffd3c7076
// Chapter 007 / lint registry effecttsgo/effectGenUsesAdapter: docs/design/src/007-tooling.md#94aff93668294824
// Chapter 007 / lint registry effecttsgo/effectInFailure: docs/design/src/007-tooling.md#af2935bda2beacaa
// Chapter 007 / lint registry effecttsgo/effectInVoidSuccess: docs/design/src/007-tooling.md#bdf8fd1693e6cdfa
// Chapter 007 / lint registry effecttsgo/effectMapFlatten: docs/design/src/007-tooling.md#8a46f44155c4bcfa
// Chapter 007 / lint registry effecttsgo/effectMapVoid: docs/design/src/007-tooling.md#01f70dff4ef8016e
// Chapter 007 / lint registry effecttsgo/effectSleepZeroToYieldNow: docs/design/src/007-tooling.md#1c9a9b87fde805df
// Chapter 007 / lint registry effecttsgo/effectSucceedWithVoid: docs/design/src/007-tooling.md#95fbfa820fec35f1
// Chapter 007 / lint registry effecttsgo/errorPayloadShadowsName: docs/design/src/007-tooling.md#3ee67a487014b479
// Chapter 007 / lint registry effecttsgo/experimentalApiUsage: docs/design/src/007-tooling.md#d2b97d91b76ac1b6
// Chapter 007 / lint registry effecttsgo/extendsNativeError: docs/design/src/007-tooling.md#c04dd553b52001df
// Chapter 007 / lint registry effecttsgo/flatMapConditionalToFilterOrFail: docs/design/src/007-tooling.md#7c48f98d6d03782c
// Chapter 007 / lint registry effecttsgo/flatMapIgnoredParamToAndThen: docs/design/src/007-tooling.md#b20b0d6d358e8cee
// Chapter 007 / lint registry effecttsgo/flatMapToMap: docs/design/src/007-tooling.md#d1b5346d144487b9
// Chapter 007 / lint registry effecttsgo/flatMapToTap: docs/design/src/007-tooling.md#435287cb8226452e
// Chapter 007 / lint registry effecttsgo/floatingEffect: docs/design/src/007-tooling.md#1478ab531b042c01
// Chapter 007 / lint registry effecttsgo/floatingEffectInVitest: docs/design/src/007-tooling.md#b7e4be9f5f78fe5e
// Chapter 007 / lint registry effecttsgo/genericEffectServices: docs/design/src/007-tooling.md#bd3f4f17c9a85119
// Chapter 007 / lint registry effecttsgo/globalConsole: docs/design/src/007-tooling.md#783af47df1f2492a
// Chapter 007 / lint registry effecttsgo/globalConsoleInEffect: docs/design/src/007-tooling.md#64d2d309f993e346
// Chapter 007 / lint registry effecttsgo/globalDate: docs/design/src/007-tooling.md#1562b7be5be04a3b
// Chapter 007 / lint registry effecttsgo/globalDateInEffect: docs/design/src/007-tooling.md#5261f02c1809c83f
// Chapter 007 / lint registry effecttsgo/globalErrorInEffectCatch: docs/design/src/007-tooling.md#d34465695b343a1e
// Chapter 007 / lint registry effecttsgo/globalErrorInEffectFailure: docs/design/src/007-tooling.md#55854b437360ce4b
// Chapter 007 / lint registry effecttsgo/globalFetch: docs/design/src/007-tooling.md#394f651639589974
// Chapter 007 / lint registry effecttsgo/globalFetchInEffect: docs/design/src/007-tooling.md#4a2e46260164baf3
// Chapter 007 / lint registry effecttsgo/globalRandom: docs/design/src/007-tooling.md#678d97d374b137e4
// Chapter 007 / lint registry effecttsgo/globalRandomInEffect: docs/design/src/007-tooling.md#c4f1406a3252ac59
// Chapter 007 / lint registry effecttsgo/globalTimers: docs/design/src/007-tooling.md#3aff46b5abbbad3d
// Chapter 007 / lint registry effecttsgo/globalTimersInEffect: docs/design/src/007-tooling.md#2f218a9bc00d1829
// Chapter 007 / lint registry effecttsgo/instanceOfSchema: docs/design/src/007-tooling.md#bc0647cec005f11f
// Chapter 007 / lint registry effecttsgo/layerMergeAllWithDependencies: docs/design/src/007-tooling.md#11884bd4cf0ab720
// Chapter 007 / lint registry effecttsgo/lazyEffect: docs/design/src/007-tooling.md#d69661dd0871e90c
// Chapter 007 / lint registry effecttsgo/lazyPromiseInEffectSync: docs/design/src/007-tooling.md#df969cc96f906fd7
// Chapter 007 / lint registry effecttsgo/leakingRequirements: docs/design/src/007-tooling.md#80b75ef802ad4eec
// Chapter 007 / lint registry effecttsgo/mapSomeToAsSome: docs/design/src/007-tooling.md#bdf5ca0805e6d230
// Chapter 007 / lint registry effecttsgo/matchEffectToMapBoth: docs/design/src/007-tooling.md#c801e347f2a668bc
// Chapter 007 / lint registry effecttsgo/matchEffectToMatch: docs/design/src/007-tooling.md#9af88cbadef73147
// Chapter 007 / lint registry effecttsgo/missedPipeableOpportunity: docs/design/src/007-tooling.md#04ac73df8e1c5719
// Chapter 007 / lint registry effecttsgo/missingEffectContext: docs/design/src/007-tooling.md#aef283819725219e
// Chapter 007 / lint registry effecttsgo/missingEffectError: docs/design/src/007-tooling.md#0983eb1f3d014264
// Chapter 007 / lint registry effecttsgo/missingEffectServiceDependency: docs/design/src/007-tooling.md#8e62b230b7e12192
// Chapter 007 / lint registry effecttsgo/missingLayerContext: docs/design/src/007-tooling.md#f7c22f9aa68806aa
// Chapter 007 / lint registry effecttsgo/missingPipeableSignature: docs/design/src/007-tooling.md#f31a03c8a9ca8265
// Chapter 007 / lint registry effecttsgo/missingReturnYieldStar: docs/design/src/007-tooling.md#498bef9ea29a7819
// Chapter 007 / lint registry effecttsgo/missingStarInYieldEffectGen: docs/design/src/007-tooling.md#c51534de459a38a7
// Chapter 007 / lint registry effecttsgo/multipleCatchTag: docs/design/src/007-tooling.md#f019ced59e0f5e74
// Chapter 007 / lint registry effecttsgo/multipleEffectProvide: docs/design/src/007-tooling.md#77d2a0b8bea9a153
// Chapter 007 / lint registry effecttsgo/nestedEffectGenYield: docs/design/src/007-tooling.md#7d364863969f0432
// Chapter 007 / lint registry effecttsgo/newPromise: docs/design/src/007-tooling.md#863693d6f1edbd04
// Chapter 007 / lint registry effecttsgo/newSchemaClass: docs/design/src/007-tooling.md#92241e499d882c3d
// Chapter 007 / lint registry effecttsgo/nodeBuiltinImport: docs/design/src/007-tooling.md#b0cc92fb9591f313
// Chapter 007 / lint registry effecttsgo/nonObjectEffectServiceType: docs/design/src/007-tooling.md#fda5e60cd8604d25
// Chapter 007 / lint registry effecttsgo/obsoleteMatchImport: docs/design/src/007-tooling.md#c4bb22937affaaf4
// Chapter 007 / lint registry effecttsgo/obsoleteSchemaImport: docs/design/src/007-tooling.md#386197ad7aa59bbb
// Chapter 007 / lint registry effecttsgo/abortControllerInEffect: docs/design/src/007-tooling.md#07c670919e0d545e
// Chapter 007 / lint registry effecttsgo/acquireReleaseDisposable: docs/design/src/007-tooling.md#95647d70273f15ea
// Chapter 007 / lint registry effecttsgo/allOfMapToForEach: docs/design/src/007-tooling.md#426ef6ccb3073ae0
// Chapter 007 / lint registry effecttsgo/anyUnknownInErrorContext: docs/design/src/007-tooling.md#f75626a1feb396ac
// Chapter 007 / lint registry effecttsgo/apiStabilityLeak: docs/design/src/007-tooling.md#ec9d1d67597f4a1e
// Chapter 007 / lint registry effecttsgo/asyncFunction: docs/design/src/007-tooling.md#b68a2a7937435a32
// Chapter 007 / lint registry effecttsgo/catchAllTagDispatchToCatchTag: docs/design/src/007-tooling.md#bfb9cfa7f80a3809
// Chapter 007 / lint registry effecttsgo/catchAllToMapError: docs/design/src/007-tooling.md#3a9fff931541ba5b
// Chapter 007 / lint registry effecttsgo/catchChainToFirstSuccessOf: docs/design/src/007-tooling.md#0dd6c2d710523b41
// Chapter 007 / lint registry effecttsgo/catchConditionalRefailToCatchIf: docs/design/src/007-tooling.md#68251131561517d4
// Chapter 007 / lint registry effecttsgo/catchDieToOrDie: docs/design/src/007-tooling.md#82e3f13dfcf1cefd
// Chapter 007 / lint registry effecttsgo/catchIfTagToCatchTag: docs/design/src/007-tooling.md#dfb72a02b59b7509
// Chapter 007 / lint registry effecttsgo/catchRefailToTapError: docs/design/src/007-tooling.md#3a887a2117566fed
// Chapter 007 / lint registry effecttsgo/catchTagToCatchReason: docs/design/src/007-tooling.md#78584bc38dd47069
// Chapter 007 / lint registry effecttsgo/catchToIgnore: docs/design/src/007-tooling.md#88202afc8e260289
// Chapter 007 / lint registry effecttsgo/catchToOrElseSucceed: docs/design/src/007-tooling.md#0b97cd7784611d0c
// Chapter 007 / lint registry effecttsgo/catchUnfailableEffect: docs/design/src/007-tooling.md#e90f3facf3c4d7ad
// Chapter 007 / lint registry effecttsgo/classSelfMismatch: docs/design/src/007-tooling.md#eb3c6597d08f107b
// Chapter 007 / lint registry effecttsgo/cryptoRandomUUID: docs/design/src/007-tooling.md#51ec2154639a041f
// Chapter 007 / lint registry effecttsgo/cryptoRandomUUIDInEffect: docs/design/src/007-tooling.md#5dce4053a5721398
// Chapter 007 / lint registry effecttsgo/deterministicKeys: docs/design/src/007-tooling.md#3abeea774f3dc731
// Chapter 007 / lint registry effecttsgo/duplicatePackage: docs/design/src/007-tooling.md#f272892858d8b2c9
// Chapter 007 / lint registry effecttsgo/effectDoNotation: docs/design/src/007-tooling.md#ba2f13c34fbd755a
// Chapter 007 / lint registry effecttsgo/effectFnIife: docs/design/src/007-tooling.md#746140bf9ab3ad13
// Chapter 007 / lint registry effecttsgo/effectFnImplicitAny: docs/design/src/007-tooling.md#66404a0dc289837d
// Chapter 007 / lint registry effecttsgo/effectFnOpportunity: docs/design/src/007-tooling.md#90e4893ffd3c7076
// Chapter 007 / lint registry effecttsgo/effectGenUsesAdapter: docs/design/src/007-tooling.md#94aff93668294824
// Chapter 007 / lint registry effecttsgo/effectInFailure: docs/design/src/007-tooling.md#af2935bda2beacaa
// Chapter 007 / lint registry effecttsgo/effectInVoidSuccess: docs/design/src/007-tooling.md#bdf8fd1693e6cdfa
// Chapter 007 / lint registry effecttsgo/effectMapFlatten: docs/design/src/007-tooling.md#8a46f44155c4bcfa
// Chapter 007 / lint registry effecttsgo/effectMapVoid: docs/design/src/007-tooling.md#01f70dff4ef8016e
// Chapter 007 / lint registry effecttsgo/effectSleepZeroToYieldNow: docs/design/src/007-tooling.md#1c9a9b87fde805df
// Chapter 007 / lint registry effecttsgo/effectSucceedWithVoid: docs/design/src/007-tooling.md#95fbfa820fec35f1
// Chapter 007 / lint registry effecttsgo/errorPayloadShadowsName: docs/design/src/007-tooling.md#3ee67a487014b479
// Chapter 007 / lint registry effecttsgo/experimentalApiUsage: docs/design/src/007-tooling.md#d2b97d91b76ac1b6
// Chapter 007 / lint registry effecttsgo/extendsNativeError: docs/design/src/007-tooling.md#c04dd553b52001df
// Chapter 007 / lint registry effecttsgo/flatMapConditionalToFilterOrFail: docs/design/src/007-tooling.md#7c48f98d6d03782c
// Chapter 007 / lint registry effecttsgo/flatMapIgnoredParamToAndThen: docs/design/src/007-tooling.md#b20b0d6d358e8cee
// Chapter 007 / lint registry effecttsgo/flatMapToMap: docs/design/src/007-tooling.md#d1b5346d144487b9
// Chapter 007 / lint registry effecttsgo/flatMapToTap: docs/design/src/007-tooling.md#435287cb8226452e
// Chapter 007 / lint registry effecttsgo/floatingEffect: docs/design/src/007-tooling.md#1478ab531b042c01
// Chapter 007 / lint registry effecttsgo/floatingEffectInVitest: docs/design/src/007-tooling.md#b7e4be9f5f78fe5e
// Chapter 007 / lint registry effecttsgo/genericEffectServices: docs/design/src/007-tooling.md#bd3f4f17c9a85119
// Chapter 007 / lint registry effecttsgo/globalConsole: docs/design/src/007-tooling.md#783af47df1f2492a
// Chapter 007 / lint registry effecttsgo/globalConsoleInEffect: docs/design/src/007-tooling.md#64d2d309f993e346
// Chapter 007 / lint registry effecttsgo/globalDate: docs/design/src/007-tooling.md#1562b7be5be04a3b
// Chapter 007 / lint registry effecttsgo/globalDateInEffect: docs/design/src/007-tooling.md#5261f02c1809c83f
// Chapter 007 / lint registry effecttsgo/globalErrorInEffectCatch: docs/design/src/007-tooling.md#d34465695b343a1e
// Chapter 007 / lint registry effecttsgo/globalErrorInEffectFailure: docs/design/src/007-tooling.md#55854b437360ce4b
// Chapter 007 / lint registry effecttsgo/globalFetch: docs/design/src/007-tooling.md#394f651639589974
// Chapter 007 / lint registry effecttsgo/globalFetchInEffect: docs/design/src/007-tooling.md#4a2e46260164baf3
// Chapter 007 / lint registry effecttsgo/globalRandom: docs/design/src/007-tooling.md#678d97d374b137e4
// Chapter 007 / lint registry effecttsgo/globalRandomInEffect: docs/design/src/007-tooling.md#c4f1406a3252ac59
// Chapter 007 / lint registry effecttsgo/globalTimers: docs/design/src/007-tooling.md#3aff46b5abbbad3d
// Chapter 007 / lint registry effecttsgo/globalTimersInEffect: docs/design/src/007-tooling.md#2f218a9bc00d1829
// Chapter 007 / lint registry effecttsgo/instanceOfSchema: docs/design/src/007-tooling.md#bc0647cec005f11f
// Chapter 007 / lint registry effecttsgo/layerMergeAllWithDependencies: docs/design/src/007-tooling.md#11884bd4cf0ab720
// Chapter 007 / lint registry effecttsgo/lazyEffect: docs/design/src/007-tooling.md#d69661dd0871e90c
// Chapter 007 / lint registry effecttsgo/lazyPromiseInEffectSync: docs/design/src/007-tooling.md#df969cc96f906fd7
// Chapter 007 / lint registry effecttsgo/leakingRequirements: docs/design/src/007-tooling.md#80b75ef802ad4eec
// Chapter 007 / lint registry effecttsgo/mapSomeToAsSome: docs/design/src/007-tooling.md#bdf5ca0805e6d230
// Chapter 007 / lint registry effecttsgo/matchEffectToMapBoth: docs/design/src/007-tooling.md#c801e347f2a668bc
// Chapter 007 / lint registry effecttsgo/matchEffectToMatch: docs/design/src/007-tooling.md#9af88cbadef73147
// Chapter 007 / lint registry effecttsgo/missedPipeableOpportunity: docs/design/src/007-tooling.md#04ac73df8e1c5719
// Chapter 007 / lint registry effecttsgo/missingEffectContext: docs/design/src/007-tooling.md#aef283819725219e
// Chapter 007 / lint registry effecttsgo/missingEffectError: docs/design/src/007-tooling.md#0983eb1f3d014264
// Chapter 007 / lint registry effecttsgo/missingEffectServiceDependency: docs/design/src/007-tooling.md#8e62b230b7e12192
// Chapter 007 / lint registry effecttsgo/missingLayerContext: docs/design/src/007-tooling.md#f7c22f9aa68806aa
// Chapter 007 / lint registry effecttsgo/missingPipeableSignature: docs/design/src/007-tooling.md#f31a03c8a9ca8265
// Chapter 007 / lint registry effecttsgo/missingReturnYieldStar: docs/design/src/007-tooling.md#498bef9ea29a7819
// Chapter 007 / lint registry effecttsgo/missingStarInYieldEffectGen: docs/design/src/007-tooling.md#c51534de459a38a7
// Chapter 007 / lint registry effecttsgo/multipleCatchTag: docs/design/src/007-tooling.md#f019ced59e0f5e74
// Chapter 007 / lint registry effecttsgo/multipleEffectProvide: docs/design/src/007-tooling.md#77d2a0b8bea9a153
// Chapter 007 / lint registry effecttsgo/nestedEffectGenYield: docs/design/src/007-tooling.md#7d364863969f0432
// Chapter 007 / lint registry effecttsgo/newPromise: docs/design/src/007-tooling.md#863693d6f1edbd04
// Chapter 007 / lint registry effecttsgo/newSchemaClass: docs/design/src/007-tooling.md#92241e499d882c3d
// Chapter 007 / lint registry effecttsgo/nodeBuiltinImport: docs/design/src/007-tooling.md#b0cc92fb9591f313
// Chapter 007 / lint registry effecttsgo/nonObjectEffectServiceType: docs/design/src/007-tooling.md#fda5e60cd8604d25
// Chapter 007 / lint registry effecttsgo/obsoleteMatchImport: docs/design/src/007-tooling.md#c4bb22937affaaf4
// Chapter 007 / lint registry effecttsgo/obsoleteSchemaImport: docs/design/src/007-tooling.md#386197ad7aa59bbb
// Chapter 007 / lint registry effecttsgo/optionMatchToFromOption: docs/design/src/007-tooling.md#61e252679a9bc46d
// Chapter 007 / lint registry effecttsgo/outdatedApi: docs/design/src/007-tooling.md#8593bdb922f6a6da
// Chapter 007 / lint registry effecttsgo/overriddenSchemaConstructor: docs/design/src/007-tooling.md#7780c7c8fb56a4bf
// Chapter 007 / lint registry effecttsgo/preferBarrelImport: docs/design/src/007-tooling.md#d753e34343fe0a9d
// Chapter 007 / lint registry effecttsgo/preferEffectArray: docs/design/src/007-tooling.md#c784c66d48679061
// Chapter 007 / lint registry effecttsgo/preferEffectRecord: docs/design/src/007-tooling.md#6deb89a33d807e69
// Chapter 007 / lint registry effecttsgo/preferEffectString: docs/design/src/007-tooling.md#ad0667ecb83b81cc
// Chapter 007 / lint registry effecttsgo/preferNamespaceImport: docs/design/src/007-tooling.md#0d7aa08b08daa283
// Chapter 007 / lint registry effecttsgo/preferSchemaOverJson: docs/design/src/007-tooling.md#a98d0fdf76c52f50
// Chapter 007 / lint registry effecttsgo/preferSchemaTaggedError: docs/design/src/007-tooling.md#a2ab7885a6809e08
// Chapter 007 / lint registry effecttsgo/preferSchemaTypeProperty: docs/design/src/007-tooling.md#3d529591319b9a33
// Chapter 007 / lint registry effecttsgo/preferSucceedSomeOrNone: docs/design/src/007-tooling.md#c1a964fdb9a1f551
// Chapter 007 / lint registry effecttsgo/preferTypedSchemaDecoder: docs/design/src/007-tooling.md#657bb0315c2301d6
// Chapter 007 / lint registry effecttsgo/preferUnsafeConstructor: docs/design/src/007-tooling.md#99135d893233afcb
// Chapter 007 / lint registry effecttsgo/processEnv: docs/design/src/007-tooling.md#7d59b0c99aa0660d
// Chapter 007 / lint registry effecttsgo/processEnvInEffect: docs/design/src/007-tooling.md#3d95aac0581cd397
// Chapter 007 / lint registry effecttsgo/promiseInEffectSuccess: docs/design/src/007-tooling.md#95160e4439ba5f4d
// Chapter 007 / lint registry effecttsgo/provideLayerSucceedToProvideService: docs/design/src/007-tooling.md#c0db6143417741ed
// Chapter 007 / lint registry effecttsgo/raceFirstWithSleepToTimeout: docs/design/src/007-tooling.md#76f6435eaec1fafe
// Chapter 007 / lint registry effecttsgo/redundantMapError: docs/design/src/007-tooling.md#2190e79e38e33aa3
// Chapter 007 / lint registry effecttsgo/redundantOrDie: docs/design/src/007-tooling.md#cb22dbf540c2c566
// Chapter 007 / lint registry effecttsgo/redundantSchemaTagIdentifier: docs/design/src/007-tooling.md#fdf602c015388265
// Chapter 007 / lint registry effecttsgo/returnEffectInGen: docs/design/src/007-tooling.md#b43a20c29afcf672
// Chapter 007 / lint registry effecttsgo/runEffectInsideEffect: docs/design/src/007-tooling.md#0802630d962750e4
// Chapter 007 / lint registry effecttsgo/runOfExitToRunExit: docs/design/src/007-tooling.md#2f881cf84f9679c2
// Chapter 007 / lint registry effecttsgo/schemaClassMissingBrand: docs/design/src/007-tooling.md#9f2f0b023ae409b1
// Chapter 007 / lint registry effecttsgo/schemaClassObjectLiteral: docs/design/src/007-tooling.md#1f8ebe05085a4cdc
// Chapter 007 / lint registry effecttsgo/schemaLiteralNonFinite: docs/design/src/007-tooling.md#8bf6f1fcf6a8c550
// Chapter 007 / lint registry effecttsgo/schemaNumber: docs/design/src/007-tooling.md#a983499a022b126b
// Chapter 007 / lint registry effecttsgo/schemaOpaqueInstanceMember: docs/design/src/007-tooling.md#0f642835124742eb
// Chapter 007 / lint registry effecttsgo/schemaStructWithTag: docs/design/src/007-tooling.md#c1e841709260667a
// Chapter 007 / lint registry effecttsgo/schemaSync: docs/design/src/007-tooling.md#4a2a2404c99bdb67
// Chapter 007 / lint registry effecttsgo/schemaSyncInEffect: docs/design/src/007-tooling.md#3f81053287aacdfd
// Chapter 007 / lint registry effecttsgo/schemaUnionOfLiterals: docs/design/src/007-tooling.md#e2674f0cd8581cb0
// Chapter 007 / lint registry effecttsgo/scopeInLayerEffect: docs/design/src/007-tooling.md#790de5384affcc58
// Chapter 007 / lint registry effecttsgo/serviceNotAsClass: docs/design/src/007-tooling.md#6670e9b4c9541cfd
// Chapter 007 / lint registry effecttsgo/strictBooleanExpressions: docs/design/src/007-tooling.md#1e02e1e360c141d7
// Chapter 007 / lint registry effecttsgo/strictEffectProvide: docs/design/src/007-tooling.md#7213bda6d258d22e
// Chapter 007 / lint registry effecttsgo/syncToSucceed: docs/design/src/007-tooling.md#047b44e7bd83426f
// Chapter 007 / lint registry effecttsgo/timeoutCatchTagToTimeoutOrElse: docs/design/src/007-tooling.md#7d7974ac2450ce93
test("both tables expose every inventory code as an Appendix B diagnostic row", () => {
  const { inventory } = generateLintCodes()
  for (const [path, output] of lintOutputs()) {
    if (!path.endsWith(".md")) continue
    const table = output.match(/<!-- lint-codes:start[^\n]*-->[\s\S]*?<!-- lint-codes:end -->/)[0]
    const rows = [...table.matchAll(/^\| `(EK38[0-9]{2,})` \| `effecttsgo\/([^`]+)` \| 38 \| \[Tooling\]\(007-tooling\.md\) \| `(error|warning|suggestion|off)` \|$/gm)]
      .map(([, code, rule, defaultSeverity]) => ({ code, rule, defaultSeverity }))
    assert.deepEqual(rows, inventory.rules.map(({ code, rule, defaultSeverity }) => ({ code, rule, defaultSeverity })), path)
    assert.match(table, /\| Code \| Rule \| VIP \| Chapter \| Default severity \|/)
  }
})

test("documentation generation and checking include the lint inventory and tables", () => {
  const scripts = JSON.parse(readFileSync(resolve(root, ".smithers/package.json"), "utf8")).scripts
  assert.ok(scripts["docs:generate"].includes("lint-codes.mjs --write"))
  assert.ok(scripts["docs:check"].includes("lint-codes.mjs --check"))
})


// VIP-38 initial allocation and stable future additions: mutate names, order,
// duplicates and removals independently of the compiler's registry.
test("property: imported lint codes are ASCII ordered initially and never reused", () => {
  const name = fc.array(fc.constantFrom(..."aAzZ09_"), { minLength: 1, maxLength: 10 }).map(chars => chars.join(""))
  fc.assert(fc.property(fc.uniqueArray(name, { minLength: 1, maxLength: 145 }), names => {
    const initial = assignCodes([...names].reverse())
    assert.equal(initial.floatingEffect, "EK3801")
    for (const [index, name] of [...names].sort().entries()) {
      assert.equal(initial[name], "EK38" + String(index + 2).padStart(2, "0"))
    }
    const next = assignCodes(["!new", ...names.filter((_, index) => index % 2 === 0)], initial)
    for (const name of names) assert.equal(next[name], initial[name])
    assert.equal(next["!new"], "EK38" + String(names.length + 2).padStart(2, "0"))
    assert.equal(new Set(Object.values(next)).size, Object.keys(next).length)
  }), { seed: 380034, numRuns: 60 })
})

test("VIP-38 normative pin and three error defaults match the published inventory", () => {
  const { inventory } = generateLintCodes()
  assert.deepEqual(inventory.upstream, {
    repository: "https://github.com/Effect-TS/tsgo",
    tag: "@effect/tsgo@0.57.0",
    commit: "999942fa41462eb46dfcb2d718e7671db8e14156"
  })
  for (const [code, rule] of [["EK3801", "floatingEffect"], ["EK3865", "missingEffectContext"], ["EK3870", "missingReturnYieldStar"]]) {
    const row = inventory.rules.find(row => row.code === code)
    assert.equal(row.rule, rule)
    assert.equal(row.defaultSeverity, "error")
  }
  const update = readFileSync(resolve(root, "typescript/tsc/internal/effecttsgo/sync.sh"), "utf8")
  assert.ok(update.includes("UPSTREAM"), "the upstream sync driver must update its pin")
})
