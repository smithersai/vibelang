import { expect, test } from "bun:test"
import { compileEffectManifest, type DurableSourceActionBinding } from "./source-compiler.ts"
import { compileActionContract } from "./schema.ts"
import { digest } from "./value.ts"
import { EffectManifestSiteIds, effectSiteId, type EffectSiteIdentity } from "./site-id.ts"

/**
 * Effect Manifest site id INJECTIVITY, and the guard that makes a duplicate a
 * refusal instead of a duplicate journal key.
 *
 * ## Why this cannot be a differential test
 *
 * BOTH backends spelled `recordSite` the same way — the occurrence counter
 * keyed on `{...identity, requestKind}` while the id was minted from `identity`
 * alone, with `kind` pinned to the constant `"perform"`. A cross-backend digest
 * comparison compares two implementations of one algorithm, so it is
 * structurally blind to a defect they share: the reference and the fork agreed
 * perfectly, on the wrong answer, and the conformance runner reported nothing.
 * The assertions below are therefore DIRECT — the shipped bucket is handed to
 * the assigner and the duplicate is observed — rather than a comparison against
 * the other backend.
 *
 * ## What the defect was
 *
 * A counter partitioned more finely than the value it disambiguates does not
 * disambiguate it; it defeats it. Two sites sharing `(file, functionName,
 * anchor, key)` and differing only in request kind each read occurrence `0` out
 * of their own bucket and then minted the same id. Under PR-2 that id is half a
 * journal key, in the artifact whose digest is meant to be signed.
 *
 * ## Whether a compilable program can reach it
 *
 * MEASURED, not assumed: no. The id's only real discriminator is `anchor`, and
 * two classified request sites cannot share one. A classified call's anchor is
 * the start of its callee's leftmost token, so two of them share it only when
 * the inner call IS the outer's callee prefix — `inner(...)(...)` or
 * `inner(...).run(...)` — and in both shapes the outer's receiver is a
 * `CallExpression`, which `getSymbolAtLocation` answers `undefined` for, so the
 * outer classifies to nothing. `manifestSiteIdsAreDistinctAcrossKinds` below
 * compiles both shapes and shows the outer contributes no row.
 *
 * That is why the fix is the bucket and the guard rather than splicing the real
 * kind into the id: the previous bucket was a strict refinement of the new one,
 * so every program whose ids were already distinct keeps them byte for byte and
 * no Manifest digest moves, while the answer moves only where it was a
 * duplicate. Splicing the kind in would have moved every site id in every
 * durable compile to fix a program that cannot be written.
 *
 * The invariant that saves it lives in the parser, three files from the site
 * that depends on it. The guard is what stops that being load-bearing.
 */

const SHIPPED_BUCKET = (identity: EffectSiteIdentity, requestKind: string): string =>
  digest({ ...identity, requestKind })

const siteAt = (anchor: string, key: string): EffectSiteIdentity => ({
  file: "flows/orders.sm",
  functionName: "Place",
  kind: "perform",
  anchor,
  key
})

test("the shipped occurrence bucket mints one id for two request kinds at one site", () => {
  const shipped = new EffectManifestSiteIds(SHIPPED_BUCKET)
  const signal = shipped.assign(siteAt("7:2", "orders.ready"), "signal")
  const queue = shipped.assign(siteAt("7:2", "orders.ready"), "queue")

  // The defect, stated as an equality rather than described: two request kinds,
  // one id. The guard added with the fix is what turns it into a report.
  expect(signal.id).toBe(queue.id)
  expect(queue.collidesWith).toBe("signal@7:2")
})

test("the aligned bucket separates two request kinds at one site", () => {
  const assigner = new EffectManifestSiteIds()
  const signal = assigner.assign(siteAt("7:2", "orders.ready"), "signal")
  const queue = assigner.assign(siteAt("7:2", "orders.ready"), "queue")

  expect(signal.id).not.toBe(queue.id)
  expect(signal.collidesWith).toBeUndefined()
  expect(queue.collidesWith).toBeUndefined()
})

test("the aligned bucket is a coarsening, so no id a correct program had can move", () => {
  // Every site the shipped code got RIGHT is a site whose (file, functionName,
  // anchor, key) tuple was unique among its kind-partition. For those the new
  // bucket hands out the same occurrence, so the same id. This is the whole
  // claim that the fix moves no pinned Manifest digest, and it is checked
  // rather than asserted in prose.
  const sites: ReadonlyArray<readonly [EffectSiteIdentity, string]> = [
    [siteAt("1:0", "a"), "perform"],
    [siteAt("2:0", "b"), "signal"],
    [siteAt("3:0", "c"), "queue"],
    [siteAt("4:0", "d"), "broadcast"],
    [siteAt("5:0", "e"), "childFlow"],
    [siteAt("6:0", "a"), "perform"]
  ]
  const shipped = new EffectManifestSiteIds(SHIPPED_BUCKET)
  const aligned = new EffectManifestSiteIds()
  for (const [identity, kind] of sites) {
    expect(`${kind}@${identity.anchor} ${aligned.assign(identity, kind).id}`)
      .toBe(`${kind}@${identity.anchor} ${shipped.assign(identity, kind).id}`)
  }
})

