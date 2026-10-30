import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { block, chapter, run } from "./spec-witness.mjs"
const failures = () => process.env.SPEC_FAILURES ? readFileSync(process.env.SPEC_FAILURES, "utf8") : chapter("003-failures")
const appendix = () => process.env.SPEC_APPENDICES ? readFileSync(process.env.SPEC_APPENDICES, "utf8") : chapter("900-appendices")

test("both EK0404 trigger lists include a tagged-template invocation", () => {
  for (const text of [failures(), appendix()]) {
    const row = text.split("\n").find(line => line.startsWith("|") && line.includes("EK0404"))
    assert.match(row, /tagged template/)
  }
  assert.match(failures(), /selected tag signature/)
})

test("the printed explicit Promise bridge executes the original tag and succeeds", () => {
  const result = run(block(failures(), "function wrappedTag()") + `
import assert from "node:assert/strict"
const exit = await Effect.runPromiseExit(wrappedTag())
assert.equal(exit._tag, "Success")
assert.equal(exit.value, 7)
`)
  assert.equal(result.status, 0, result.stderr)
})

const protocol = "import { Effect } from \"effect\"\nconst assert = {\n  equal(a: unknown, b: unknown) { if (!Object.is(a, b)) throw new Error(\"unequal native values\") },\n  deepEqual(a: unknown, b: unknown) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(\"unequal trace\") },\n  ok(value: unknown) { if (!value) throw new Error(\"native assertion failed\") }\n}\n\nconst trace: string[] = []\nconst sites: TemplateStringsArray[] = []\nconst host = {\n  base: 2,\n  get tag() {\n    trace.push(\"get\")\n    return this.invoke\n  },\n  invoke(parts: TemplateStringsArray, value: number): Promise<number> {\n    trace.push(\"call\")\n    assert.equal(this, host)\n    sites.push(parts)\n    return Promise.resolve(this.base + value)\n  }\n}\nconst substitution = () => { trace.push(\"substitution\"); return 7 }\nconst receiverBridge = () => Effect.tryPromise(() => host.tag`x${substitution()}`)\nassert.equal(await Effect.runPromise(receiverBridge()), 9)\nassert.equal(await Effect.runPromise(receiverBridge()), 9)\nassert.deepEqual(trace, [\"get\", \"substitution\", \"call\", \"get\", \"substitution\", \"call\"])\nassert.equal(sites[0], sites[1])\nassert.ok(Object.isFrozen(sites[0]) && Object.isFrozen(sites[0].raw))\nfunction constructionTag(_parts: TemplateStringsArray): Promise<number> { throw \"construction\" }\nasync function rejectedTag(_parts: TemplateStringsArray): Promise<number> { throw \"rejection\" }\nfor (const [program, expected] of [\n  [Effect.tryPromise({ try: () => constructionTag`x`, catch: error => error }), \"construction\"],\n  [Effect.tryPromise({ try: () => rejectedTag`x`, catch: error => error }), \"rejection\"]\n] as const) {\n  const exit = await Effect.runPromiseExit(program)\n  assert.equal(exit._tag, \"Failure\")\n  if (exit._tag === \"Failure\") {\n    assert.deepEqual(exit.cause.reasons.map(reason => reason._tag === \"Fail\" ? reason.error : reason._tag), [expected])\n  }\n}\nconsole.log(\"receiver, callee-before-substitution, one substitution/run, shared frozen template site, construction failure and rejection: pass\")\n"
test("the native bridge preserves receiver, template site, substitutions and both failure phases", () => {
  const result = run(protocol)
  assert.equal(result.status, 0, result.stderr)
})
