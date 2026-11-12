import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import fc from "fast-check"
import { checkShimAvailability, proposalIsOpen, recordShimPublication, registryVersions, shimAvailabilityProblems } from "./shim-availability.mjs"

test("registry availability distinguishes E404 from network and malformed responses", () => {
  assert.deepEqual(registryVersions({ error: { code: "E404" } }), [])
  assert.deepEqual(registryVersions("7.1.11"), ["7.1.11"])
  assert.deepEqual(registryVersions(["7.1.10", "7.1.11"]), ["7.1.10", "7.1.11"])
  for (const value of [{ error: { code: "E403" } }, {}, ["bad"], null]) assert.throws(() => registryVersions(value))
})

test("publication recording is deterministic and does not invent a published version", () => {
  const root = mkdtempSync(join(tmpdir(), "shim-publication-"))
  try {
    mkdirSync(join(root, "docs/tools"), { recursive: true })
    recordShimPublication(root, () => ({ error: { code: "E404" } }))
    const receipt = JSON.parse(readFileSync(join(root, "docs/tools/shim-publication.json"), "utf8"))
    assert.deepEqual(receipt.versions, [])
    recordShimPublication(root, () => ["7.1.11"])
    assert.deepEqual(JSON.parse(readFileSync(join(root, "docs/tools/shim-publication.json"), "utf8")).versions, ["7.1.11"])
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test("open proposals and unavailable aliases require explicit preview guidance", () => {
  assert.ok(proposalIsOpen("**Status:** open, pending a decision."))
  assert.ok(!proposalIsOpen("**Status:** accepted."))
  assert.ok(shimAvailabilityProblems("npm install typescript@npm:vibelang-typescript@7.1.11").length >= 2)
  assert.deepEqual(shimAvailabilityProblems("Experimental source-checkout preview. The package is not available from npm."), [])
  assert.deepEqual(shimAvailabilityProblems("npm install typescript@npm:vibelang-typescript@7.1.11",
    { open: false, versions: ["7.1.11"] }), [])
  assert.ok(shimAvailabilityProblems("Experimental preview. Not published to npm.", { versions: ["7.1.11"] }).length)
  assert.ok(shimAvailabilityProblems("Experimental preview. npm install typescript@npm:vibelang-typescript@7.1.12", { versions: ["7.1.11"] }).length)
})

test("published guides match the recorded registry and proposal status", () => {
  assert.deepEqual(checkShimAvailability(), [])
})

test("generated publication states only admit aliases for recorded versions", () => {
  fc.assert(fc.property(fc.nat(1000), fc.boolean(), fc.boolean(), (patch, published, open) => {
    const version = "7.1." + patch
    const intro = (open ? "Experimental preview. " : "") + (published ? "Available from npm." : "Not published to npm.")
    const command = "\n\n```sh\nnpm install --save-dev typescript@npm:vibelang-typescript@" + version + "\n```"
    const result = shimAvailabilityProblems(intro + command, { versions: published ? [version] : [], open })
    assert.equal(result.length, published ? 0 : 1)
    assert.deepEqual(shimAvailabilityProblems(intro, { versions: published ? [version] : [], open }), [])
  }), { seed: 421106, numRuns: 200 })
})

test("a page may not say a release includes the replacement package before npm records it", () => {
  const claim = "The experimental shim is a last resort.\nIt is included in the VibeLang 0.0.13 release under open VIP-42.\n"
  assert.deepEqual(shimAvailabilityProblems(claim, { preparedVersions: ["7.1.13"], file: "limits.md" }),
    ["limits.md:2: a release does not include the replacement package until npm records a version"])
  assert.deepEqual(shimAvailabilityProblems(claim, { versions: ["7.1.13"], file: "limits.md" }), [])
  assert.deepEqual(shimAvailabilityProblems("An experimental preview, not published to npm.\n", { file: "limits.md" }), [])
})
