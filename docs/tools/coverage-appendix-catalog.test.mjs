import assert from "node:assert/strict"
import { test } from "node:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { root, generateLintCodes } from "./lint-codes.mjs"

// Chapter 900, Appendix B: imported rule identities and pinned default severities.
// Literal expected tuples come from the spec, independently of the upstream registry.
const expectations = [
  // docs/design/src/900-appendices.md#0983eb1f3d014264 — Chapter 900: missingEffectError identity and default.
  ["EK3866", "missingEffectError", "error"],
  // docs/design/src/900-appendices.md#8e62b230b7e12192 — Chapter 900: missingEffectServiceDependency identity and default.
  ["EK3867", "missingEffectServiceDependency", "off"],
  // docs/design/src/900-appendices.md#f7c22f9aa68806aa — Chapter 900: missingLayerContext identity and default.
  ["EK3868", "missingLayerContext", "error"],
  // docs/design/src/900-appendices.md#f31a03c8a9ca8265 — Chapter 900: missingPipeableSignature identity and default.
  ["EK3869", "missingPipeableSignature", "off"],
  // docs/design/src/900-appendices.md#498bef9ea29a7819 — Chapter 900: missingReturnYieldStar identity and default.
  ["EK3870", "missingReturnYieldStar", "error"],
  // docs/design/src/900-appendices.md#c51534de459a38a7 — Chapter 900: missingStarInYieldEffectGen identity and default.
  ["EK3871", "missingStarInYieldEffectGen", "error"],
  // docs/design/src/900-appendices.md#f019ced59e0f5e74 — Chapter 900: multipleCatchTag identity and default.
  ["EK3872", "multipleCatchTag", "suggestion"],
  // docs/design/src/900-appendices.md#77d2a0b8bea9a153 — Chapter 900: multipleEffectProvide identity and default.
  ["EK3873", "multipleEffectProvide", "warning"],
  // docs/design/src/900-appendices.md#7d364863969f0432 — Chapter 900: nestedEffectGenYield identity and default.
  ["EK3874", "nestedEffectGenYield", "off"],
  // docs/design/src/900-appendices.md#863693d6f1edbd04 — Chapter 900: newPromise identity and default.
  ["EK3875", "newPromise", "off"],
  // docs/design/src/900-appendices.md#92241e499d882c3d — Chapter 900: newSchemaClass identity and default.
  ["EK3876", "newSchemaClass", "off"],
  // docs/design/src/900-appendices.md#b0cc92fb9591f313 — Chapter 900: nodeBuiltinImport identity and default.
  ["EK3877", "nodeBuiltinImport", "off"],
  // docs/design/src/900-appendices.md#fda5e60cd8604d25 — Chapter 900: nonObjectEffectServiceType identity and default.
  ["EK3878", "nonObjectEffectServiceType", "error"],
  // docs/design/src/900-appendices.md#c4bb22937affaaf4 — Chapter 900: obsoleteMatchImport identity and default.
  ["EK3879", "obsoleteMatchImport", "warning"],
  // docs/design/src/900-appendices.md#386197ad7aa59bbb — Chapter 900: obsoleteSchemaImport identity and default.
  ["EK3880", "obsoleteSchemaImport", "warning"],
  // docs/design/src/900-appendices.md#61e252679a9bc46d — Chapter 900: optionMatchToFromOption identity and default.
  ["EK3881", "optionMatchToFromOption", "suggestion"],
  // docs/design/src/900-appendices.md#8593bdb922f6a6da — Chapter 900: outdatedApi identity and default.
  ["EK3882", "outdatedApi", "warning"],
  // docs/design/src/900-appendices.md#7780c7c8fb56a4bf — Chapter 900: overriddenSchemaConstructor identity and default.
  ["EK3883", "overriddenSchemaConstructor", "error"],
  // docs/design/src/900-appendices.md#d753e34343fe0a9d — Chapter 900: preferBarrelImport identity and default.
  ["EK3884", "preferBarrelImport", "off"],
  // docs/design/src/900-appendices.md#c784c66d48679061 — Chapter 900: preferEffectArray identity and default.
  ["EK3885", "preferEffectArray", "off"],
  // docs/design/src/900-appendices.md#6deb89a33d807e69 — Chapter 900: preferEffectRecord identity and default.
  ["EK3886", "preferEffectRecord", "off"],
  // docs/design/src/900-appendices.md#ad0667ecb83b81cc — Chapter 900: preferEffectString identity and default.
  ["EK3887", "preferEffectString", "off"],
  // docs/design/src/900-appendices.md#0d7aa08b08daa283 — Chapter 900: preferNamespaceImport identity and default.
  ["EK3888", "preferNamespaceImport", "off"],
  // docs/design/src/900-appendices.md#a98d0fdf76c52f50 — Chapter 900: preferSchemaOverJson identity and default.
  ["EK3889", "preferSchemaOverJson", "off"],
  // docs/design/src/900-appendices.md#a2ab7885a6809e08 — Chapter 900: preferSchemaTaggedError identity and default.
  ["EK3890", "preferSchemaTaggedError", "off"],
  // docs/design/src/900-appendices.md#3d529591319b9a33 — Chapter 900: preferSchemaTypeProperty identity and default.
  ["EK3891", "preferSchemaTypeProperty", "off"],
  // docs/design/src/900-appendices.md#c1a964fdb9a1f551 — Chapter 900: preferSucceedSomeOrNone identity and default.
  ["EK3892", "preferSucceedSomeOrNone", "suggestion"],
  // docs/design/src/900-appendices.md#657bb0315c2301d6 — Chapter 900: preferTypedSchemaDecoder identity and default.
  ["EK3893", "preferTypedSchemaDecoder", "suggestion"],
  // docs/design/src/900-appendices.md#99135d893233afcb — Chapter 900: preferUnsafeConstructor identity and default.
  ["EK3894", "preferUnsafeConstructor", "suggestion"],
  // docs/design/src/900-appendices.md#7d59b0c99aa0660d — Chapter 900: processEnv identity and default.
  ["EK3895", "processEnv", "off"],
  // docs/design/src/900-appendices.md#3d95aac0581cd397 — Chapter 900: processEnvInEffect identity and default.
  ["EK3896", "processEnvInEffect", "off"],
  // docs/design/src/900-appendices.md#95160e4439ba5f4d — Chapter 900: promiseInEffectSuccess identity and default.
  ["EK3897", "promiseInEffectSuccess", "warning"],
  // docs/design/src/900-appendices.md#c0db6143417741ed — Chapter 900: provideLayerSucceedToProvideService identity and default.
  ["EK3898", "provideLayerSucceedToProvideService", "suggestion"],
  // docs/design/src/900-appendices.md#76f6435eaec1fafe — Chapter 900: raceFirstWithSleepToTimeout identity and default.
  ["EK3899", "raceFirstWithSleepToTimeout", "suggestion"],
  // docs/design/src/900-appendices.md#2190e79e38e33aa3 — Chapter 900: redundantMapError identity and default.
  ["EK38100", "redundantMapError", "suggestion"],
  // docs/design/src/900-appendices.md#cb22dbf540c2c566 — Chapter 900: redundantOrDie identity and default.
  ["EK38101", "redundantOrDie", "suggestion"],
  // docs/design/src/900-appendices.md#fdf602c015388265 — Chapter 900: redundantSchemaTagIdentifier identity and default.
  ["EK38102", "redundantSchemaTagIdentifier", "suggestion"],
  // docs/design/src/900-appendices.md#b43a20c29afcf672 — Chapter 900: returnEffectInGen identity and default.
  ["EK38103", "returnEffectInGen", "suggestion"],
  // docs/design/src/900-appendices.md#0802630d962750e4 — Chapter 900: runEffectInsideEffect identity and default.
  ["EK38104", "runEffectInsideEffect", "suggestion"],
  // docs/design/src/900-appendices.md#2f881cf84f9679c2 — Chapter 900: runOfExitToRunExit identity and default.
  ["EK38105", "runOfExitToRunExit", "suggestion"],
  // docs/design/src/900-appendices.md#9f2f0b023ae409b1 — Chapter 900: schemaClassMissingBrand identity and default.
  ["EK38106", "schemaClassMissingBrand", "suggestion"],
  // docs/design/src/900-appendices.md#1f8ebe05085a4cdc — Chapter 900: schemaClassObjectLiteral identity and default.
  ["EK38107", "schemaClassObjectLiteral", "warning"],
  // docs/design/src/900-appendices.md#8bf6f1fcf6a8c550 — Chapter 900: schemaLiteralNonFinite identity and default.
  ["EK38108", "schemaLiteralNonFinite", "error"],
  // docs/design/src/900-appendices.md#a983499a022b126b — Chapter 900: schemaNumber identity and default.
  ["EK38109", "schemaNumber", "suggestion"],
  // docs/design/src/900-appendices.md#0f642835124742eb — Chapter 900: schemaOpaqueInstanceMember identity and default.
  ["EK38110", "schemaOpaqueInstanceMember", "error"],
  // docs/design/src/900-appendices.md#c1e841709260667a — Chapter 900: schemaStructWithTag identity and default.
  ["EK38111", "schemaStructWithTag", "suggestion"],
  // docs/design/src/900-appendices.md#4a2a2404c99bdb67 — Chapter 900: schemaSync identity and default.
  ["EK38112", "schemaSync", "off"],
  // docs/design/src/900-appendices.md#3f81053287aacdfd — Chapter 900: schemaSyncInEffect identity and default.
  ["EK38113", "schemaSyncInEffect", "suggestion"],
  // docs/design/src/900-appendices.md#e2674f0cd8581cb0 — Chapter 900: schemaUnionOfLiterals identity and default.
  ["EK38114", "schemaUnionOfLiterals", "off"],
  // docs/design/src/900-appendices.md#790de5384affcc58 — Chapter 900: scopeInLayerEffect identity and default.
  ["EK38115", "scopeInLayerEffect", "warning"],
  // docs/design/src/900-appendices.md#6670e9b4c9541cfd — Chapter 900: serviceNotAsClass identity and default.
  ["EK38116", "serviceNotAsClass", "off"],
  // docs/design/src/900-appendices.md#1e02e1e360c141d7 — Chapter 900: strictBooleanExpressions identity and default.
  ["EK38117", "strictBooleanExpressions", "off"],
  // docs/design/src/900-appendices.md#7213bda6d258d22e — Chapter 900: strictEffectProvide identity and default.
  ["EK38118", "strictEffectProvide", "off"],
  // docs/design/src/900-appendices.md#047b44e7bd83426f — Chapter 900: syncToSucceed identity and default.
  ["EK38119", "syncToSucceed", "suggestion"],
  // docs/design/src/900-appendices.md#7d7974ac2450ce93 — Chapter 900: timeoutCatchTagToTimeoutOrElse identity and default.
  ["EK38120", "timeoutCatchTagToTimeoutOrElse", "suggestion"],
  // docs/design/src/900-appendices.md#b1d1ad1cd85ade23 — Chapter 900: tryCatchInEffectGen identity and default.
  ["EK38121", "tryCatchInEffectGen", "suggestion"],
  // docs/design/src/900-appendices.md#d01da7d5ea451c92 — Chapter 900: unknownInEffectCatch identity and default.
  ["EK38122", "unknownInEffectCatch", "warning"],
  // docs/design/src/900-appendices.md#7c984e58cfb625df — Chapter 900: unnecessaryArrowBlock identity and default.
  ["EK38123", "unnecessaryArrowBlock", "off"],
  // docs/design/src/900-appendices.md#a635aca526a1adfd — Chapter 900: unnecessaryEffectGen identity and default.
  ["EK38124", "unnecessaryEffectGen", "suggestion"],
  // docs/design/src/900-appendices.md#45a35f66995f6e6f — Chapter 900: unnecessaryFailYieldableError identity and default.
  ["EK38125", "unnecessaryFailYieldableError", "suggestion"],
  // docs/design/src/900-appendices.md#8c706a545743ff1f — Chapter 900: unnecessaryPipe identity and default.
  ["EK38126", "unnecessaryPipe", "suggestion"],
  // docs/design/src/900-appendices.md#0aeece7beadcd87d — Chapter 900: unnecessaryPipeChain identity and default.
  ["EK38127", "unnecessaryPipeChain", "suggestion"],
  // docs/design/src/900-appendices.md#8f392f2e5ad901b1 — Chapter 900: unnecessaryTypeofType identity and default.
  ["EK38128", "unnecessaryTypeofType", "suggestion"],
  // docs/design/src/900-appendices.md#0835934b995a15bf — Chapter 900: unsafeEffectTypeAssertion identity and default.
  ["EK38129", "unsafeEffectTypeAssertion", "off"],
  // docs/design/src/900-appendices.md#783d2355bf1b9319 — Chapter 900: unstableApiUsage identity and default.
  ["EK38130", "unstableApiUsage", "warning"],
]
const shipped = JSON.parse(readFileSync(resolve(root, "docs/design/inventory/lint-codes.json"), "utf8"))
const upstream = generateLintCodes().inventory
for (const [code, name, defaultSeverity] of expectations) {
  test(`Chapter 900: ${name} is ${code}, default ${defaultSeverity}`, () => {
    const expected = { code, rule: name, defaultSeverity }
    for (const [label, inventory] of [["shipped", shipped], ["upstream", upstream]]) {
      const rows = inventory.rules.filter(row => row.rule === name)
      assert.equal(rows.length, 1, `${label}: exactly one ${name} assignment`)
      const { code, rule, defaultSeverity } = rows[0]
      assert.deepEqual({ code, rule, defaultSeverity }, expected, label)
      assert.equal(inventory.rules.filter(row => row.code === code).length, 1, `${label}: unique code`)
    }
  })
}
