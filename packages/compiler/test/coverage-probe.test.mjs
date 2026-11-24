// Chapter 900: the probe oracle compares diagnostic messages, not file paths.
import assert from "node:assert/strict"
import {test} from "node:test"
import {diagnosticMessagesOf, interimSeverityQuote} from "../../../typescript/vibelang/test/cov900-probe.mjs"
import {chapter} from "../../../docs/tools/spec-witness.mjs"
test("a throwing-case filename cannot satisfy a throw-message assertion", () => {
 const text="/tmp/cov900-throwing-callbacks/main.vibe(1,1): error TS2307: Cannot find module 'missing'.\n"
 assert.equal(diagnosticMessagesOf(text),"Cannot find module 'missing'.")
 assert.doesNotMatch(diagnosticMessagesOf(text),/throw/)
})
test("diagnostic message comparison retains category-independent continuation text", () => {
 const text="main.vibe(2,4): error EK0402: Callback may throw.\n  Wrap the invocation in Effect.try.\nmain.vibe(3,1): warning EK4830: Prefer a schema.\n"
 assert.equal(diagnosticMessagesOf(text),"Callback may throw.\n  Wrap the invocation in Effect.try.\nPrefer a schema.")
})
test("a panic or arbitrary output is not a compiler diagnostic", () => {
 assert.equal(diagnosticMessagesOf("panic: throw\n  compiler stack frame\n"),"")
})
test("the interim severity oracle quotes the current Chapter 900 text", () => {
 assert.ok(chapter("900-appendices").replace(/\s+/g," ").includes(interimSeverityQuote.replace(/\s+/g," ")))
})
