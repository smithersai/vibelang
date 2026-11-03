import assert from "node:assert/strict"
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
