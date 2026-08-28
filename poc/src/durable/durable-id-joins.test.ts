import { expect, test } from "bun:test"
import { childDeploymentId, contentAdoptionSource, memoAdoptionSource } from "./site-id.ts"

// Cache-adoption provenance INJECTIVITY.
//
// `adopted_from` is the durable answer to "where did this node's value actually
// come from". `DurableStore.commitMemoSuccess` writes it into
// `durable_nodes.adopted_from` and `emit` copies it into
// `durable_journal.payload_json`, from which `payload_digest` and the
// hash-chained `event_digest` are computed. So a collision is not a transient
// mis-read: it is a durable audit record, inside a hash chain, naming two
// different memo entries with one string.
//
// WHY A DIFFERENTIAL TEST COULD NOT HAVE FOUND THIS. There is no second backend
// to differ from — the durable ENGINE and STORE are reference-only; the Go fork
// carries the durable CONTRACT compiler (`compiler/forkbridge/durable.go.txt`)
// and no runtime. A cross-backend comparison has nothing to compare, so the
// assertion has to be DIRECT: it says what the answer must BE.
//
// RED BEFORE THE FIX. Both call sites spelled this inline as
// `memo:${scope}:${generation}:${memoKey}`, and `provideAction`
// (`./provider.ts`) validates `scope` and `generation` only for being non-empty
// after `trim()`. Measured on the shipped spelling:
//
//     scope "a",   generation "b:c" -> memo:a:b:c:<key>
//     scope "a:b", generation "c"   -> memo:a:b:c:<key>
//
// NEITHER input holds a character outside the spelling's implicit alphabet, so
// escaping alone would not have been a fix. Withholding the separator from the
// component alphabet is.

/** The SHIPPED spelling, restated so the defect stays measurable after the fix. */
const shippedMemoAdoptionSource = (scope: string, generation: string, memoKey: string): string =>
  `memo:${scope}:${generation}:${memoKey}`

const MEMO_KEY = "0".repeat(64)

test("the shipped inline spelling collides on two accepted memo policies", () => {
  // The defect this file exists for, kept executable. `provideAction` accepts
  // both policies: each component is non-empty after `trim()`.
  expect(shippedMemoAdoptionSource("a", "b:c", MEMO_KEY))
    .toBe(shippedMemoAdoptionSource("a:b", "c", MEMO_KEY))
})

test("the separator cannot be spelled by a memo adoption component", () => {
  expect(memoAdoptionSource("a", "b:c", MEMO_KEY))
    .not.toBe(memoAdoptionSource("a:b", "c", MEMO_KEY))
  // The separator survives as an escape rather than as itself, which is what
  // makes the two spellings different at all.
  expect(memoAdoptionSource("a", "b:c", MEMO_KEY)).toBe(`memo:a:b+003Ac:${MEMO_KEY}`)
  expect(memoAdoptionSource("a:b", "c", MEMO_KEY)).toBe(`memo:a+003Ab:c:${MEMO_KEY}`)
})

test("the escape introducer cannot be spelled either, so the encoding is reversible", () => {
  // Without withholding `+`, `a+003Ab` (authored) and `a:b` (escaped) would be
  // one string. With it, an authored `+` is itself an escape.
  expect(memoAdoptionSource("a+003Ab", "c", MEMO_KEY))
    .not.toBe(memoAdoptionSource("a:b", "c", MEMO_KEY))
  expect(memoAdoptionSource("a+003Ab", "c", MEMO_KEY)).toBe(`memo:a+002B003Ab:c:${MEMO_KEY}`)
})

test("memo adoption sources are injective over a generated component corpus", () => {
  // A property test rather than a table: the shipped defect was a SHAPE, and a
  // table only ever contains the shapes whoever wrote it already thought of.
  const alphabet = ["", "a", ":", "+", "::", "a:b", "+003A", "@", "/", "\u{1F600}", "\uD800", " "]
  const seen = new Map<string, string>()
  for (const scope of alphabet) {
    for (const generation of alphabet) {
      const source = memoAdoptionSource(scope, generation, MEMO_KEY)
      const owner = JSON.stringify([scope, generation])
      const prior = seen.get(source)
      expect(prior === undefined || prior === owner).toBe(true)
      seen.set(source, owner)
    }
  }
  expect(seen.size).toBe(alphabet.length * alphabet.length)
})

test("a lone surrogate cannot survive into a persisted adoption source", () => {
  // A surrogate is outside the alphabet, so it escapes; `canonicalJson` would
  // otherwise put an unpaired surrogate into a hash-chained journal payload.
  expect(memoAdoptionSource("\uD800", "c", MEMO_KEY)).toBe(`memo:+D800:c:${MEMO_KEY}`)
})

test("content and memo adoption sources are disjoint whatever the components hold", () => {
  expect(contentAdoptionSource("1".repeat(64))).toBe(`content:${"1".repeat(64)}`)
  // A `content:` spelling can never be a `memo:` one: the prefixes differ, and
  // neither component may spell one into existence.
  expect(contentAdoptionSource("memo:a:b:c").startsWith("content:")).toBe(true)
  expect(contentAdoptionSource("memo:a:b:c")).toBe("content:memo+003Aa+003Ab+003Ac")
})

// ---------------------------------------------------------------------------
// The embedded child deployment id
// ---------------------------------------------------------------------------
//
// RED BEFORE THE FIX. `buildDeployment` spelled this
// `${deploymentId}/child/${childPlan.digest.slice(0, 16)}` — a 64-bit cut of a
// SHA-256, honouring a bound that does not exist (`validateDeploymentManifest`
// checks `deploymentId` for being non-empty and nothing else) by destroying
// information. Two embedded child Plans agreeing in 16 hex digits minted one
// child deployment id, which is hashed into the child `DeploymentManifest`
// digest and pinned as `durable_executions.manifest_digest`.

/** The SHIPPED spelling, restated so the defect stays measurable after the fix. */
const shippedChildDeploymentId = (deploymentId: string, childPlanDigest: string): string =>
  `${deploymentId}/child/${childPlanDigest.slice(0, 16)}`

const DIGEST_A = "abcdef0123456789" + "0".repeat(48)
const DIGEST_B = "abcdef0123456789" + "1".repeat(48)

test("the shipped 64-bit truncation folds two distinct child Plan digests together", () => {
  expect(DIGEST_A).not.toBe(DIGEST_B)
  expect(shippedChildDeploymentId("d", DIGEST_A)).toBe(shippedChildDeploymentId("d", DIGEST_B))
})

test("the child deployment id carries the whole digest and cannot fold", () => {
  expect(childDeploymentId("d", DIGEST_A)).not.toBe(childDeploymentId("d", DIGEST_B))
  expect(childDeploymentId("d", DIGEST_A)).toBe(`d/child/${DIGEST_A}`)
})

test("a parent id spelled to look derived still parses right-anchored", () => {
  // The parent may hold `/child/`; the digest may not hold `/`, so the LAST
  // `/child/` followed by 64 hex digits is always the real separator. A
  // grandchild is a distinct spelling from either of the two ids it is built on.
  const grandparent = childDeploymentId("d", DIGEST_A)
  const grandchild = childDeploymentId(grandparent, DIGEST_B)
  expect(grandchild).toBe(`d/child/${DIGEST_A}/child/${DIGEST_B}`)
  expect(grandchild).not.toBe(childDeploymentId("d", DIGEST_B))
  expect(grandchild.lastIndexOf("/child/")).toBe(grandparent.length)
})
