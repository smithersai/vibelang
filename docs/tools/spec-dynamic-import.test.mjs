import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { block, chapter, run } from "./spec-witness.mjs"
const failures = () => process.env.SPEC_FAILURES ? readFileSync(process.env.SPEC_FAILURES, "utf8") : chapter("003-failures")
const appendix = () => process.env.SPEC_APPENDICES ? readFileSync(process.env.SPEC_APPENDICES, "utf8") : chapter("900-appendices")

test("runtime import has an explicit Promise trigger and separate argument throw phases", () => {
  for (const text of [failures(), appendix()]) {
    const row = text.split("\n").find(line => line.startsWith("|") && line.includes("EK0404"))
    assert.match(row, /import\(\)/)
  }
  assert.match(failures(), /operation's own synchronous thrown type is .*never/)
  assert.match(failures(), /source argument expressions/)
  assert.match(failures(), /type-only .*import/i)
})

const setup = "import { writeFileSync } from \"node:fs\"\nwriteFileSync(new URL(\"./worker.mjs\", import.meta.url), \"export const value = 7\\n\")\nwriteFileSync(new URL(\"./worker.d.mts\", import.meta.url), \"export declare const value: 7\\n\")\nwriteFileSync(new URL(\"./syntax.mjs\", import.meta.url), \"export const = 1\\n\")\nwriteFileSync(new URL(\"./link.mjs\", import.meta.url), \"import { missing } from \\\"./worker.mjs\\\"; export { missing }\\n\")\nwriteFileSync(new URL(\"./evaluation.mjs\", import.meta.url), \"throw new Error(\\\"evaluation\\\")\\n\")\n"
const control = "\nfunction equal(a: unknown, b: unknown) { if (!Object.is(a, b)) throw new Error(\"native identity/value mismatch\") }\nequal(await Effect.runPromise(importedValue()), 7)\nconst expressionMarker = { phase: \"specifier-expression\" }\nfunction throwingSpecifier(): string { throw expressionMarker }\nlet produced: Promise<unknown> | undefined\nlet sync: unknown\ntry { produced = import(throwingSpecifier()) } catch (error) { sync = error }\nequal(sync, expressionMarker)\nequal(produced, undefined)\nconst optionsMarker = { phase: \"options-expression\" }\nfunction throwingOptions(): ImportCallOptions { throw optionsMarker }\nsync = undefined\ntry { produced = import(\"./worker.mjs\", throwingOptions()) } catch (error) { sync = error }\nequal(sync, optionsMarker)\nequal(produced, undefined)\n\nconst coercionMarker = { phase: \"specifier-coercion\" }\nlet coercions = 0\nconst objectSpecifier = { toString() { coercions++; throw coercionMarker } } as unknown as string\nconst rejected = import(objectSpecifier)\nequal(rejected instanceof Promise, true)\nlet rejection: unknown\ntry { await rejected } catch (error) { rejection = error }\nequal(rejection, coercionMarker)\nequal(coercions, 1)\nconst attributesMarker = { phase: \"attribute-access\" }\nconst options: ImportCallOptions = { get with(): ImportAttributes { throw attributesMarker } }\nrejection = undefined\ntry { await import(\"./worker.mjs\", options) } catch (error) { rejection = error }\nequal(rejection, attributesMarker)\n\nconst captured = await Effect.runPromiseExit(Effect.tryPromise({ try: () => import(throwingSpecifier()), catch: error => error }))\nequal(captured._tag, \"Failure\")\nif (captured._tag === \"Failure\") equal(captured.cause.reasons[0]._tag === \"Fail\" ? captured.cause.reasons[0].error : undefined, expressionMarker)\nconst promiseAsData = Effect.runSync(Effect.try(() => import(\"./worker.mjs\")))\nequal(promiseAsData instanceof Promise, true)\nequal((await promiseAsData).value, 7)\nconsole.log(\"bridge7, synchronous argument phases, asynchronous coercion/attributes, identity and try-data: pass\")\nfor (const path of [\"./absent.mjs\", \"./syntax.mjs\", \"./link.mjs\", \"./evaluation.mjs\"]) {\n  let promise: Promise<unknown> | undefined\n  let synchronous: unknown\n  try { promise = import(path) } catch (error) { synchronous = error }\n  equal(synchronous, undefined)\n  equal(promise instanceof Promise, true)\n  let rejected = false\n  try { await promise } catch { rejected = true }\n  equal(rejected, true)\n  const exit = await Effect.runPromiseExit(Effect.tryPromise({ try: () => import(path), catch: error => error }))\n  equal(exit._tag, \"Failure\")\n  if (exit._tag === \"Failure\") equal(exit.cause.reasons[0]._tag, \"Fail\")\n}\nconsole.log(\"loading, syntax, linking and evaluation failures return/reject Promises and bridge as failures: pass\")\n"
test("the printed import bridge preserves native phases, failures and module results", () => {
  const source = block(failures(), "function importedValue()")
  const result = run(setup + source + control + `
let executions = 0
const cold = Effect.tryPromise(() => { executions++; return import("./worker.mjs") })
equal(executions, 0)
const first = await Effect.runPromise(cold)
const second = await Effect.runPromise(cold)
equal(executions, 2)
equal(first, second)
equal(first.value, 7)
`)
  assert.equal(result.status, 0, result.stderr)
})
