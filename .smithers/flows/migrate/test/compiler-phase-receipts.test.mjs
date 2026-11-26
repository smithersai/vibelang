// #370: a migration receipt names the native compiler each phase actually ran.
// A source revision label cannot stand for different native bytes: two staged
// toolchains that share a revision but differ in native bytes are two
// compilers, and a receipt whose convert, check and emit phases disagree is
// refused.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { assertPhasesAgree, compilerArtifactOf, phaseCompilers } from "../lib/toolchain.mjs"

const sha = bytes => createHash("sha256").update(bytes).digest("hex")
function toolchains(t) {
  const root = mkdtempSync(join(tmpdir(), "migration-phase-compilers-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const make = (name, bytes) => {
    const dir = join(root, name)
    mkdirSync(join(dir, "native"), { recursive: true })
    writeFileSync(join(dir, "native/vibelang"), bytes)
    writeFileSync(join(dir, "toolchain.json"), JSON.stringify({ commit: "656494e76e7a", compiler: "native/vibelang", packages: {} }))
    return { kind: "staged", dir }
  }
  return { fresh: make("fresh", "fresh native compiler"), stale: make("stale", "stale native compiler aa596fc71ad2ca39") }
}

test("each phase records the revision label and the native digest it ran", t => {
  const { fresh } = toolchains(t)
  const artifact = compilerArtifactOf(fresh)
  const phases = phaseCompilers({ convert: artifact, check: artifact, emit: [artifact, artifact] })
  const expected = { revision: "656494e76e7a", nativeDigest: sha("fresh native compiler") }
  assert.deepEqual(phases, { convert: expected, check: expected, emit: expected })
  assert.deepEqual(assertPhasesAgree(phases), expected)
})

test("two toolchains sharing a revision label but not native bytes make a mixed receipt that is refused", t => {
  const { fresh, stale } = toolchains(t)
  const a = compilerArtifactOf(fresh), b = compilerArtifactOf(stale)
  assert.equal(a.revision, b.revision)
  assert.notEqual(a.nativeSha256, b.nativeSha256)
  for (const mixed of [{ convert: b, check: a, emit: [a] }, { convert: a, check: b, emit: [a] }, { convert: a, check: a, emit: [a, b] }]) {
    assert.throws(() => assertPhasesAgree(phaseCompilers(mixed)), /mixes native compilers/)
  }
})

test("a staged phase beside an untracked compiler phase is refused; phases with no receipt are skipped", t => {
  const { fresh } = toolchains(t)
  const a = compilerArtifactOf(fresh)
  assert.throws(() => assertPhasesAgree(phaseCompilers({ convert: a, check: null, emit: [a] })), /mixes native compilers/)
  assert.deepEqual(phaseCompilers({ convert: a }), { convert: { revision: a.revision, nativeDigest: a.nativeSha256 } })
  assert.equal(assertPhasesAgree(phaseCompilers({ convert: null, check: null, emit: [] })), null)
})
