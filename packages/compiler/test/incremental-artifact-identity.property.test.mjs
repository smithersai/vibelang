import { fileURLToPath } from "node:url"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { spawnSync } from "node:child_process"
import { test } from "node:test"
import fc from "fast-check"
import { SpecPath } from "../../../scripts/testing/spec-path.mjs"

const binary = process.env.VIBELANG_BINARY || fileURLToPath(new URL("../native/" + (process.platform === "win32" ? "vibelang.exe" : "vibelang"), import.meta.url))
const raw = process.env.VIBELANG_INCREMENTAL_ARTIFACT_RAW === "1"
const fixtures = ["url", "hot", "env"].map(key => JSON.parse(readFileSync(new URL("./property-regressions/foldkit-incremental-artifact-" + key + ".json", import.meta.url), "utf8")))
test("real cache fixtures retain their source and artifact provenance", () => {
  assert.ok(readFileSync(SpecPath("005-services.md"), "utf8").includes("`import.meta` may appear only as the object of `.url`"))
  for (const fixture of fixtures) {
    assert.equal(fixture.previousNativeSHA256, "3abff0ef3caa0a028adbe18264c4c574b2ae649e93918cb83b7f7a086e312eaf")
    assert.notEqual(fixture.previousNativeSHA256, fixture.captureNativeSHA256)
    assert.equal(createHash("sha256").update(fixture.buildInfo.text).digest("hex"), fixture.buildInfo.sha256)
    const info = JSON.parse(fixture.buildInfo.text)
    assert.equal(info.version, "7.1.0-dev")
    assert.deepEqual(info.fileNames, ["../globals.d.ts", "../main.vibe"])
    assert.equal(fixture.original.status, 0)
  }
})

function check(fixture, mutation) {
  const root = mkdtempSync(join(tmpdir(), "foldkit-artifact-cache-"))
  try {
    const put = (name, text) => { const p = join(root, name); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text) }
    for (const [name, text] of Object.entries({ ...fixture.files, ...fixture.emittedFiles })) put(name, text)
    put(fixture.buildInfo.path, fixture.buildInfo.text)
    if (mutation) {
      let source = fixture.files["main.vibe"].replace("read()", mutation.name + "()")
      if (mutation.arrow) source = "export const " + mutation.name + " = (): unknown => import.meta." + fixture.key + ";\n"
      if (mutation.comment) source = "/* changed source invalidates historical metadata */\n" + source
      put("main.vibe", source)
    }
    const compile = args => {
      const result = spawnSync(binary, ["--singleThreaded", "--pretty", "false", "-p", "tsconfig.json", "--noEmit", ...args], { cwd: root, encoding: "utf8" })
      assert.ifError(result.error)
      assert.equal(result.signal, null)
      const output = result.stdout + result.stderr
      return { status: result.status, codes: [...output.matchAll(/error (EK\d+|TS\d+):/g)].map(m => m[1]).sort() }
    }
    const warm = compile([])
    const fresh = compile(["--composite", "false", "--incremental", "false"])
    assert.deepEqual(fresh, fixture.key === "url" ? { status: 0, codes: [] } : { status: 2, codes: ["EK4402"] }, "the chapter boundary remains active in a fresh check")
    if (!mutation && fixture.pending && !raw) {
      assert.equal(fixture.pending.owner, "migfix-foldkit")
      assert.deepEqual(warm, { status: 0, codes: [] }, "XPASS " + fixture.pending.key + ": retire the historical-cache pending entry")
    } else assert.deepEqual(warm, fresh, fixture.pending?.key ?? "unchanged source must not change diagnostics when the cache is present")
  } finally { rmSync(root, { recursive: true, force: true }) }
}
for (const fixture of fixtures) test("historical compiler cache: " + fixture.key, () => check(fixture))
test("source edits invalidate real historical metadata across names, function forms and comments", () => {
  fc.assert(fc.property(fc.constantFrom(...fixtures), fc.record({
    name: fc.constantFrom("changed", "readAgain", "lookup"), arrow: fc.boolean(), comment: fc.boolean(),
  }), check), { seed: 114205, numRuns: 12, endOnFailure: true })
})