test("the occurrence counter still separates two sites of one kind at one anchor", () => {
  // The counter's real job. `assign` is called twice with an identical tuple,
  // which is what the Plan lowerer's twin uses its counter for.
  const assigner = new EffectManifestSiteIds()
  const first = assigner.assign(siteAt("9:4", "k"), "perform")
  const second = assigner.assign(siteAt("9:4", "k"), "perform")
  expect(first.id).toBe(effectSiteId(siteAt("9:4", "k"), 0))
  expect(second.id).toBe(effectSiteId(siteAt("9:4", "k"), 1))
  expect(second.collidesWith).toBeUndefined()
})

test("a mint that hands out one id twice is refused, not appended", () => {
  // The general form of the shipped defect, and of the 96-bit truncation that
  // outlives it: a counter so finely partitioned that every site reads
  // occurrence 0. A guard no test can exercise is one the next refactor deletes
  // as dead code, so the collision is forced here the same way
  // `NominalErrorIdentities` forces its own.
  let bucket = 0
  const everSplitting = new EffectManifestSiteIds(() => `bucket-${bucket++}`)
  expect(everSplitting.assign(siteAt("1:0", "a"), "perform").collidesWith).toBeUndefined()
  const second = everSplitting.assign(siteAt("1:0", "a"), "sleep")
  expect(second.collidesWith).toBe("perform@1:0")
})

// ---------------------------------------------------------------------------
// The reachability claim, through the real compiler
// ---------------------------------------------------------------------------

const boundAction = (): DurableSourceActionBinding => {
  const contract = compileActionContract(
    `import { Action } from "smithers:flows"
class Failed extends Error {
  constructor(readonly code: string) { super(code) }
}
export abstract class Transform extends Action<
  (input: { id: string; value: number }) => Result<{ id: string; doubled: number }, Failed>
> {}`,
    { fileName: "contracts/transform.sm", exportName: "Transform", id: "test/site/Transform", version: 1 }
  )
  if (!contract.ok) throw new Error(JSON.stringify(contract.diagnostics))
  return { moduleSpecifier: "test:site-actions", exportName: "Transform", descriptor: contract.descriptor }
}

const manifestOf = (source: string) =>
  compileEffectManifest(source, {
    fileName: "flows/site.sm",
    flowId: "test/site/F",
    flowVersion: 1,
    actions: [boundAction()],
    flows: []
  })

test("no two request sites in one Flow share an anchor, so no two share an id", () => {
  // The shape in which two call expressions share a start position: a call OF a
  // call. The inner `dequeue(...)` records its queue site; the outer one calls
  // the answer.
  //
  // Until `MIGRATION-PLAN.md` step 11 the outer call classified to nothing, and
  // that silence was this test's stated invariant. It is now a REFUSAL, and the
  // invariant is stronger for it: the Plan lowerer's `SMITHERS4112` wall used to
  // refuse a dynamic call before the Manifest was consulted, so with the wall
  // withdrawn a Manifest that stayed silent here would be claiming a Flow
  // reaches no effect while it calls a value it cannot name. Two sites can still
  // never share an anchor, and now they cannot share one for a second reason:
  // the outer call does not reach the site table at all.
  const outerIsACallOfACall = manifestOf(
    `import { durable, dequeue } from "smithers:flows"
export const F = durable(function F(input: { id: string }) {
  const j = dequeue<{ a: string }>("q")("q")
  return { id: input.id, j: j }
})`
  )
  expect(outerIsACallOfACall.ok).toBe(false)
  if (!outerIsACallOfACall.ok) {
    expect(outerIsACallOfACall.diagnostics[0]?.message).toContain("the Effect Manifest cannot state")
  }

  // Every kind the derivation can record, in one Flow, with one key string
  // shared between the signal and the queue so only the anchor separates them.
  const everyKind = manifestOf(
    `import { durable, dequeue, sleep, waitBroadcast, waitSignal } from "smithers:flows"
import { Transform } from "test:site-actions"
export const F = durable(function F(input: { id: string; value: number }) {
  sleep(25)
  const s = waitSignal<{ ok: boolean }>("shared.id")
  const q = dequeue<{ ok: boolean }>("shared.id")
  const b = waitBroadcast<{ ok: boolean }>("shared.id")
  const t = Transform.run({ id: input.id, value: input.value })
  return { s: s, q: q, b: b, t: t }
})`
  )
  expect(everyKind.ok ? [] : everyKind.diagnostics).toEqual([])
  if (!everyKind.ok) return
  const sites = everyKind.manifest.sites
  expect(sites.length).toBe(5)
  expect(new Set(sites.map((site) => site.anchor)).size).toBe(5)
  expect(new Set(sites.map((site) => site.id)).size).toBe(5)
  // Three of the five carry ONE key and differ only in kind and anchor. Drop the
  // anchor and the shipped code hands all three the same id.
  const shared = sites.filter((site) => site.key === "shared.id")
  expect(shared.map((site) => site.kind).sort()).toEqual(["broadcast", "queue", "signal"])
})
