import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import fc from "fast-check"
import { auditIdentity, compilerCodes } from "./diagnostic-identity.mjs"

const source = readFileSync(process.env.FACTORY_REGISTRY_SOURCE ?? new URL("../../typescript/tsc/internal/vibelang/diagnostics.go", import.meta.url), "utf8")
const files = text => [{ path: "typescript/tsc/internal/vibelang/diagnostics.go", text }]

test("VIP-1 factory checks no longer register diagnostics without a reporting path", () => {
  const registered = compilerCodes(files(source))
  for (const code of ["EK2116"]) assert.equal(registered.has(code), false, code + " is still registered")
  for (const code of ["EK2115", "EK2109", "EK2117", "EK9205"]) assert.ok(registered.has(code), code + " must be retained")
})

test("mutations distinguish deleted factory registrations from neighboring rules and textual mentions", () => {
  const baseline = compilerCodes(files(source))
  const rows = new Map([...baseline.keys()].filter(code => !["EK2116"].includes(code)).map(code => [code, "retained"]))
  fc.assert(fc.property(fc.constantFrom(2115, 2116), fc.constantFrom(" ", "\n", "\t", " /* declaration */ "),
    fc.constantFrom("message", "messageOff"), fc.boolean(), (ordinal, whitespace, constructor, commentOnly) => {
      const code = "EK" + ordinal
      const call = constructor === "message" ? 'message(' + ordinal + ', errorCategory, "factory")' : 'messageOff(' + ordinal + ', "factory")'
      const declaration = "var" + whitespace + code + whitespace + "=" + whitespace + call
      const mutation = source + "\n" + (commentOnly ? "/* " + declaration.replaceAll("/* declaration */", "") + " */" : declaration)
      const findings = auditIdentity(compilerCodes(files(mutation)), rows, [])
      assert.deepEqual(findings.map(f => [f.kind, f.code]), commentOnly || ordinal === 2115 ? [] : [["registered-missing", code]])
    }), { seed: 621152116, numRuns: 150 })
})
