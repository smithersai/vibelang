import { expect, test } from "bun:test"
import { compileEffectManifest } from "./source-compiler.ts"

test("a manifest follows helper aliases, closures and recursive calls exactly once per source site", () => {
  const compiled = compileEffectManifest(`
import { Action, durable } from "vibelang:flows"
class Step extends Action<(n: number) => Result<number, Error>> {}
function recurse(n: number): number {
  if (n <= 0) return 0
  const next = Step.run(n)!
  return recurse(next)
}
const alias = recurse
export const Flow = durable((n: number) => {
  const nested = (value: number) => alias(value)
  return nested(n) + nested(n)
})
`, { fileName: "reachable.vibe" })
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  expect(compiled.manifest.actions.map(action => action.id)).toEqual(["reachable.vibe#Step"])
  expect(compiled.manifest.sites).toHaveLength(1)
  expect(compiled.manifest.requirements).toEqual(["reachable.vibe#Step"])
})

test("a method merely spelled context is not exempt from manifest reachability", () => {
  const compiled = compileEffectManifest(`
import { Action, durable } from "vibelang:flows"
class Step extends Action<(n: number) => Result<number, Error>> {}
const ordinary = { context(n: number) { return Step.run(n)! } }
export const Flow = durable((n: number) => ordinary.context(n))
`, { fileName: "ordinary.vibe" })
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics))
  expect(compiled.manifest.actions.map(action => action.id)).toEqual(["ordinary.vibe#Step"])
  expect(compiled.manifest.sites).toHaveLength(1)

  const opaque = compileEffectManifest(`
import { durable } from "vibelang:flows"
declare const hidden: { context(): number }
export const Flow = durable((n: number) => hidden.context() + n)
`, { fileName: "opaque.vibe" })
  expect(opaque.ok).toBe(false)
  if (opaque.ok) return
  expect(opaque.diagnostics[0]?.message).toContain("whose effects the Effect Manifest cannot state")
})
